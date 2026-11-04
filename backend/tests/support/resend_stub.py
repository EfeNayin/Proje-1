"""A throw-away stand-in for Resend's HTTPS API, for tests and the local staging stack.

Standard library only. It answers `POST /emails` the way the real API is documented to
(200 {"id": ...} on success, {"name", "message", "statusCode"} on errors) and can be told
to misbehave: a status, a body, a delay, or a body that is not JSON. It keeps what it
received so a test can check exactly what the backend sent. It serves TLS only when given
a certificate, so a client's certificate checks are exercised for real.

Two uses:
  * in-process, from the backend tests (`ResendStub`);
  * as a container in backend/deploy/local-staging (`python -m tests.support.resend_stub`),
    where two control paths exist: `POST /_plan` (a JSON list of scripted answers, used
    one per message, then back to success) and `GET /_requests`.

It is a test double, not a mail provider: nothing is delivered anywhere.
"""

import argparse
import json
import ssl
import threading
import time
import uuid
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


@dataclass
class Answer:
    status: int = 200
    body: str | None = None  # raw text; None means the documented JSON for this status
    delay: float = 0.0
    headers: dict[str, str] = field(default_factory=dict)


@dataclass
class Seen:
    path: str
    headers: dict[str, str]  # names lower-cased
    json: Any


def _documented(status: int) -> str:
    if status == 200:
        return json.dumps({"id": str(uuid.uuid4())})
    names = {
        401: "missing_api_key",
        403: "validation_error",
        422: "invalid_parameter",
        429: "rate_limit_exceeded",
        500: "application_error",
        503: "service_unavailable",
    }
    return json.dumps({"name": names.get(status, "error"), "message": "stub", "statusCode": status})


class ResendStub:
    def __init__(self, api_key: str = "re_stub_key") -> None:
        self.api_key = api_key
        self.requests: list[Seen] = []
        self.plan: list[Answer] = []
        self._server: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None

    @property
    def port(self) -> int:
        assert self._server is not None
        return int(self._server.server_address[1])

    def start(
        self,
        certificate: str | None = None,
        key: str | None = None,
        port: int = 0,
        host: str = "127.0.0.1",
    ) -> int:
        stub = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args: Any) -> None:  # silence
                return

            def _send(self, status: int, body: str, headers: dict[str, str] | None = None) -> None:
                data = body.encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                for name, value in (headers or {}).items():
                    self.send_header(name, value)
                self.end_headers()
                self.wfile.write(data)

            def _body(self) -> bytes:
                return self.rfile.read(int(self.headers.get("Content-Length", "0")))

            def do_GET(self) -> None:
                if self.path == "/_requests":
                    self._send(200, json.dumps([seen.json for seen in stub.requests]))
                else:
                    self._send(404, _documented(404))

            def do_POST(self) -> None:
                raw = self._body()
                if self.path == "/_plan":
                    stub.plan = [Answer(**item) for item in json.loads(raw)]
                    self._send(200, "{}")
                    return
                if self.path != "/emails":
                    self._send(404, _documented(404))
                    return
                headers = {name.lower(): value for name, value in self.headers.items()}
                try:
                    parsed = json.loads(raw)
                except ValueError:
                    parsed = None
                stub.requests.append(Seen(self.path, headers, parsed))
                if headers.get("authorization") != f"Bearer {stub.api_key}":
                    self._send(401, _documented(401))
                    return
                answer = stub.plan.pop(0) if stub.plan else Answer()
                if answer.delay:
                    time.sleep(answer.delay)
                body = answer.body if answer.body is not None else _documented(answer.status)
                self._send(answer.status, body, answer.headers)

        server = ThreadingHTTPServer((host, port), Handler)
        server.daemon_threads = True
        if certificate and key:
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(certificate, key)
            server.socket = context.wrap_socket(server.socket, server_side=True)
        self._server = server
        self._thread = threading.Thread(target=server.serve_forever, daemon=True)
        self._thread.start()
        return self.port

    def stop(self) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
            self._server = None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8443)
    parser.add_argument("--cert", required=True)
    parser.add_argument("--key", required=True)
    parser.add_argument("--api-key", required=True)
    args = parser.parse_args()
    stub = ResendStub(api_key=args.api_key)
    stub.start(args.cert, args.key, port=args.port, host="0.0.0.0")  # noqa: S104 - test network
    threading.Event().wait()


if __name__ == "__main__":
    main()
