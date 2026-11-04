"""Outgoing email: two small transports (SMTP, Resend over HTTPS), nothing more.

It exists for password recovery (the code, and the notice that a password changed).
It is not a notification platform: no queue, no templates engine, no provider SDK, no
retries in the background, no switching from one transport to the other.

Rules both transports follow:
  * Credentials come from settings and stay on the backend. Only the transport named by
    MAIL_TRANSPORT is ever used, and outside development it must be fully configured and
    encrypted (config.check_deployment_safety).
  * Sending never runs inside the request that asked for it (the router hands it to a
    background task), so the response does not reveal, by how long it took, whether a
    message was sent at all.
  * Resources are bounded: each send has a timeout, a fixed number run at once and a
    fixed number may wait; a message beyond that is dropped. A stuck server therefore
    costs a bounded number of tasks or threads, not one per request.
  * A failure never raises to the caller and never reaches the logs with detail: only
    the exception class, or a short fixed reason such as "resend http 429 rate_limit_exceeded",
    is logged, never the recipient, the body, a header or the server's reply text.
  * There is no fallback that logs or returns a message's content. Without a configured
    transport nothing is sent.
  * Delivery is best effort and not durable: a message that fails, or is lost when the
    process stops between the response and the send, is not retried. The way to get
    another one is to ask for another code. "Accepted by the provider" is all `send`
    reports; it is not a promise that the message reached an inbox.

SMTP: STARTTLS (the server has to offer it; a server that does not is an error, never a
silent plain-text fallback) or implicit TLS, both with certificate and hostname
verification; unencrypted only in development, for a local test inbox. smtplib blocks,
so sends run in worker threads.

Resend: one HTTPS POST per message with a bearer key, certificate verification on, no
redirects followed (so the key is never replayed elsewhere), a bounded response read.
"""

import asyncio
import json
import logging
import re
import smtplib
import ssl
from abc import ABC, abstractmethod
from email.message import EmailMessage
from email.utils import formatdate, make_msgid, parseaddr

import httpx

from app.core.config import Settings, settings

logger = logging.getLogger(__name__)


class MailDeliveryError(Exception):
    """A failed send whose `reason` is safe to log: fixed words, never provider text."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class Mailer(ABC):
    """Bounded, never-raising sending shared by the transports."""

    def __init__(self, max_concurrent: int, max_pending: int) -> None:
        self._slots = asyncio.Semaphore(max_concurrent)
        self._max_pending = max_pending
        self._waiting = 0

    @property
    @abstractmethod
    def enabled(self) -> bool: ...

    @abstractmethod
    async def _transmit(self, to: str, subject: str, body: str) -> None:
        """Hand one message to the transport. Raises if it was not accepted."""

    async def send(self, to: str, subject: str, body: str) -> bool:
        """Send one message. True if the server accepted it; never raises."""
        if not self.enabled:
            logger.warning("email not sent: no mail transport is configured")
            return False
        if self._waiting >= self._max_pending:
            logger.warning("email dropped: too many sends waiting")
            return False
        self._waiting += 1
        try:
            async with self._slots:
                await self._transmit(to, subject, body)
            return True
        except Exception as error:  # noqa: BLE001 - nothing may escape a background send
            reason = error.reason if isinstance(error, MailDeliveryError) else type(error).__name__
            logger.error("email delivery failed (%s)", reason)
            return False
        finally:
            self._waiting -= 1


class SmtpMailer(Mailer):
    def __init__(self, config: Settings) -> None:
        super().__init__(config.SMTP_MAX_CONCURRENT, config.SMTP_MAX_PENDING)
        self._config = config

    @property
    def enabled(self) -> bool:
        return self._config.smtp_configured

    def build(self, to: str, subject: str, body: str) -> EmailMessage:
        """A plain-text message. EmailMessage refuses header values with line breaks."""
        message = EmailMessage()
        message["From"] = self._config.mail_from
        message["To"] = to
        message["Subject"] = subject
        message["Date"] = formatdate(localtime=False)
        domain = parseaddr(self._config.mail_from)[1].rpartition("@")[2] or "localhost"
        message["Message-ID"] = make_msgid(domain=domain)
        message.set_content(body)
        return message

    async def _transmit(self, to: str, subject: str, body: str) -> None:
        message = self.build(to, subject, body)
        await asyncio.to_thread(self._deliver, message)

    def _deliver(self, message: EmailMessage) -> None:
        config = self._config
        assert config.SMTP_HOST is not None
        timeout = config.SMTP_TIMEOUT_SECONDS
        context = ssl.create_default_context()  # verifies the certificate and the hostname
        if config.SMTP_SECURITY == "implicit":
            client: smtplib.SMTP = smtplib.SMTP_SSL(
                config.SMTP_HOST, config.SMTP_PORT, timeout=timeout, context=context
            )
        else:
            client = smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=timeout)
        with client:
            if config.SMTP_SECURITY == "starttls":
                client.ehlo()
                # Raises if the server does not offer STARTTLS: fail closed.
                client.starttls(context=context)
            client.ehlo()
            if config.SMTP_USERNAME:
                password = config.SMTP_PASSWORD.get_secret_value() if config.SMTP_PASSWORD else ""
                client.login(config.SMTP_USERNAME, password)
            client.send_message(message)


# A provider's error `name` is one of a short list of snake_case words; anything else is
# not echoed (it could carry text from the message or an address).
_PROVIDER_ERROR_NAME = re.compile(r"[a-z_]{1,48}")
_MAX_RESPONSE_BYTES = 64 * 1024


class ResendMailer(Mailer):
    """Resend's HTTPS API (POST /emails). One request per message, no retries."""

    def __init__(
        self, config: Settings, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        super().__init__(config.RESEND_MAX_CONCURRENT, config.RESEND_MAX_PENDING)
        self._config = config
        self._transport = transport  # tests inject a stub here; None means the real network

    @property
    def enabled(self) -> bool:
        return self._config.resend_configured

    async def _transmit(self, to: str, subject: str, body: str) -> None:
        config = self._config
        assert config.RESEND_API_KEY is not None
        timeout = config.RESEND_TIMEOUT_SECONDS
        headers = {"Authorization": f"Bearer {config.RESEND_API_KEY.get_secret_value()}"}
        payload = {"from": config.mail_from, "to": [to], "subject": subject, "text": body}
        try:
            # The deadline covers the whole exchange; httpx's own timeouts cover each step.
            async with asyncio.timeout(timeout):
                async with httpx.AsyncClient(
                    timeout=timeout,
                    transport=self._transport,
                    follow_redirects=False,
                ) as client:
                    async with client.stream(
                        "POST", config.RESEND_API_URL, headers=headers, json=payload
                    ) as response:
                        status = response.status_code
                        raw = await _read_limited(response)
        except TimeoutError:
            raise MailDeliveryError("resend timeout") from None
        except httpx.TimeoutException:
            raise MailDeliveryError("resend timeout") from None
        except httpx.HTTPError as error:
            raise MailDeliveryError(f"resend transport error {type(error).__name__}") from None
        if raw is None:
            raise MailDeliveryError("resend malformed response")
        if not 200 <= status < 300:
            raise MailDeliveryError(f"resend http {status}{_provider_error_name(raw)}")
        try:
            accepted = json.loads(raw)
        except ValueError:
            accepted = None
        if not isinstance(accepted, dict) or not isinstance(accepted.get("id"), str):
            raise MailDeliveryError("resend malformed response")
        if not accepted["id"]:
            raise MailDeliveryError("resend malformed response")


async def _read_limited(response: httpx.Response) -> bytes | None:
    """The body, or None if it is larger than any real answer from the provider."""
    received = bytearray()
    async for chunk in response.aiter_bytes():
        received += chunk
        if len(received) > _MAX_RESPONSE_BYTES:
            return None
    return bytes(received)


def _provider_error_name(raw: bytes) -> str:
    """` <name>` from {"name": ...} if it looks like a Resend error name, else nothing."""
    try:
        parsed = json.loads(raw)
    except ValueError:
        return ""
    name = parsed.get("name") if isinstance(parsed, dict) else None
    if isinstance(name, str) and _PROVIDER_ERROR_NAME.fullmatch(name):
        return f" {name}"
    return ""


_mailer: Mailer | None = None


def get_mailer() -> Mailer:
    """The process-wide mailer for the selected transport. A FastAPI dependency (swappable)."""
    global _mailer
    if _mailer is None:
        if settings.MAIL_TRANSPORT == "resend":
            _mailer = ResendMailer(settings)
        else:
            _mailer = SmtpMailer(settings)
    return _mailer
