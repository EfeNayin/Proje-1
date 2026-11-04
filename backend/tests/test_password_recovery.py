"""Password recovery: a code by email, then a new password.

Run through the real app against the real test database, a real Redis for the limiter
and a real SMTP conversation with an in-process test inbox (tests/support/smtp_sink.py).
What matters most: the answer never says whether an address has an account; a code is
single-use, short-lived and limited in guesses even under parallel fire; a completed
reset ends every old token; and nothing secret reaches a response, a log or a table.
Overlapping requests are forced to overlap with pauses inside the transaction that must
be caught mid-way, as in tests/test_account_deletion.py.
"""

import asyncio
import datetime
import ipaddress
import json
import logging
import re
import ssl
from collections.abc import AsyncIterator, Callable
from typing import Any
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient, Response
from jose import jwt
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

import app.core.ratelimit as ratelimit_module
import app.domains.auth.recovery as recovery
import app.domains.auth.service as auth_service
from app.core.config import Settings, settings
from app.core.mailer import SmtpMailer, get_mailer
from app.core.ratelimit import Bucket, RateLimiter, get_rate_limiter
from app.main import app
from tests.support.smtp_sink import SmtpSink
from tests.test_account_deletion import (
    _db_error,
    _mentions,
    _row_counts,
    _users_delete_trigger,
)
from tests.test_ratelimit import DeadRedis, stored_keys

PASSWORD = "supersecret123"
NEW_PASSWORD = "brand-new-pass-9"
REQUEST = "/auth/password-recovery/request"
CONFIRM = "/auth/password-recovery/confirm"
EMAIL = "efe@example.com"


# ── fixtures and helpers ─────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _loggers_enabled() -> None:
    """Alembic's logging setup (run when the test database is built) switches off every
    logger that already exists, which would make the "nothing secret is logged" checks
    pass for the wrong reason."""
    for name in list(logging.root.manager.loggerDict):
        if name.startswith("app"):
            logging.getLogger(name).disabled = False


def _mail_settings(port: int, **overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "SMTP_HOST": "127.0.0.1",
        "SMTP_PORT": port,
        "SMTP_SECURITY": "none",
        "SMTP_TIMEOUT_SECONDS": 2,
        **overrides,
    }
    return Settings(
        _env_file=None,
        DATABASE_URL="postgresql+asyncpg://u:p@db/x",
        JWT_SECRET_KEY=settings.JWT_SECRET_KEY,
        **values,
    )


@pytest.fixture
async def sink() -> AsyncIterator[SmtpSink]:
    inbox = SmtpSink()
    port = await inbox.start()
    inbox.port = port  # type: ignore[attr-defined]
    yield inbox
    await inbox.stop()


@pytest.fixture
async def mailer(sink: SmtpSink, client: AsyncClient) -> SmtpMailer:
    """The app's mailer, pointed at the test inbox."""
    configured = SmtpMailer(_mail_settings(sink.port))  # type: ignore[attr-defined]
    app.dependency_overrides[get_mailer] = lambda: configured
    return configured


async def _signup(client: AsyncClient, email: str = EMAIL, name: str = "efe") -> dict[str, Any]:
    response = await client.post(
        "/auth/register", json={"email": email, "username": name, "password": PASSWORD}
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def _ask(client: AsyncClient, email: str = EMAIL) -> Any:
    return client.post(REQUEST, json={"email": email})


def _reset(client: AsyncClient, email: str, code: str, password: str = NEW_PASSWORD) -> Any:
    return client.post(CONFIRM, json={"email": email, "code": code, "new_password": password})


def _login(client: AsyncClient, password: str, email: str = EMAIL) -> Any:
    return client.post("/auth/login", json={"email": email, "password": password})


def _code_in(sink: SmtpSink, to: str = EMAIL, nth: int = -1) -> str:
    """The code in the nth recovery message to `to`."""
    mails = [m for m in sink.messages if to in m.recipients and "reset code" in m.subject]
    match = re.search(r"\b(\d{4}) (\d{4})\b", mails[nth].body)
    assert match is not None, mails[nth].body
    return match.group(1) + match.group(2)


async def _skip_cooldown(limiter: RateLimiter, email: str = EMAIL) -> None:
    """Let the next request for this address through the resend cooldown (Redis key only)."""
    cooldown = Bucket(
        "recovery-request:cooldown", email, 1, settings.RATE_LIMIT_RECOVERY_RESEND_COOLDOWN_SECONDS
    )
    await limiter.connection().delete(limiter.key_for(cooldown))


async def _fresh_code(
    client: AsyncClient, sink: SmtpSink, limiter: RateLimiter, email: str = EMAIL
) -> str:
    await _skip_cooldown(limiter, email)
    assert (await _ask(client, email)).status_code == 202
    return _code_in(sink, email)


async def _challenge(db: AsyncSession, email: str = EMAIL) -> Any:
    await db.rollback()  # a fresh snapshot
    row = await db.execute(
        text(
            "SELECT c.id, c.code_hash, c.attempts, c.expires_at FROM password_reset_challenges c "
            "JOIN users u ON u.id = c.user_id WHERE u.email = :e"
        ),
        {"e": email},
    )
    return row.first()


async def _scalar(db: AsyncSession, sql: str, **params: Any) -> Any:
    await db.rollback()
    return (await db.execute(text(sql), params)).scalar_one()


# ── the same answer for every address ────────────────────────────────────


class TestRequestAnswersIdentically:
    async def test_known_and_unknown_addresses_get_the_same_response(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink
    ) -> None:
        await _signup(client)

        known = await _ask(client, EMAIL)
        unknown = await _ask(client, "nobody@example.com")

        assert known.status_code == unknown.status_code == 202
        assert known.json() == unknown.json()
        assert set(known.headers) == set(unknown.headers)
        assert known.headers["content-length"] == unknown.headers["content-length"]

    async def test_only_a_registered_address_receives_a_message_and_a_challenge(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink, db: AsyncSession
    ) -> None:
        await _signup(client)
        await _ask(client, EMAIL)
        await _ask(client, "nobody@example.com")

        assert [m.recipients for m in sink.messages] == [[EMAIL]]
        assert await _scalar(db, "SELECT count(*) FROM password_reset_challenges") == 1

    async def test_the_address_is_matched_without_regard_to_case(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink
    ) -> None:
        await _signup(client)

        assert (await _ask(client, "EFE@Example.COM")).status_code == 202
        assert len(sink.messages) == 1

    async def test_the_response_carries_constants_and_never_the_code(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink
    ) -> None:
        await _signup(client)

        response = await _ask(client)

        assert response.json() == {
            "message": "If an account exists for that address, we have sent it a reset code.",
            "code_valid_minutes": settings.PASSWORD_RESET_CODE_TTL_SECONDS // 60,
            "resend_after_seconds": settings.RATE_LIMIT_RECOVERY_RESEND_COOLDOWN_SECONDS,
        }
        assert _code_in(sink) not in response.text

    async def test_a_malformed_address_is_a_422_without_echoing_it(
        self, client: AsyncClient
    ) -> None:
        response = await client.post(REQUEST, json={"email": "not-an-address-xyz"})

        assert response.status_code == 422
        assert "not-an-address-xyz" not in response.text

    async def test_unknown_fields_are_refused(self, client: AsyncClient) -> None:
        response = await client.post(REQUEST, json={"email": EMAIL, "user_id": str(uuid4())})

        assert response.status_code == 422

    async def test_the_response_is_sent_before_the_email(
        self, client: AsyncClient, sink: SmtpSink
    ) -> None:
        """How long the request took must not tell whether a message was sent."""
        await _signup(client)
        gate = asyncio.Event()
        sent: list[int] = []

        class Slow(SmtpMailer):
            async def send(self, to: str, subject: str, body: str) -> bool:
                await gate.wait()
                sent.append(1)
                return True

        app.dependency_overrides[get_mailer] = lambda: Slow(_mail_settings(sink.port))  # type: ignore[attr-defined]
        payload = json.dumps({"email": EMAIL}).encode()
        answered = asyncio.Event()

        async def receive() -> dict[str, Any]:
            return {"type": "http.request", "body": payload, "more_body": False}

        async def send(message: dict[str, Any]) -> None:
            if message["type"] == "http.response.body" and not message.get("more_body"):
                answered.set()

        scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": f"/api/v1{REQUEST}",
            "raw_path": f"/api/v1{REQUEST}".encode(),
            "query_string": b"",
            "headers": [
                (b"host", b"test"),
                (b"content-type", b"application/json"),
                (b"content-length", str(len(payload)).encode()),
            ],
            "client": ("127.0.0.1", 1234),
            "server": ("test", 80),
        }
        running = asyncio.create_task(app(scope, receive, send))  # type: ignore[arg-type]
        await asyncio.wait_for(answered.wait(), 5)

        assert sent == [], "the response was held back until the message was sent"
        gate.set()
        await running
        assert sent == [1]


class TestRequestDoesNotLockAnyoneOut:
    async def test_asking_for_codes_never_counts_against_signing_in(
        self, client: AsyncClient, mailer: SmtpMailer, rate_limiter: RateLimiter
    ) -> None:
        await _signup(client)
        for _ in range(3):
            await _skip_cooldown(rate_limiter)
            await _ask(client)

        for _ in range(settings.RATE_LIMIT_LOGIN_ACCOUNT_IP_LIMIT):
            assert (await _login(client, PASSWORD)).status_code == 200

    async def test_a_pending_code_does_not_change_the_password(
        self, client: AsyncClient, mailer: SmtpMailer
    ) -> None:
        await _signup(client)
        await _ask(client)

        assert (await _login(client, PASSWORD)).status_code == 200


class TestCodeStorage:
    async def test_only_a_keyed_hash_is_stored_never_the_code(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink, db: AsyncSession
    ) -> None:
        await _signup(client)
        await _ask(client)
        code = _code_in(sink)

        stored = await _challenge(db)

        assert re.fullmatch(r"[0-9a-f]{64}", stored.code_hash)
        assert await _mentions(db, code, f"{code[:4]} {code[4:]}") == {}
        # Bound to this challenge and account: not a bare hash of the digits.
        user_id = UUID(await _scalar(db, "SELECT id::text FROM users"))
        assert stored.code_hash == recovery.hash_code(stored.id, user_id, code)
        assert stored.code_hash != recovery.hash_code(uuid4(), user_id, code)
        assert stored.code_hash != recovery.hash_code(stored.id, uuid4(), code)

    async def test_codes_are_eight_digits_and_not_repeated(self) -> None:
        codes = {recovery.new_code() for _ in range(200)}

        assert all(re.fullmatch(r"\d{8}", code) for code in codes)
        assert len(codes) > 190

    async def test_the_code_expires_after_the_configured_lifetime(
        self, client: AsyncClient, mailer: SmtpMailer, db: AsyncSession
    ) -> None:
        await _signup(client)
        await _ask(client)

        seconds = await _scalar(
            db,
            "SELECT extract(epoch FROM expires_at - created_at) FROM password_reset_challenges",
        )

        assert abs(float(seconds) - settings.PASSWORD_RESET_CODE_TTL_SECONDS) < 5

    async def test_the_message_has_the_code_its_lifetime_and_no_link(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink
    ) -> None:
        await _signup(client)
        await _ask(client)

        mail = sink.messages[0]

        assert mail.recipients == [EMAIL]
        assert mail.subject == "Your BodyTrack password reset code"
        assert f"{settings.PASSWORD_RESET_CODE_TTL_SECONDS // 60} minutes" in mail.body
        assert "http" not in mail.body.lower()
        assert PASSWORD not in mail.body


# ── using a code ─────────────────────────────────────────────────────────


class TestResetWithTheRightCode:
    async def test_the_new_password_works_and_the_old_one_does_not(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink
    ) -> None:
        await _signup(client)
        await _ask(client)

        response = await _reset(client, EMAIL, _code_in(sink))

        assert response.status_code == 204
        assert response.content == b""
        assert (await _login(client, PASSWORD)).status_code == 401
        assert (await _login(client, NEW_PASSWORD)).status_code == 200

    async def test_it_does_not_sign_anyone_in(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink, db: AsyncSession
    ) -> None:
        await _signup(client)
        await _ask(client)

        response = await _reset(client, EMAIL, _code_in(sink))

        assert "token" not in response.text.lower()
        # The registration's session is gone and nothing replaced it.
        assert await _scalar(db, "SELECT count(*) FROM refresh_tokens") == 0

    async def test_spaces_and_hyphens_in_the_code_are_ignored(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink
    ) -> None:
        await _signup(client)
        await _ask(client)
        code = _code_in(sink)

        response = await _reset(client, EMAIL, f" {code[:4]}-{code[4:]} ")

        assert response.status_code == 204

    async def test_a_code_is_single_use(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink
    ) -> None:
        await _signup(client)
        await _ask(client)
        code = _code_in(sink)
        assert (await _reset(client, EMAIL, code)).status_code == 204

        replay = await _reset(client, EMAIL, code, "attacker-chosen-1")

        assert replay.status_code == 400
        assert (await _login(client, NEW_PASSWORD)).status_code == 200
        assert (await _login(client, "attacker-chosen-1")).status_code == 401

    async def test_the_code_is_deleted_by_a_successful_reset(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink, db: AsyncSession
    ) -> None:
        await _signup(client)
        await _ask(client)
        await _reset(client, EMAIL, _code_in(sink))

        assert await _challenge(db) is None

    async def test_the_credential_version_moves_on_exactly_once(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink, db: AsyncSession
    ) -> None:
        await _signup(client)
        assert await _scalar(db, "SELECT credential_version FROM users") == 0
        await _ask(client)
        await _reset(client, EMAIL, _code_in(sink))

        assert await _scalar(db, "SELECT credential_version FROM users") == 1


class TestResetFailsTheSameWayEveryTime:
    async def _failures(
        self, client: AsyncClient, sink: SmtpSink, limiter: RateLimiter
    ) -> list[Response]:
        await _signup(client)
        code = await _fresh_code(client, sink, limiter)
        wrong = "00000000" if code != "00000000" else "11111111"
        return [
            await _reset(client, EMAIL, wrong),  # wrong code
            await _reset(client, "nobody@example.com", wrong),  # no such account
            await _reset(client, EMAIL, "12ab"),  # not a code at all
            await _reset(client, "nobody@example.com", "12ab"),
        ]

    async def test_wrong_unknown_and_malformed_look_alike(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink, rate_limiter: RateLimiter
    ) -> None:
        responses = await self._failures(client, sink, rate_limiter)

        assert {r.status_code for r in responses} == {400}
        assert len({r.text for r in responses}) == 1
        assert responses[0].json() == {"detail": recovery.INVALID_CODE_MESSAGE}

    async def test_a_code_does_not_work_for_another_account(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink, rate_limiter: RateLimiter
    ) -> None:
        await _signup(client)
        await _signup(client, "other@example.com", "other")
        code = await _fresh_code(client, sink, rate_limiter, EMAIL)
        await _fresh_code(client, sink, rate_limiter, "other@example.com")

        response = await _reset(client, "other@example.com", code, "attacker-chosen-1")

        assert response.status_code == 400
        assert (await _login(client, PASSWORD, "other@example.com")).status_code == 200
        assert (await _login(client, "attacker-chosen-1", "other@example.com")).status_code == 401

    async def test_an_expired_code_is_refused_even_when_right(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink, db: AsyncSession
    ) -> None:
        await _signup(client)
        await _ask(client)
        await db.execute(
            text("UPDATE password_reset_challenges SET expires_at = now() - interval '1 second'")
        )
        await db.commit()

        response = await _reset(client, EMAIL, _code_in(sink))

        assert response.status_code == 400
        assert (await _login(client, PASSWORD)).status_code == 200

    async def test_a_code_that_expires_while_the_password_is_being_hashed_changes_nothing(
        self,
        client: AsyncClient,
        mailer: SmtpMailer,
        sink: SmtpSink,
        db: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        await _signup(client)
        await _ask(client)
        code = _code_in(sink)
        original = recovery._apply

        async def expire_then_apply(*args: Any, **kwargs: Any) -> Any:
            # The guess has been spent and the code was right; the lifetime runs out before
            # the password is written.
            await db.execute(
                text(
                    "UPDATE password_reset_challenges "
                    "SET expires_at = now() - interval '1 second'"
                )
            )
            await db.commit()
            return await original(*args, **kwargs)

        monkeypatch.setattr(recovery, "_apply", expire_then_apply)

        response = await _reset(client, EMAIL, code)

        assert response.status_code == 400
        assert (await _login(client, PASSWORD)).status_code == 200
        assert (await _login(client, NEW_PASSWORD)).status_code == 401
        version = await _scalar(
            db, "SELECT credential_version FROM users WHERE email = :e", e=EMAIL
        )
        assert version == 0

    async def test_the_code_is_not_a_credential_for_anything_else(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink
    ) -> None:
        await _signup(client)
        await _ask(client)
        code = _code_in(sink)

        assert (
            await client.get("/users/me", headers={"Authorization": f"Bearer {code}"})
        ).status_code == 401
        assert (await client.post("/auth/refresh", json={"refresh_token": code})).status_code == 401
        assert (await _login(client, code)).status_code == 401


class TestAttemptLimits:
    async def test_five_wrong_guesses_use_the_code_up_even_for_the_right_one(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink, db: AsyncSession
    ) -> None:
        await _signup(client)
        await _ask(client)
        code = _code_in(sink)
        wrong = "00000000" if code != "00000000" else "11111111"

        for _ in range(settings.PASSWORD_RESET_MAX_ATTEMPTS):
            assert (await _reset(client, EMAIL, wrong)).status_code == 400
        right = await _reset(client, EMAIL, code)

        assert right.status_code == 400
        assert (await _login(client, PASSWORD)).status_code == 200
        assert (await _challenge(db)).attempts == settings.PASSWORD_RESET_MAX_ATTEMPTS

    async def test_a_new_code_after_exhaustion_works(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink, rate_limiter: RateLimiter
    ) -> None:
        await _signup(client)
        first = await _fresh_code(client, sink, rate_limiter)
        wrong = "00000000" if first != "00000000" else "11111111"
        for _ in range(settings.PASSWORD_RESET_MAX_ATTEMPTS):
            await _reset(client, EMAIL, wrong)
        second = await _fresh_code(client, sink, rate_limiter)

        # The address-level limit (10 per window) is not what ends this: only 5 were spent.
        assert (await _reset(client, EMAIL, second)).status_code == 204

    async def test_parallel_guesses_cannot_overshoot_the_per_code_limit(
        self,
        client: AsyncClient,
        mailer: SmtpMailer,
        sink: SmtpSink,
        db: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        # Let the per-address bucket out of the way so only the per-code limit is tested.
        monkeypatch.setattr(settings, "RATE_LIMIT_RECOVERY_CONFIRM_ACCOUNT_LIMIT", 1000)
        monkeypatch.setattr(settings, "RATE_LIMIT_RECOVERY_CONFIRM_IP_LIMIT", 1000)
        await _signup(client)
        await _ask(client)
        code = _code_in(sink)
        guesses = [f"{n:08d}" for n in range(30) if f"{n:08d}" != code]

        responses = await asyncio.gather(*(_reset(client, EMAIL, guess) for guess in guesses))

        assert {r.status_code for r in responses} == {400}
        assert (await _challenge(db)).attempts == settings.PASSWORD_RESET_MAX_ATTEMPTS
        assert (await _reset(client, EMAIL, code)).status_code == 400

    async def test_the_address_is_limited_across_codes(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink, rate_limiter: RateLimiter
    ) -> None:
        await _signup(client)
        limit = settings.RATE_LIMIT_RECOVERY_CONFIRM_ACCOUNT_LIMIT
        per_code = settings.PASSWORD_RESET_MAX_ATTEMPTS
        statuses = []
        for n in range(limit + 2):
            if n % per_code == 0 and n < limit:
                await _fresh_code(client, sink, rate_limiter)  # a new code, a new 5 guesses
            statuses.append((await _reset(client, EMAIL, "00000000")).status_code)

        assert statuses[:limit] == [400] * limit
        assert statuses[limit:] == [429, 429]

    async def test_unknown_addresses_are_limited_in_the_same_way(self, client: AsyncClient) -> None:
        limit = settings.RATE_LIMIT_RECOVERY_CONFIRM_ACCOUNT_LIMIT

        statuses = [
            (await _reset(client, "nobody@example.com", "00000000")).status_code
            for _ in range(limit + 1)
        ]

        assert statuses == [400] * limit + [429]

    async def test_the_right_code_gives_its_address_attempt_back(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink, rate_limiter: RateLimiter
    ) -> None:
        await _signup(client)
        code = await _fresh_code(client, sink, rate_limiter)
        await _reset(client, EMAIL, code)

        used = await rate_limiter.connection().get(
            rate_limiter.key_for(
                Bucket(
                    "recovery-confirm:account",
                    EMAIL,
                    settings.RATE_LIMIT_RECOVERY_CONFIRM_ACCOUNT_LIMIT,
                    settings.RATE_LIMIT_RECOVERY_CONFIRM_ACCOUNT_WINDOW_SECONDS,
                )
            )
        )
        assert int(used or 0) == 0

    async def test_a_flood_from_one_address_does_not_lock_out_another_requester(
        self,
        client: AsyncClient,
        client_at: Callable[[str], AsyncClient],
        mailer: SmtpMailer,
        sink: SmtpSink,
        rate_limiter: RateLimiter,
    ) -> None:
        await _signup(client)
        code = await _fresh_code(client, sink, rate_limiter)
        flood = client_at("203.0.113.9")
        for n in range(settings.RATE_LIMIT_RECOVERY_CONFIRM_IP_LIMIT + 2):
            await _reset(flood, f"nobody{n}@example.com", "00000000")
        assert (await _reset(flood, EMAIL, code)).status_code == 429

        assert (await _reset(client, EMAIL, code)).status_code == 204


class TestRequestLimits:
    async def test_a_second_request_within_the_cooldown_is_a_429_for_every_address(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink
    ) -> None:
        await _signup(client)

        outcomes = []
        for email in (EMAIL, "nobody@example.com"):
            first = await _ask(client, email)
            second = await _ask(client, email)
            outcomes.append((first.status_code, second.status_code, second.json()["detail"]))

        assert outcomes[0][:2] == outcomes[1][:2] == (202, 429)
        assert outcomes[0][2] == outcomes[1][2]
        assert "Try again in" in outcomes[0][2]
        assert len(sink.messages) == 1, "a refused request sends nothing"

    async def test_the_refusal_carries_a_retry_after(
        self, client: AsyncClient, mailer: SmtpMailer
    ) -> None:
        await _ask(client)

        refused = await _ask(client)

        assert (
            1
            <= int(refused.headers["Retry-After"])
            <= settings.RATE_LIMIT_RECOVERY_RESEND_COOLDOWN_SECONDS
        )

    async def test_an_address_gets_a_bounded_number_of_codes_per_window(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink, rate_limiter: RateLimiter
    ) -> None:
        await _signup(client)
        limit = settings.RATE_LIMIT_RECOVERY_REQUEST_ACCOUNT_LIMIT
        statuses = []
        for _ in range(limit + 2):
            await _skip_cooldown(rate_limiter)
            statuses.append((await _ask(client)).status_code)

        assert statuses == [202] * limit + [429, 429]
        assert len(sink.messages) == limit

    async def test_one_requester_is_limited_across_addresses(
        self, client: AsyncClient, mailer: SmtpMailer
    ) -> None:
        limit = settings.RATE_LIMIT_RECOVERY_REQUEST_IP_LIMIT

        statuses = [
            (await _ask(client, f"user{n}@example.com")).status_code for n in range(limit + 1)
        ]

        assert statuses == [202] * limit + [429]

    async def test_parallel_requests_for_one_address_admit_exactly_one(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink, db: AsyncSession
    ) -> None:
        await _signup(client)

        responses = await asyncio.gather(*(_ask(client) for _ in range(8)))

        assert sorted(r.status_code for r in responses) == [202] + [429] * 7
        assert len(sink.messages) == 1
        assert await _scalar(db, "SELECT count(*) FROM password_reset_challenges") == 1

    async def test_limits_are_shared_between_processes_and_hold_no_identity(
        self, client: AsyncClient, mailer: SmtpMailer, rate_limiter: RateLimiter
    ) -> None:
        await _ask(client)
        # Another worker: its own connection and client, the same Redis namespace.
        other = RateLimiter.from_settings(
            settings.REDIS_URL.rsplit("/", 1)[0] + "/15",
            rate_limiter.key_prefix,
        )
        app.dependency_overrides[get_rate_limiter] = lambda: other
        try:
            refused = await _ask(client)
            keys = await stored_keys(rate_limiter)
        finally:
            await other.aclose()

        assert refused.status_code == 429
        mine = [k for k in keys if "recovery-request" in k]
        assert len(mine) == 3
        assert EMAIL not in " ".join(keys)

    async def test_when_redis_cannot_answer_both_calls_are_503_and_nothing_changes(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink, db: AsyncSession
    ) -> None:
        await _signup(client)
        app.dependency_overrides[get_rate_limiter] = lambda: DeadRedis.refusing_limiter()

        asked = await _ask(client)
        reset = await _reset(client, EMAIL, "12345678")

        assert asked.status_code == reset.status_code == 503
        assert sink.messages == []
        assert await _challenge(db) is None


class TestResend:
    async def test_a_new_code_replaces_the_old_one(
        self,
        client: AsyncClient,
        mailer: SmtpMailer,
        sink: SmtpSink,
        rate_limiter: RateLimiter,
        db: AsyncSession,
    ) -> None:
        await _signup(client)
        first = await _fresh_code(client, sink, rate_limiter)
        second = await _fresh_code(client, sink, rate_limiter)
        assert first != second

        old = await _reset(client, EMAIL, first)
        new = await _reset(client, EMAIL, second)

        assert old.status_code == 400
        assert new.status_code == 204
        assert await _scalar(db, "SELECT count(*) FROM password_reset_challenges") == 0

    async def test_a_new_code_starts_with_a_fresh_guess_count(
        self,
        client: AsyncClient,
        mailer: SmtpMailer,
        sink: SmtpSink,
        rate_limiter: RateLimiter,
        db: AsyncSession,
    ) -> None:
        await _signup(client)
        await _fresh_code(client, sink, rate_limiter)
        await _reset(client, EMAIL, "00000000")
        await _reset(client, EMAIL, "00000001")
        assert (await _challenge(db)).attempts == 2

        await _fresh_code(client, sink, rate_limiter)

        assert (await _challenge(db)).attempts == 0

    async def test_concurrent_requests_leave_one_consistent_code(
        self, client: AsyncClient, db: AsyncSession, db_engine: Any
    ) -> None:
        """The upsert: two codes stored at once leave exactly one row, whose hash matches
        one of the two codes that were generated (never a mixture)."""
        from sqlalchemy.ext.asyncio import async_sessionmaker

        await _signup(client)
        factory = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)

        class Open:
            async def recovery_request(self, email: str) -> None:
                return None

        async def one() -> str:
            async with factory() as session:
                pending = await recovery.request_recovery(
                    session,
                    EMAIL,
                    Open(),  # type: ignore[arg-type]
                    deliver=True,
                )
                assert pending is not None
                return pending.code

        codes = await asyncio.gather(*(one() for _ in range(6)))

        row = await _challenge(db)
        user_id = UUID(await _scalar(db, "SELECT id::text FROM users"))
        assert await _scalar(db, "SELECT count(*) FROM password_reset_challenges") == 1
        assert [c for c in codes if recovery.hash_code(row.id, user_id, c) == row.code_hash]


# ── atomicity and password rules ─────────────────────────────────────────


class TestPasswordRules:
    @pytest.mark.parametrize(
        "bad",
        ["short", "x" * 7, "x" * 73, "ş" * 37, ""],
        ids=["short", "seven", "too-long", "too-many-bytes", "empty"],
    )
    async def test_a_password_the_rules_refuse_is_a_422_that_spends_nothing(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink, db: AsyncSession, bad: str
    ) -> None:
        await _signup(client)
        await _ask(client)
        code = _code_in(sink)

        response = await _reset(client, EMAIL, code, bad)

        assert response.status_code == 422
        assert '"input"' not in response.text
        if bad:
            assert f'"{bad}"' not in response.text
        assert (await _challenge(db)).attempts == 0
        assert (await _reset(client, EMAIL, code)).status_code == 204

    async def test_the_longest_allowed_password_is_kept_whole_not_truncated(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink
    ) -> None:
        await _signup(client)
        await _ask(client)
        longest = "a" * 71 + "b"
        assert (await _reset(client, EMAIL, _code_in(sink), longest)).status_code == 204

        assert (await _login(client, longest)).status_code == 200
        # Two passwords that share their first 71 bytes are not interchangeable.
        assert (await _login(client, "a" * 71 + "c")).status_code == 401
        assert (await _login(client, "a" * 71)).status_code == 401

    async def test_a_two_byte_password_at_the_byte_limit_is_accepted(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink
    ) -> None:
        await _signup(client)
        await _ask(client)
        exact = "ş" * 36  # 72 bytes

        assert (await _reset(client, EMAIL, _code_in(sink), exact)).status_code == 204
        assert (await _login(client, exact)).status_code == 200

    async def test_the_new_password_is_stored_only_as_a_bcrypt_hash(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink, db: AsyncSession
    ) -> None:
        await _signup(client)
        await _ask(client)
        await _reset(client, EMAIL, _code_in(sink))

        assert (await _scalar(db, "SELECT password_hash FROM users")).startswith("$2")
        assert await _mentions(db, NEW_PASSWORD) == {}


@pytest.fixture
async def challenge_delete_trigger(db: AsyncSession) -> AsyncIterator[Callable[[str], Any]]:
    """Run a plpgsql body just before a recovery challenge is deleted (the reset's last step)."""

    async def install(body: str) -> None:
        await db.execute(
            text(
                "CREATE OR REPLACE FUNCTION test_before_challenge_delete() RETURNS trigger AS $$ "
                f"BEGIN {body} RETURN OLD; END $$ LANGUAGE plpgsql"
            )
        )
        await db.execute(
            text(
                "CREATE TRIGGER test_before_challenge_delete BEFORE DELETE "
                "ON password_reset_challenges FOR EACH ROW "
                "EXECUTE FUNCTION test_before_challenge_delete()"
            )
        )
        await db.commit()

    yield install
    await db.rollback()
    await db.execute(
        text("DROP TRIGGER IF EXISTS test_before_challenge_delete ON password_reset_challenges")
    )
    await db.execute(text("DROP FUNCTION IF EXISTS test_before_challenge_delete()"))
    await db.commit()


class TestAtomicity:
    async def test_a_failure_in_the_last_step_changes_nothing(
        self,
        client: AsyncClient,
        mailer: SmtpMailer,
        sink: SmtpSink,
        db: AsyncSession,
        challenge_delete_trigger: Callable[[str], Any],
    ) -> None:
        body = await _signup(client)
        await _ask(client)
        code = _code_in(sink)
        before = await _scalar(db, "SELECT password_hash FROM users")
        await challenge_delete_trigger("RAISE EXCEPTION 'blocked for the test';")

        with pytest.raises(DBAPIError):
            await _reset(client, EMAIL, code)

        # Password, version, session and code are all as they were (the failed try spent
        # one guess, which is the point of spending first).
        assert await _scalar(db, "SELECT password_hash FROM users") == before
        assert await _scalar(db, "SELECT credential_version FROM users") == 0
        assert await _scalar(db, "SELECT count(*) FROM refresh_tokens") == 1
        assert (await _challenge(db)).attempts == 1
        assert (await _login(client, PASSWORD)).status_code == 200
        assert (
            await client.get(
                "/users/me", headers={"Authorization": f"Bearer {body['tokens']['access_token']}"}
            )
        ).status_code == 200

    async def test_a_deadlock_is_retried_and_then_succeeds(
        self,
        client: AsyncClient,
        mailer: SmtpMailer,
        sink: SmtpSink,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        await _signup(client)
        await _ask(client)
        real = recovery._apply
        calls: list[int] = []

        async def flaky(*args: Any) -> None:
            calls.append(1)
            if len(calls) == 1:
                raise _db_error("40P01")
            await real(*args)

        monkeypatch.setattr(recovery, "_apply", flaky)

        assert (await _reset(client, EMAIL, _code_in(sink))).status_code == 204
        assert len(calls) == 2

    async def test_a_deadlock_that_never_clears_says_nothing_was_changed(
        self,
        client: AsyncClient,
        mailer: SmtpMailer,
        sink: SmtpSink,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        await _signup(client)
        await _ask(client)

        async def always(*args: Any) -> None:
            raise _db_error("40P01")

        monkeypatch.setattr(recovery, "_apply", always)

        response = await _reset(client, EMAIL, _code_in(sink))

        assert response.status_code == 503
        assert "Nothing was changed" in response.json()["detail"]
        assert response.headers["Retry-After"] == "5"
        monkeypatch.undo()
        assert (await _login(client, PASSWORD)).status_code == 200


# ── what a reset ends ────────────────────────────────────────────────────


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class TestSessionsEndWithTheReset:
    async def test_old_access_and_refresh_tokens_stop_working_immediately(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink
    ) -> None:
        body = await _signup(client)
        second = (await _login(client, PASSWORD)).json()["tokens"]  # another device
        old = [body["tokens"], second]
        await _ask(client)

        assert (await _reset(client, EMAIL, _code_in(sink))).status_code == 204

        # Straight after, in the same second: no timestamp comparison is involved.
        for tokens in old:
            assert (
                await client.get("/users/me", headers=_bearer(tokens["access_token"]))
            ).status_code == 401
            refreshed = await client.post(
                "/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
            )
            assert refreshed.status_code == 401

    async def test_a_new_login_works_and_its_tokens_are_valid_after_the_reset(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink
    ) -> None:
        await _signup(client)
        await _ask(client)
        await _reset(client, EMAIL, _code_in(sink))

        tokens = (await _login(client, NEW_PASSWORD)).json()["tokens"]

        assert (
            await client.get("/users/me", headers=_bearer(tokens["access_token"]))
        ).status_code == 200
        rotated = await client.post(
            "/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
        )
        assert rotated.status_code == 200
        new_access = rotated.json()["access_token"]
        assert (await client.get("/users/me", headers=_bearer(new_access))).status_code == 200

    async def test_a_token_from_before_credential_versions_is_valid_until_the_first_reset(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink, db: AsyncSession
    ) -> None:
        body = await _signup(client)
        user_id = body["user"]["id"]
        legacy = jwt.encode(
            {"sub": user_id, "type": "access", "jti": str(uuid4()), "exp": 4_000_000_000},
            settings.JWT_SECRET_KEY,
            algorithm=settings.JWT_ALGORITHM,
        )
        assert (await client.get("/users/me", headers=_bearer(legacy))).status_code == 200

        await _ask(client)
        await _reset(client, EMAIL, _code_in(sink))

        assert (await client.get("/users/me", headers=_bearer(legacy))).status_code == 401

    @pytest.mark.parametrize("claim", ["1", True, None, 1.5, -1, 7])
    async def test_a_token_with_the_wrong_version_is_refused(
        self, client: AsyncClient, claim: Any
    ) -> None:
        body = await _signup(client)
        forged = jwt.encode(
            {"sub": body["user"]["id"], "type": "access", "cv": claim, "exp": 4_000_000_000},
            settings.JWT_SECRET_KEY,
            algorithm=settings.JWT_ALGORITHM,
        )

        assert (await client.get("/users/me", headers=_bearer(forged))).status_code == 401

    async def test_a_token_claiming_a_future_version_is_refused(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink
    ) -> None:
        body = await _signup(client)
        await _ask(client)
        await _reset(client, EMAIL, _code_in(sink))  # the account is at version 1 now
        # The same token with the claim edited needs the signing key, which only the
        # server has; an unsigned or re-signed copy is refused by the signature.
        old = body["tokens"]["access_token"]
        claims = jwt.get_unverified_claims(old)
        claims["cv"] = 1
        resigned = jwt.encode(claims, "not-the-servers-secret-" * 3, algorithm="HS256")

        assert (await client.get("/users/me", headers=_bearer(resigned))).status_code == 401

    async def test_a_refresh_token_from_before_the_reset_is_refused_even_if_its_row_survived(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink, db: AsyncSession
    ) -> None:
        # The reset deletes the sessions it can see. A session that was being created while
        # it ran would keep its row, and must still be dead: the token's version is behind.
        body = await _signup(client)
        await _ask(client)
        await _reset(client, EMAIL, _code_in(sink))
        stale = await auth_service._issue_token_pair(
            db, UUID(body["user"]["id"]), credential_version=0
        )
        await db.commit()

        response = await client.post(
            "/auth/refresh", json={"refresh_token": stale.refresh_token}
        )

        assert response.status_code == 401
        assert (
            await client.get("/users/me", headers=_bearer(stale.access_token))
        ).status_code == 401

    async def test_every_refresh_session_of_the_account_is_deleted_and_nobody_elses(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink, db: AsyncSession
    ) -> None:
        await _signup(client)
        other = await _signup(client, "other@example.com", "other")
        await _login(client, PASSWORD)
        await _login(client, PASSWORD, "other@example.com")
        await _ask(client)

        await _reset(client, EMAIL, _code_in(sink))

        mine = await _scalar(
            db,
            "SELECT count(*) FROM refresh_tokens r JOIN users u ON u.id = r.user_id "
            "WHERE u.email = :e",
            e=EMAIL,
        )
        theirs = await _scalar(
            db,
            "SELECT count(*) FROM refresh_tokens r JOIN users u ON u.id = r.user_id "
            "WHERE u.email = 'other@example.com'",
        )
        assert (mine, theirs) == (0, 2)
        assert (
            await client.get("/users/me", headers=_bearer(other["tokens"]["access_token"]))
        ).status_code == 200


class TestOtherAccountsAreUntouched:
    async def test_their_password_code_and_credentials_do_not_change(
        self,
        client: AsyncClient,
        mailer: SmtpMailer,
        sink: SmtpSink,
        rate_limiter: RateLimiter,
        db: AsyncSession,
    ) -> None:
        await _signup(client)
        await _signup(client, "other@example.com", "other")
        mine = await _fresh_code(client, sink, rate_limiter, EMAIL)
        theirs = await _fresh_code(client, sink, rate_limiter, "other@example.com")
        their_hash = await _scalar(
            db, "SELECT password_hash FROM users WHERE email='other@example.com'"
        )

        assert (await _reset(client, EMAIL, mine)).status_code == 204

        assert (
            await _scalar(db, "SELECT password_hash FROM users WHERE email='other@example.com'")
            == their_hash
        )
        assert (
            await _scalar(
                db, "SELECT credential_version FROM users WHERE email='other@example.com'"
            )
            == 0
        )
        assert (await _challenge(db, "other@example.com")).attempts == 0
        assert (await _reset(client, "other@example.com", theirs)).status_code == 204


# ── deleted accounts ─────────────────────────────────────────────────────


class TestDeletedAccounts:
    async def _delete(self, client: AsyncClient, body: dict[str, Any]) -> None:
        response = await client.post(
            "/users/me/delete-account",
            headers=_bearer(body["tokens"]["access_token"]),
            json={"password": PASSWORD},
        )
        assert response.status_code == 204, response.text

    async def test_the_outstanding_code_goes_with_the_account(
        self, client: AsyncClient, mailer: SmtpMailer, db: AsyncSession
    ) -> None:
        body = await _signup(client)
        await _ask(client)
        assert await _scalar(db, "SELECT count(*) FROM password_reset_challenges") == 1

        await self._delete(client, body)

        assert await _scalar(db, "SELECT count(*) FROM password_reset_challenges") == 0

    async def test_recovery_cannot_bring_a_deleted_account_back(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink, db: AsyncSession
    ) -> None:
        body = await _signup(client)
        await _ask(client)
        code = _code_in(sink)
        await self._delete(client, body)
        before = await _row_counts(db)

        asked = await _ask(client)  # (refused by the cooldown, then by lack of an account)
        reset = await _reset(client, EMAIL, code)

        assert asked.status_code in (202, 429)
        assert reset.status_code == 400
        assert reset.json() == {"detail": recovery.INVALID_CODE_MESSAGE}
        assert await _row_counts(db) == before
        assert (await _login(client, NEW_PASSWORD)).status_code == 401
        assert len(sink.messages) == 1, "nothing was sent for the deleted address"

    async def test_a_deletion_that_wins_the_race_leaves_the_reset_with_nothing_to_change(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink, db: AsyncSession
    ) -> None:
        body = await _signup(client)
        await _ask(client)
        code = _code_in(sink)

        async with _users_delete_trigger(db, "PERFORM pg_sleep(1.5);"):
            deleting = asyncio.create_task(
                client.post(
                    "/users/me/delete-account",
                    headers=_bearer(body["tokens"]["access_token"]),
                    json={"password": PASSWORD},
                )
            )
            await asyncio.sleep(0.5)  # the deletion holds the account row
            reset = await _reset(client, EMAIL, code)
            deleted = await deleting

        assert deleted.status_code == 204
        assert reset.status_code == 400
        assert await _scalar(db, "SELECT count(*) FROM users") == 0

    async def test_a_deletion_authorized_before_a_reset_is_refused_after_it(
        self,
        client: AsyncClient,
        mailer: SmtpMailer,
        sink: SmtpSink,
        db: AsyncSession,
        challenge_delete_trigger: Callable[[str], Any],
    ) -> None:
        body = await _signup(client)
        await _ask(client)
        code = _code_in(sink)
        # The reset holds the account row for a moment before it commits.
        await challenge_delete_trigger("PERFORM pg_sleep(1.5);")

        resetting = asyncio.create_task(_reset(client, EMAIL, code))
        await asyncio.sleep(0.6)
        deleting = await client.post(
            "/users/me/delete-account",
            headers=_bearer(body["tokens"]["access_token"]),
            json={"password": PASSWORD},
        )
        reset = await resetting

        assert reset.status_code == 204
        assert deleting.status_code == 401, "stale credentials must not delete the account"
        assert await _scalar(db, "SELECT count(*) FROM users") == 1


# ── races with sign-in, refresh ──────────────────────────────────────────


class TestRacesWithSessions:
    async def test_a_login_that_checked_the_old_password_before_the_reset_is_refused(
        self,
        client: AsyncClient,
        mailer: SmtpMailer,
        sink: SmtpSink,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        await _signup(client)
        await _ask(client)
        code = _code_in(sink)
        reached, release = asyncio.Event(), asyncio.Event()
        real = ratelimit_module.Admission.refund

        async def paused(self: Any) -> None:
            await real(self)
            if self._buckets[0].scope == "login:account-ip":
                reached.set()
                await release.wait()

        monkeypatch.setattr(ratelimit_module.Admission, "refund", paused)

        logging_in = asyncio.create_task(_login(client, PASSWORD))
        await asyncio.wait_for(reached.wait(), 5)  # the old password has been verified
        assert (await _reset(client, EMAIL, code)).status_code == 204
        release.set()
        login = await logging_in

        assert login.status_code == 401
        assert "tokens" not in login.text

    async def test_a_login_in_progress_is_ended_by_the_reset_that_waits_for_it(
        self,
        client: AsyncClient,
        mailer: SmtpMailer,
        sink: SmtpSink,
        monkeypatch: pytest.MonkeyPatch,
        db: AsyncSession,
    ) -> None:
        await _signup(client)
        await _ask(client)
        code = _code_in(sink)
        original = auth_service._issue_token_pair

        async def slow(*args: Any, **kwargs: Any) -> Any:
            pair = await original(*args, **kwargs)
            await asyncio.sleep(0.8)  # tokens issued, not yet committed
            return pair

        monkeypatch.setattr(auth_service, "_issue_token_pair", slow)

        logging_in = asyncio.create_task(_login(client, PASSWORD))
        await asyncio.sleep(0.3)
        reset = await _reset(client, EMAIL, code)  # waits for the login's share lock
        login = await logging_in

        assert (login.status_code, reset.status_code) == (200, 204)
        tokens = login.json()["tokens"]
        # The session that was being created when the reset ran does not survive it.
        assert (
            await client.get("/users/me", headers=_bearer(tokens["access_token"]))
        ).status_code == 401
        refreshed = await client.post(
            "/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
        )
        assert refreshed.status_code == 401
        assert await _scalar(db, "SELECT count(*) FROM refresh_tokens") == 0

    async def test_a_rotation_in_progress_finishes_first_and_its_new_token_goes_too(
        self,
        client: AsyncClient,
        mailer: SmtpMailer,
        sink: SmtpSink,
        monkeypatch: pytest.MonkeyPatch,
        db: AsyncSession,
    ) -> None:
        body = await _signup(client)
        await _ask(client)
        code = _code_in(sink)
        original = auth_service._issue_token_pair

        async def slow(*args: Any, **kwargs: Any) -> Any:
            pair = await original(*args, **kwargs)
            await asyncio.sleep(0.8)
            return pair

        monkeypatch.setattr(auth_service, "_issue_token_pair", slow)

        refreshing = asyncio.create_task(
            client.post("/auth/refresh", json={"refresh_token": body["tokens"]["refresh_token"]})
        )
        await asyncio.sleep(0.3)
        reset = await _reset(client, EMAIL, code)
        rotated = await refreshing

        assert (rotated.status_code, reset.status_code) == (200, 204)
        new = rotated.json()
        assert (
            await client.get("/users/me", headers=_bearer(new["access_token"]))
        ).status_code == 401
        again = await client.post("/auth/refresh", json={"refresh_token": new["refresh_token"]})
        assert again.status_code == 401
        assert await _scalar(db, "SELECT count(*) FROM refresh_tokens") == 0

    async def test_two_resets_with_the_same_code_succeed_exactly_once(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink, db: AsyncSession
    ) -> None:
        await _signup(client)
        await _ask(client)
        code = _code_in(sink)
        passwords = [f"candidate-pass-{n}" for n in range(5)]

        responses = await asyncio.gather(*(_reset(client, EMAIL, code, p) for p in passwords))

        assert sorted(r.status_code for r in responses) == [204] + [400] * 4
        winner = passwords[[r.status_code for r in responses].index(204)]
        assert (await _login(client, winner)).status_code == 200
        for loser in set(passwords) - {winner}:
            assert (await _login(client, loser)).status_code == 401
        assert await _scalar(db, "SELECT credential_version FROM users") == 1


# ── the email adapter ────────────────────────────────────────────────────


class TestDelivery:
    async def test_a_failed_send_does_not_change_the_answer_or_leak(
        self, client: AsyncClient, sink: SmtpSink, caplog: pytest.LogCaptureFixture
    ) -> None:
        await _signup(client)
        sink.reject_with = "451 try again later"
        app.dependency_overrides[get_mailer] = lambda: SmtpMailer(_mail_settings(sink.port))  # type: ignore[attr-defined]
        caplog.set_level(logging.DEBUG)

        known = await _ask(client, EMAIL)
        unknown = await _ask(client, "nobody@example.com")

        assert (known.status_code, known.json()) == (unknown.status_code, unknown.json())
        assert sink.messages == []
        logged = caplog.text
        assert EMAIL not in logged and "nobody@example.com" not in logged
        assert "451" not in logged, "the server's reply is not logged"
        assert "email delivery failed (SMTPDataError)" in logged

    async def test_a_dropped_connection_and_an_unreachable_server_are_just_failures(
        self, client: AsyncClient, sink: SmtpSink, caplog: pytest.LogCaptureFixture
    ) -> None:
        await _signup(client)
        caplog.set_level(logging.DEBUG)
        sink.drop_connection = True
        app.dependency_overrides[get_mailer] = lambda: SmtpMailer(_mail_settings(sink.port))  # type: ignore[attr-defined]
        assert (await _ask(client)).status_code == 202

        app.dependency_overrides[get_mailer] = lambda: SmtpMailer(_mail_settings(1))
        await _skip_cooldown(client_limiter())
        assert (await _ask(client)).status_code == 202

        assert sink.messages == []
        assert "email delivery failed" in caplog.text

    async def test_a_stalled_server_is_given_up_on_within_the_timeout(self, sink: SmtpSink) -> None:
        sink.stall_seconds = 5
        slow = SmtpMailer(_mail_settings(sink.port))  # type: ignore[attr-defined]

        started = asyncio.get_running_loop().time()
        delivered = await slow.send(EMAIL, "s", "b")

        assert delivered is False
        assert asyncio.get_running_loop().time() - started < 4

    async def test_without_smtp_nothing_is_created_sent_or_logged(
        self, client: AsyncClient, db: AsyncSession, caplog: pytest.LogCaptureFixture
    ) -> None:
        await _signup(client)
        unconfigured = SmtpMailer(
            Settings(
                _env_file=None,
                DATABASE_URL="postgresql+asyncpg://u:p@db/x",
                JWT_SECRET_KEY="k" * 32,
            )
        )
        app.dependency_overrides[get_mailer] = lambda: unconfigured
        caplog.set_level(logging.DEBUG)

        response = await _ask(client)

        assert response.status_code == 202
        assert await _challenge(db) is None, "no code is made when it cannot be delivered"
        assert re.search(r"\d{8}", response.text) is None
        assert not re.search(r"\b\d{4} \d{4}\b", caplog.text)

    async def test_concurrent_sends_and_the_waiting_queue_are_bounded(self, sink: SmtpSink) -> None:
        config = _mail_settings(sink.port, SMTP_MAX_CONCURRENT=2, SMTP_MAX_PENDING=5)  # type: ignore[attr-defined]
        mail = SmtpMailer(config)
        running = peak = 0
        original = mail._deliver

        def counting(message: Any) -> None:
            nonlocal running, peak
            running += 1
            peak = max(peak, running)
            try:
                import time

                time.sleep(0.2)
                original(message)
            finally:
                running -= 1

        mail._deliver = counting  # type: ignore[method-assign]

        results = await asyncio.gather(*(mail.send(EMAIL, "s", f"b{n}") for n in range(9)))

        assert peak == 2
        assert results.count(True) == 5 and results.count(False) == 4, "beyond the queue: dropped"
        assert len(sink.messages) == 5

    async def test_a_recipient_cannot_inject_headers(self, sink: SmtpSink) -> None:
        mail = SmtpMailer(_mail_settings(sink.port))  # type: ignore[attr-defined]

        delivered = await mail.send("victim@example.com\r\nBcc: evil@example.com", "s", "b")

        assert delivered is False
        assert sink.messages == []

    async def test_credentials_are_sent_when_configured_and_never_logged(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        inbox = SmtpSink(require_auth=True)
        port = await inbox.start()
        try:
            caplog.set_level(logging.DEBUG)
            mail = SmtpMailer(
                _mail_settings(port, SMTP_USERNAME="mailer", SMTP_PASSWORD="s3cr3t-smtp-pass")
            )
            assert await mail.send(EMAIL, "s", "b") is True
            refused = SmtpMailer(_mail_settings(port, SMTP_USERNAME="mailer"))
            await refused.send(EMAIL, "s", "b")
        finally:
            await inbox.stop()

        assert ("mailer", "s3cr3t-smtp-pass") in inbox.credentials
        assert "s3cr3t-smtp-pass" not in caplog.text
        assert "s3cr3t-smtp-pass" not in repr(
            _mail_settings(port, SMTP_PASSWORD="s3cr3t-smtp-pass")
        )


def client_limiter() -> RateLimiter:
    limiter = app.dependency_overrides[get_rate_limiter]()
    assert isinstance(limiter, RateLimiter)
    return limiter


class TestNotification:
    async def test_the_account_is_told_without_the_password_or_the_code(
        self, client: AsyncClient, mailer: SmtpMailer, sink: SmtpSink
    ) -> None:
        await _signup(client)
        await _ask(client)
        code = _code_in(sink)
        await _reset(client, EMAIL, code)

        notice = sink.messages[-1]

        assert notice.recipients == [EMAIL]
        assert notice.subject == "Your BodyTrack password was changed"
        assert NEW_PASSWORD not in notice.body and PASSWORD not in notice.body
        assert code not in notice.body.replace(" ", "")

    async def test_a_notification_that_cannot_be_delivered_does_not_undo_the_reset(
        self, client: AsyncClient, sink: SmtpSink
    ) -> None:
        await _signup(client)
        app.dependency_overrides[get_mailer] = lambda: SmtpMailer(_mail_settings(sink.port))  # type: ignore[attr-defined]
        await _ask(client)
        code = _code_in(sink)
        sink.reject_with = "554 mailbox unavailable"

        response = await _reset(client, EMAIL, code)

        assert response.status_code == 204
        assert (await _login(client, NEW_PASSWORD)).status_code == 200
        assert (await _login(client, PASSWORD)).status_code == 401


class TestNothingSecretIsLogged:
    async def test_a_whole_recovery_leaves_no_code_password_or_address_in_the_logs(
        self,
        client: AsyncClient,
        sink: SmtpSink,
        rate_limiter: RateLimiter,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        caplog.set_level(logging.DEBUG)
        app.dependency_overrides[get_mailer] = lambda: SmtpMailer(_mail_settings(sink.port))  # type: ignore[attr-defined]
        await _signup(client)
        sink.reject_with = "451 nope"  # so that the mailer has something to log
        await _ask(client)
        sink.reject_with = None
        assert "email delivery failed" in caplog.text, "the check below would prove nothing"
        code = await _fresh_code(client, sink, rate_limiter)
        await _reset(client, EMAIL, "00000000")
        await _reset(client, EMAIL, code, "x")  # a 422
        await _reset(client, EMAIL, code)

        assert code not in caplog.text and f"{code[:4]} {code[4:]}" not in caplog.text
        assert NEW_PASSWORD not in caplog.text
        assert EMAIL not in caplog.text

    def test_the_pending_message_does_not_print_its_code(self) -> None:
        pending = recovery.PendingEmail(to="a@example.com", code="12345678")

        assert "12345678" not in repr(pending) and "a@example.com" not in repr(pending)


# ── transport security ───────────────────────────────────────────────────


def _self_signed(tmp_path: Any) -> tuple[ssl.SSLContext, str]:
    """A server context with a throw-away certificate for 127.0.0.1, and that certificate."""
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID

    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "test-smtp")])
    now = datetime.datetime.now(datetime.UTC)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=1))
        .not_valid_after(now + datetime.timedelta(hours=1))
        .add_extension(
            x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )
    pem = certificate.public_bytes(serialization.Encoding.PEM)
    cert_file = tmp_path / "cert.pem"
    key_file = tmp_path / "key.pem"
    cert_file.write_bytes(pem)
    key_file.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert_file, key_file)
    return context, pem.decode()


class TestTransportSecurity:
    async def _send(self, sink: SmtpSink, **overrides: Any) -> bool:
        port = sink.port  # type: ignore[attr-defined]
        config = _mail_settings(port, **overrides)
        return await SmtpMailer(config).send(EMAIL, "s", "b")

    async def test_starttls_is_required_a_server_that_does_not_offer_it_gets_nothing(
        self, sink: SmtpSink
    ) -> None:
        # The sink offers no STARTTLS (no certificate): plain text must never be the fallback.
        delivered = await self._send(sink, SMTP_SECURITY="starttls")

        assert delivered is False
        assert sink.messages == []

    async def test_a_certificate_that_is_not_trusted_is_refused(self, tmp_path: Any) -> None:
        context, _ = _self_signed(tmp_path)
        inbox = SmtpSink(tls_context=context)
        port = await inbox.start()
        try:
            delivered = await SmtpMailer(_mail_settings(port, SMTP_SECURITY="starttls")).send(
                EMAIL, "s", "b"
            )
        finally:
            await inbox.stop()

        assert delivered is False
        assert inbox.messages == []

    async def test_a_trusted_certificate_is_accepted_and_the_message_arrives_encrypted(
        self, tmp_path: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        context, pem = _self_signed(tmp_path)
        inbox = SmtpSink(tls_context=context, require_auth=True)
        port = await inbox.start()
        real = ssl.create_default_context

        def trusting(*args: Any, **kwargs: Any) -> ssl.SSLContext:
            trusted = real(*args, **kwargs)
            trusted.load_verify_locations(cadata=pem)
            return trusted

        monkeypatch.setattr("app.core.mailer.ssl.create_default_context", trusting)
        try:
            delivered = await SmtpMailer(
                _mail_settings(
                    port,
                    SMTP_SECURITY="starttls",
                    SMTP_USERNAME="mailer",
                    SMTP_PASSWORD="pw-over-tls",
                )
            ).send(EMAIL, "s", "b")
        finally:
            await inbox.stop()

        assert delivered is True
        assert [m.recipients for m in inbox.messages] == [[EMAIL]]
        assert inbox.credentials == [("mailer", "pw-over-tls")]
