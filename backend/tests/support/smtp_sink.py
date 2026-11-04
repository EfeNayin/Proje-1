"""A throw-away SMTP inbox for tests and for the isolated end-to-end stack.

Standard library only. It accepts mail from anyone and keeps it in memory, so it must
never face a network that is not a test network. Two uses:

  * in-process, from the backend tests (`SmtpSink`), where it can also misbehave on
    purpose (refuse a message, drop the connection, stall, offer or withhold STARTTLS);
  * as a container in e2e/docker-compose.e2e.yml (`python -m tests.support.smtp_sink`),
    where the native recovery test reads the delivered message through a small HTTP
    API (GET /messages, DELETE /messages) instead of through a mail client.

It is a test inbox, not a mail server: no relaying, no queueing, no persistence.
"""

import argparse
import asyncio
import base64
import json
import ssl
from dataclasses import dataclass, field
from email import message_from_bytes
from email import policy as email_policy
from typing import Any


@dataclass
class Received:
    mail_from: str
    recipients: list[str]
    raw: bytes

    @property
    def message(self) -> Any:
        return message_from_bytes(self.raw, policy=email_policy.default)

    @property
    def subject(self) -> str:
        return str(self.message["Subject"])

    @property
    def body(self) -> str:
        part = self.message.get_body(preferencelist=("plain",))
        return str(part.get_content()) if part is not None else ""

    def as_json(self) -> dict[str, Any]:
        return {
            "from": self.mail_from,
            "to": self.recipients,
            "subject": self.subject,
            "body": self.body,
        }


@dataclass
class SmtpSink:
    tls_context: ssl.SSLContext | None = None  # server side; enables STARTTLS when set
    offer_starttls: bool = True
    require_auth: bool = False
    # Behaviours for failure tests.
    reject_with: str | None = None  # e.g. "451 try again later", answered at DATA
    drop_connection: bool = False  # close the socket right after the greeting
    stall_seconds: float = 0.0  # wait before the greeting
    messages: list[Received] = field(default_factory=list)
    credentials: list[tuple[str, str]] = field(default_factory=list)
    connections: int = 0
    _server: asyncio.Server | None = None

    async def start(self, host: str = "127.0.0.1", port: int = 0) -> int:
        self._server = await asyncio.start_server(self._serve, host, port)
        return int(self._server.sockets[0].getsockname()[1])

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()

    def clear(self) -> None:
        self.messages.clear()

    async def _serve(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self.connections += 1
        try:
            if self.stall_seconds:
                await asyncio.sleep(self.stall_seconds)
            if self.drop_connection:
                return
            await self._dialogue(reader, writer)
        except (ConnectionError, asyncio.IncompleteReadError, ssl.SSLError):
            pass
        finally:
            writer.close()

    async def _say(self, writer: asyncio.StreamWriter, *lines: str) -> None:
        for line in lines:
            writer.write(line.encode() + b"\r\n")
        await writer.drain()

    async def _dialogue(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        secure = False
        authed = not self.require_auth
        sender = ""
        recipients: list[str] = []
        await self._say(writer, "220 sink ESMTP ready")
        while True:
            line = (await reader.readline()).decode(errors="replace").rstrip("\r\n")
            if not line:
                return
            verb = line.split(" ", 1)[0].upper()
            if verb in ("EHLO", "HELO"):
                extensions = ["250-sink"]
                if self.tls_context is not None and self.offer_starttls and not secure:
                    extensions.append("250-STARTTLS")
                if self.require_auth:
                    extensions.append("250-AUTH PLAIN LOGIN")
                extensions.append("250 8BITMIME")
                await self._say(writer, *extensions)
            elif verb == "STARTTLS" and self.tls_context is not None and not secure:
                await self._say(writer, "220 ready to start TLS")
                await writer.start_tls(self.tls_context)
                secure = True
            elif verb == "AUTH":
                parts = line.split()
                if parts[1].upper() == "PLAIN":
                    blob = parts[2] if len(parts) > 2 else ""
                    _, user, password = base64.b64decode(blob).decode().split("\0")
                    self.credentials.append((user, password))
                    authed = True
                    await self._say(writer, "235 ok")
                else:
                    await self._say(writer, "504 unsupported")
            elif verb == "MAIL":
                if not authed:
                    await self._say(writer, "530 authentication required")
                    continue
                sender = line.partition(":")[2].strip().strip("<>").split(">")[0]
                recipients = []
                await self._say(writer, "250 ok")
            elif verb == "RCPT":
                recipients.append(line.partition(":")[2].strip().strip("<>").split(">")[0])
                await self._say(writer, "250 ok")
            elif verb == "DATA":
                if self.reject_with:
                    await self._say(writer, self.reject_with)
                    continue
                await self._say(writer, "354 end with <CRLF>.<CRLF>")
                chunks: list[bytes] = []
                while True:
                    row = await reader.readline()
                    if row in (b".\r\n", b""):
                        break
                    chunks.append(row[1:] if row.startswith(b"..") else row)
                self.messages.append(Received(sender, recipients, b"".join(chunks)))
                await self._say(writer, "250 queued")
            elif verb == "RSET" or verb == "NOOP":
                await self._say(writer, "250 ok")
            elif verb == "QUIT":
                await self._say(writer, "221 bye")
                return
            else:
                await self._say(writer, "502 not implemented")


async def _http(sink: SmtpSink, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        request = (await reader.readline()).decode().split()
        while (await reader.readline()) not in (b"\r\n", b""):
            pass
        method, path = request[0], request[1]
        status, payload = "404 Not Found", b"{}"
        if path == "/health":
            status, payload = "200 OK", b'{"status":"ok"}'
        elif path == "/messages" and method == "GET":
            status, payload = "200 OK", json.dumps([m.as_json() for m in sink.messages]).encode()
        elif path == "/messages" and method == "DELETE":
            sink.clear()
            status, payload = "200 OK", b"[]"
        writer.write(
            f"HTTP/1.1 {status}\r\nContent-Type: application/json\r\n"
            f"Content-Length: {len(payload)}\r\nConnection: close\r\n\r\n".encode()
            + payload
        )
        await writer.drain()
    except (ConnectionError, IndexError, UnicodeDecodeError):
        pass
    finally:
        writer.close()


async def _main(smtp_port: int, http_port: int) -> None:
    sink = SmtpSink()
    await sink.start("0.0.0.0", smtp_port)
    api = await asyncio.start_server(lambda r, w: _http(sink, r, w), "0.0.0.0", http_port)
    async with api:
        await api.serve_forever()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--smtp-port", type=int, default=1025)
    parser.add_argument("--http-port", type=int, default=8025)
    arguments = parser.parse_args()
    asyncio.run(_main(arguments.smtp_port, arguments.http_port))
