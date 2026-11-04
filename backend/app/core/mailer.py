"""Outgoing email: one small SMTP adapter, nothing more.

It exists for password recovery (the code, and the notice that a password changed).
It is not a notification platform: no queue, no templates engine, no provider SDK, no
retries in the background.

Rules it follows:
  * Credentials come from settings and stay on the backend. A connection to a real
    server must be encrypted: STARTTLS (the server has to offer it; a server that does
    not is an error, never a silent plain-text fallback) or implicit TLS, both with
    certificate and hostname verification. Unencrypted is possible only in development
    (config.check_deployment_safety), for a local test inbox.
  * Sending never runs inside the request that asked for it (the router hands it to a
    background task), so the response does not reveal, by how long it took, whether a
    message was sent at all.
  * Resources are bounded: each socket operation has a timeout, at most
    SMTP_MAX_CONCURRENT sends run at once (in worker threads, since smtplib blocks) and
    at most SMTP_MAX_PENDING wait; a message beyond that is dropped. A stuck server
    therefore costs a bounded number of threads, not one per request.
  * A failure never raises to the caller and never reaches the logs with detail: only
    the exception class is logged, never the recipient, the body or the server's reply.
  * There is no fallback that logs or returns a message's content. Without SMTP_HOST
    nothing is sent.
  * Delivery is best effort and not durable: a message that fails, or is lost when the
    process stops between the response and the send, is not retried. The way to get
    another one is to ask for another code.
"""

import asyncio
import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formatdate, make_msgid, parseaddr

from app.core.config import Settings, settings

logger = logging.getLogger(__name__)


class SmtpMailer:
    def __init__(self, config: Settings) -> None:
        self._config = config
        self._slots = asyncio.Semaphore(config.SMTP_MAX_CONCURRENT)
        self._waiting = 0

    @property
    def enabled(self) -> bool:
        return self._config.smtp_configured

    def build(self, to: str, subject: str, body: str) -> EmailMessage:
        """A plain-text message. EmailMessage refuses header values with line breaks."""
        message = EmailMessage()
        message["From"] = self._config.SMTP_FROM
        message["To"] = to
        message["Subject"] = subject
        message["Date"] = formatdate(localtime=False)
        domain = parseaddr(self._config.SMTP_FROM)[1].rpartition("@")[2] or "localhost"
        message["Message-ID"] = make_msgid(domain=domain)
        message.set_content(body)
        return message

    async def send(self, to: str, subject: str, body: str) -> bool:
        """Send one message. True if the server accepted it; never raises."""
        if not self.enabled:
            logger.warning("email not sent: SMTP_HOST is not configured")
            return False
        if self._waiting >= self._config.SMTP_MAX_PENDING:
            logger.warning("email dropped: too many sends waiting")
            return False
        self._waiting += 1
        try:
            async with self._slots:
                message = self.build(to, subject, body)
                await asyncio.to_thread(self._deliver, message)
            return True
        except Exception as error:  # noqa: BLE001 - nothing may escape a background send
            logger.error("email delivery failed (%s)", type(error).__name__)
            return False
        finally:
            self._waiting -= 1

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


_mailer: SmtpMailer | None = None


def get_mailer() -> SmtpMailer:
    """The process-wide mailer. A FastAPI dependency, so tests can swap it."""
    global _mailer
    if _mailer is None:
        _mailer = SmtpMailer(settings)
    return _mailer
