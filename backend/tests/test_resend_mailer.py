"""Resend over HTTPS: the transport, its failure modes, and recovery through it.

No real email is ever sent and no real network is touched: requests go to an
httpx.MockTransport, to an in-process stub (tests/support/resend_stub.py) or to that stub
behind TLS with a throw-away CA (tests/support/tls.py), which proves the client really
verifies the certificate chain and the hostname. What matters most: the provider's key is
only ever sent to the configured URL (never to a redirect target), every failure is a
False and one fixed log line with no address, code, key or provider text, concurrency and
waiting are bounded, and nothing is retried or switched to another transport.
"""

import asyncio
import json
import logging
import re
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from httpx import AsyncClient

from app.core.config import Settings, settings
from app.core.mailer import Mailer, ResendMailer, SmtpMailer, get_mailer
from app.main import app
from tests.support.resend_stub import Answer, ResendStub
from tests.support.tls import issue, make_authority
from tests.test_password_recovery import (
    EMAIL,
    NEW_PASSWORD,
    PASSWORD,
    _ask,
    _login,
    _reset,
    _signup,
    _skip_cooldown,
)

KEY = "re_test_key_do_not_log_0123456789"
SENDER = "BodyTrack <no-reply@staging.example.test>"
RECIPIENT = "victim.mailbox@example.com"
SUBJECT = "Your BodyTrack password reset code"
BODY = "Use this code:\n\n    4821 9937\n"


@pytest.fixture(autouse=True)
def _loggers_enabled() -> None:
    for name in list(logging.root.manager.loggerDict):
        if name.startswith("app"):
            logging.getLogger(name).disabled = False


def resend_settings(url: str = "https://api.resend.test/emails", **overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "MAIL_TRANSPORT": "resend",
        "RESEND_API_KEY": KEY,
        "RESEND_API_URL": url,
        "MAIL_FROM": SENDER,
        **overrides,
    }
    return Settings(
        _env_file=None,
        DATABASE_URL="postgresql+asyncpg://u:p@db/x",
        JWT_SECRET_KEY=settings.JWT_SECRET_KEY,
        **values,
    )


def mock_mailer(handler: Any, **overrides: Any) -> ResendMailer:
    return ResendMailer(resend_settings(**overrides), transport=httpx.MockTransport(handler))


def accepted(_: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json={"id": "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"})


def assert_log_is_clean(text: str) -> None:
    for secret in (KEY, RECIPIENT, "4821", "9937", BODY.strip(), SUBJECT, "Authorization"):
        assert secret not in text, secret


# ── what is sent ─────────────────────────────────────────────────────────


class TestTheRequest:
    async def test_one_https_post_with_the_key_and_the_message(self) -> None:
        seen: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return accepted(request)

        assert await mock_mailer(handler).send(RECIPIENT, SUBJECT, BODY) is True

        (request,) = seen
        assert request.method == "POST"
        assert str(request.url) == "https://api.resend.test/emails"
        assert request.headers["authorization"] == f"Bearer {KEY}"
        assert request.headers["content-type"] == "application/json"
        assert json.loads(request.content) == {
            "from": SENDER,
            "to": [RECIPIENT],
            "subject": SUBJECT,
            "text": BODY,
        }

    async def test_the_from_address_falls_back_to_smtp_from_only_when_unset(self) -> None:
        seen: list[dict[str, Any]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(json.loads(request.content))
            return accepted(request)

        legacy = mock_mailer(
            handler, MAIL_FROM=None, SMTP_FROM="Legacy <legacy@staging.example.test>"
        )
        await legacy.send(RECIPIENT, SUBJECT, BODY)

        assert seen[0]["from"] == "Legacy <legacy@staging.example.test>"

    async def test_it_is_only_enabled_with_a_key(self) -> None:
        assert mock_mailer(accepted).enabled
        no_key = mock_mailer(accepted, RESEND_API_KEY=None)
        assert not no_key.enabled
        assert await no_key.send(RECIPIENT, SUBJECT, BODY) is False

    async def test_the_key_is_not_shown_by_repr_or_str(self) -> None:
        shown = resend_settings()
        assert KEY not in repr(shown) and KEY not in str(shown)

    async def test_nothing_is_retried(self) -> None:
        calls = 0

        def handler(_: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            return httpx.Response(503, json={"name": "service_unavailable"})

        assert await mock_mailer(handler).send(RECIPIENT, SUBJECT, BODY) is False
        assert calls == 1


# ── what the provider can answer ─────────────────────────────────────────


class TestProviderAnswers:
    @pytest.mark.parametrize(
        ("status", "name"),
        [
            (401, "missing_api_key"),
            (403, "validation_error"),
            (422, "invalid_parameter"),
            (429, "rate_limit_exceeded"),
            (429, "daily_quota_exceeded"),
            (500, "application_error"),
            (503, "service_unavailable"),
        ],
    )
    async def test_a_rejection_is_false_and_logs_only_a_fixed_reason(
        self, status: int, name: str, caplog: pytest.LogCaptureFixture
    ) -> None:
        caplog.set_level(logging.DEBUG)

        def handler(_: httpx.Request) -> httpx.Response:
            return httpx.Response(
                status,
                headers={"retry-after": "3"},
                json={"name": name, "message": f"cannot send to {RECIPIENT}", "statusCode": status},
            )

        assert await mock_mailer(handler).send(RECIPIENT, SUBJECT, BODY) is False

        assert f"email delivery failed (resend http {status} {name})" in caplog.text
        assert_log_is_clean(caplog.text)

    async def test_text_that_is_not_a_provider_error_name_is_never_logged(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        caplog.set_level(logging.DEBUG)

        def handler(_: httpx.Request) -> httpx.Response:
            return httpx.Response(422, json={"name": f"bad {RECIPIENT}", "message": RECIPIENT})

        await mock_mailer(handler).send(RECIPIENT, SUBJECT, BODY)

        assert "email delivery failed (resend http 422)" in caplog.text
        assert_log_is_clean(caplog.text)

    @pytest.mark.parametrize(
        "answer",
        [
            httpx.Response(200, text="<html>gateway</html>"),
            httpx.Response(200, text=""),
            httpx.Response(200, json=["49a3999c"]),
            httpx.Response(200, json={"status": "queued"}),
            httpx.Response(200, json={"id": ""}),
            httpx.Response(200, json={"id": 17}),
            httpx.Response(200, text="x" * (64 * 1024 + 1)),
        ],
        ids=["html", "empty", "list", "no-id", "empty-id", "numeric-id", "oversized"],
    )
    async def test_a_success_status_with_a_malformed_body_is_not_a_success(
        self, answer: httpx.Response, caplog: pytest.LogCaptureFixture
    ) -> None:
        caplog.set_level(logging.DEBUG)

        assert await mock_mailer(lambda _: answer).send(RECIPIENT, SUBJECT, BODY) is False

        assert "email delivery failed (resend malformed response)" in caplog.text

    async def test_a_redirect_is_not_followed_and_the_key_goes_nowhere_else(self) -> None:
        seen: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return httpx.Response(307, headers={"location": "https://attacker.test/collect"})

        assert await mock_mailer(handler).send(RECIPIENT, SUBJECT, BODY) is False
        assert [str(r.url) for r in seen] == ["https://api.resend.test/emails"]


# ── time and transport failures ──────────────────────────────────────────


class TestTimeAndTransport:
    async def test_a_stalled_provider_ends_at_the_deadline(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        caplog.set_level(logging.DEBUG)

        async def handler(_: httpx.Request) -> httpx.Response:
            await asyncio.sleep(30)
            return accepted(_)

        started = asyncio.get_running_loop().time()
        delivered = await mock_mailer(handler, RESEND_TIMEOUT_SECONDS=0.2).send(
            RECIPIENT, SUBJECT, BODY
        )

        assert delivered is False
        assert asyncio.get_running_loop().time() - started < 2
        assert "email delivery failed (resend timeout)" in caplog.text

    async def test_an_httpx_timeout_is_a_timeout(self, caplog: pytest.LogCaptureFixture) -> None:
        caplog.set_level(logging.DEBUG)

        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("read timed out", request=request)

        assert await mock_mailer(handler).send(RECIPIENT, SUBJECT, BODY) is False
        assert "email delivery failed (resend timeout)" in caplog.text

    async def test_a_connection_error_is_false_and_logs_only_its_class(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        caplog.set_level(logging.DEBUG)

        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError(f"cannot reach the host for {RECIPIENT}", request=request)

        assert await mock_mailer(handler).send(RECIPIENT, SUBJECT, BODY) is False

        assert "email delivery failed (resend transport error ConnectError)" in caplog.text
        assert_log_is_clean(caplog.text)

    async def test_an_unexpected_error_never_escapes(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        def handler(_: httpx.Request) -> httpx.Response:
            raise RuntimeError(KEY)

        assert await mock_mailer(handler).send(RECIPIENT, SUBJECT, BODY) is False
        assert KEY not in caplog.text


class TestBounds:
    async def test_concurrency_and_waiting_are_bounded(self) -> None:
        running = peak = calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal running, peak, calls
            calls += 1
            running += 1
            peak = max(peak, running)
            await asyncio.sleep(0.05)
            running -= 1
            return accepted(request)

        mailer = mock_mailer(handler, RESEND_MAX_CONCURRENT=2, RESEND_MAX_PENDING=5)
        results = await asyncio.gather(*(mailer.send(RECIPIENT, SUBJECT, BODY) for _ in range(12)))

        assert peak == 2
        assert calls == 5  # the other seven were dropped, not queued without limit
        assert results.count(True) == 5 and results.count(False) == 7


# ── real TLS: the certificate and the hostname are checked ───────────────


@pytest.fixture
def tls_stub(tmp_path: Path) -> Iterator[tuple[ResendStub, int, Path]]:
    authority = make_authority()
    issued = issue(authority, "stub.resend.test")
    (tmp_path / "ca.crt").write_bytes(authority.pem)
    (tmp_path / "server.crt").write_bytes(issued.certificate_pem)
    (tmp_path / "server.key").write_bytes(issued.key_pem)
    stub = ResendStub(api_key=KEY)
    port = stub.start(str(tmp_path / "server.crt"), str(tmp_path / "server.key"))
    yield stub, port, tmp_path / "ca.crt"
    stub.stop()


class TestRealTls:
    async def test_a_certificate_from_a_trusted_authority_is_accepted(
        self, tls_stub: tuple[ResendStub, int, Path], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        stub, port, ca = tls_stub
        monkeypatch.setenv("SSL_CERT_FILE", str(ca))
        # 127.0.0.1 is in the certificate's alternative names.
        mailer = ResendMailer(resend_settings(f"https://127.0.0.1:{port}/emails"))

        assert await mailer.send(RECIPIENT, SUBJECT, BODY) is True
        assert stub.requests[0].headers["authorization"] == f"Bearer {KEY}"

    async def test_a_certificate_from_an_unknown_authority_is_refused(
        self, tls_stub: tuple[ResendStub, int, Path], caplog: pytest.LogCaptureFixture
    ) -> None:
        stub, port, _ = tls_stub  # the CA is NOT trusted here
        caplog.set_level(logging.DEBUG)

        delivered = await ResendMailer(resend_settings(f"https://127.0.0.1:{port}/emails")).send(
            RECIPIENT, SUBJECT, BODY
        )

        assert delivered is False
        assert stub.requests == []  # the key was never sent
        assert "email delivery failed (resend transport error ConnectError)" in caplog.text

    async def test_a_certificate_for_another_name_is_refused(
        self, tls_stub: tuple[ResendStub, int, Path], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        stub, port, ca = tls_stub
        monkeypatch.setenv("SSL_CERT_FILE", str(ca))
        # Trusted CA, but the certificate does not name "localhost".
        mailer = ResendMailer(resend_settings(f"https://localhost:{port}/emails"))

        assert await mailer.send(RECIPIENT, SUBJECT, BODY) is False
        assert stub.requests == []


# ── recovery through Resend ──────────────────────────────────────────────


@pytest.fixture
def stub() -> Iterator[ResendStub]:
    resend = ResendStub(api_key=KEY)
    resend.start()
    yield resend
    resend.stop()


@pytest.fixture
async def resend_mailer(stub: ResendStub, client: AsyncClient) -> AsyncIterator[ResendMailer]:
    configured = ResendMailer(resend_settings(f"http://127.0.0.1:{stub.port}/emails"))
    app.dependency_overrides[get_mailer] = lambda: configured
    yield configured


def code_sent(stub: ResendStub, nth: int = -1) -> str:
    match = re.search(r"\b(\d{4}) (\d{4})\b", stub.requests[nth].json["text"])
    assert match is not None
    return match.group(1) + match.group(2)


class TestRecoveryThroughResend:
    async def test_the_code_arrives_and_resets_the_password(
        self, client: AsyncClient, resend_mailer: ResendMailer, stub: ResendStub
    ) -> None:
        body = await _signup(client)
        assert (await _ask(client)).status_code == 202

        assert [r.json["to"] for r in stub.requests] == [[EMAIL]]
        assert stub.requests[0].json["subject"] == SUBJECT
        reset = await _reset(client, EMAIL, code_sent(stub))
        assert reset.status_code == 204
        assert (await _login(client, PASSWORD)).status_code == 401
        assert (await _login(client, NEW_PASSWORD)).status_code == 200
        # The old access token died with the reset (credential version), and the notice went out.
        old = await client.get(
            "/users/me", headers={"Authorization": f"Bearer {body['tokens']['access_token']}"}
        )
        assert old.status_code == 401
        assert [r.json["subject"] for r in stub.requests][-1] == (
            "Your BodyTrack password was changed"
        )

    @pytest.mark.parametrize(
        "answer",
        [
            Answer(status=429),
            Answer(status=500),
            Answer(status=200, body="not json"),
            Answer(status=200, delay=3),
        ],
        ids=["throttled", "server-error", "malformed", "slow"],
    )
    async def test_a_failing_provider_changes_nothing_the_caller_can_see(
        self,
        client: AsyncClient,
        stub: ResendStub,
        answer: Answer,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        configured = ResendMailer(
            resend_settings(f"http://127.0.0.1:{stub.port}/emails", RESEND_TIMEOUT_SECONDS=0.5)
        )
        app.dependency_overrides[get_mailer] = lambda: configured
        caplog.set_level(logging.DEBUG)
        await _signup(client)

        stub.plan = [answer]
        known = await _ask(client, EMAIL)
        unknown = await _ask(client, "nobody@example.com")

        assert known.status_code == unknown.status_code == 202
        assert known.json() == unknown.json()
        assert "email delivery failed" in caplog.text
        assert_log_is_clean(caplog.text)

    async def test_an_unknown_address_sends_nothing(
        self, client: AsyncClient, resend_mailer: ResendMailer, stub: ResendStub
    ) -> None:
        assert (await _ask(client, "nobody@example.com")).status_code == 202
        assert stub.requests == []

    async def test_the_old_code_dies_when_another_is_requested(
        self, client: AsyncClient, resend_mailer: ResendMailer, stub: ResendStub, rate_limiter: Any
    ) -> None:
        await _signup(client)
        await _ask(client)
        first = code_sent(stub)
        await _skip_cooldown(rate_limiter)
        await _ask(client)

        assert code_sent(stub) != first
        assert (await _reset(client, EMAIL, first)).status_code == 400
        assert (await _reset(client, EMAIL, code_sent(stub))).status_code == 204


class TestTheTransportIsSelectedExplicitly:
    def test_smtp_is_the_default_and_resend_never_takes_over_on_its_own(self) -> None:
        defaults = Settings(
            _env_file=None,
            DATABASE_URL="postgresql+asyncpg://u:p@db/x",
            JWT_SECRET_KEY="k" * 32,
            RESEND_API_KEY=KEY,
        )
        assert defaults.MAIL_TRANSPORT == "smtp"
        assert not defaults.mail_configured  # a key alone does not select Resend

    @pytest.mark.parametrize(
        ("transport", "expected"), [("resend", ResendMailer), ("smtp", SmtpMailer)]
    )
    def test_get_mailer_builds_the_selected_transport(
        self, monkeypatch: pytest.MonkeyPatch, transport: str, expected: type[Mailer]
    ) -> None:
        monkeypatch.setattr("app.core.mailer._mailer", None)
        monkeypatch.setattr("app.core.mailer.settings.MAIL_TRANSPORT", transport)

        assert isinstance(get_mailer(), expected)
