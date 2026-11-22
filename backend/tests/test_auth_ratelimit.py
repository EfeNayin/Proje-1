"""Rate limits on register, login and refresh, end to end through the API.

The counters are real (Redis, see conftest.rate_limiter); only the limits are
turned down per test so the thresholds can be reached quickly. The defaults are
documented in README.md.
"""

import asyncio
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient, Response
from jose import jwt
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.ratelimit import Bucket, RateLimiter, get_rate_limiter
from app.core.security import create_access_token, verify_password
from app.main import app
from app.models import RefreshToken
from tests.test_ratelimit import DeadRedis, count_of, stored_keys

OWNER = {"email": "owner@example.com", "username": "owner", "password": "supersecret123"}
ClientAt = Callable[[str], AsyncClient]


async def sign_in(client: AsyncClient, email: str, password: str) -> Response:
    return await client.post("/auth/login", json={"email": email, "password": password})


async def register_owner(client: AsyncClient) -> dict[str, object]:
    response = await client.post("/auth/register", json=OWNER)
    assert response.status_code == 201, response.text
    body: dict[str, object] = response.json()
    return body


async def let_every_window_end(limiter: RateLimiter) -> None:
    """Fast-forward: every counter this test made expires in 50 ms."""
    redis = limiter.connection()
    async for key in redis.scan_iter(match=f"{limiter.key_prefix}:*"):
        await redis.pexpire(key, 50)
    await asyncio.sleep(0.15)


def limits(monkeypatch: pytest.MonkeyPatch, **values: int) -> None:
    for name, value in values.items():
        monkeypatch.setattr(settings, f"RATE_LIMIT_{name}", value)


class TestLogin:
    async def test_five_wrong_passwords_then_even_the_right_one_is_refused(
        self, client: AsyncClient, rate_limiter: RateLimiter
    ) -> None:
        await register_owner(client)
        for _ in range(5):
            assert (await sign_in(client, OWNER["email"], "wrong-password")).status_code == 401

        refused = await sign_in(client, OWNER["email"], OWNER["password"])

        assert refused.status_code == 429
        retry_after = int(refused.headers["Retry-After"])
        assert 1 <= retry_after <= settings.RATE_LIMIT_LOGIN_ACCOUNT_IP_WINDOW_SECONDS
        assert refused.json()["detail"].startswith("Too many sign-in attempts. Try again in ")
        # A refusal is not a verdict on the password: nothing about it leaks.
        assert OWNER["email"] not in refused.text and "password" not in refused.json()["detail"]

    async def test_the_account_can_sign_in_again_when_the_window_ends(
        self, client: AsyncClient, rate_limiter: RateLimiter
    ) -> None:
        await register_owner(client)
        for _ in range(5):
            await sign_in(client, OWNER["email"], "wrong-password")
        assert (await sign_in(client, OWNER["email"], OWNER["password"])).status_code == 429

        await let_every_window_end(rate_limiter)

        assert (await sign_in(client, OWNER["email"], OWNER["password"])).status_code == 200

    async def test_a_right_password_gives_its_attempt_back(
        self, client: AsyncClient, rate_limiter: RateLimiter
    ) -> None:
        await register_owner(client)
        for _ in range(4):
            await sign_in(client, OWNER["email"], "wrong-password")
        assert (await sign_in(client, OWNER["email"], OWNER["password"])).status_code == 200

        # Four failures are on the books, not five: one more is still allowed.
        assert (await sign_in(client, OWNER["email"], "wrong-password")).status_code == 401
        assert (await sign_in(client, OWNER["email"], "wrong-password")).status_code == 429

    async def test_a_stranger_cannot_lock_the_owner_out(
        self, client: AsyncClient, client_at: ClientAt, rate_limiter: RateLimiter
    ) -> None:
        await register_owner(client)
        attacker = client_at("203.0.113.9")
        for _ in range(5):
            assert (await sign_in(attacker, OWNER["email"], "guess")).status_code == 401
        assert (await sign_in(attacker, OWNER["email"], "guess")).status_code == 429

        # The attacker filled their own bucket for this account, not the owner's.
        from_elsewhere = await sign_in(client_at("198.51.100.2"), OWNER["email"], OWNER["password"])
        from_home = await sign_in(client, OWNER["email"], OWNER["password"])

        assert from_elsewhere.status_code == 200
        assert from_home.status_code == 200

    async def test_guessing_spread_over_many_addresses_hits_a_ceiling_that_ends_with_its_window(
        self,
        client: AsyncClient,
        client_at: ClientAt,
        rate_limiter: RateLimiter,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        # Documented trade-off: per-address buckets alone would let a botnet guess
        # without limit, so the account has an overall ceiling. Reaching it takes
        # several addresses, and it lasts one window, not forever.
        limits(monkeypatch, LOGIN_ACCOUNT_IP_LIMIT=2, LOGIN_ACCOUNT_LIMIT=4)
        await register_owner(client)
        for address in ("203.0.113.1", "203.0.113.2"):
            for _ in range(2):
                assert (await sign_in(client_at(address), OWNER["email"], "g")).status_code == 401

        blocked = await sign_in(client_at("198.51.100.2"), OWNER["email"], OWNER["password"])
        assert blocked.status_code == 429
        window = settings.RATE_LIMIT_LOGIN_ACCOUNT_WINDOW_SECONDS
        assert int(blocked.headers["Retry-After"]) <= window

        await let_every_window_end(rate_limiter)
        assert (
            await sign_in(client_at("198.51.100.2"), OWNER["email"], OWNER["password"])
        ).status_code == 200

    async def test_requester_flood_is_refused_before_bcrypt_and_spends_no_account_allowance(
        self,
        client: AsyncClient,
        rate_limiter: RateLimiter,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        limits(monkeypatch, LOGIN_IP_LIMIT=3)
        hashed = 0
        real = verify_password

        def counting(*args: str) -> bool:
            nonlocal hashed
            hashed += 1
            return real(*args)

        monkeypatch.setattr("app.domains.auth.service.verify_password", counting)
        await register_owner(client)

        for _ in range(3):
            assert (await sign_in(client, OWNER["email"], "guess")).status_code == 401
        flood = [await sign_in(client, f"other{n}@example.com", "guess") for n in range(10)]
        flood.append(await sign_in(client, OWNER["email"], "guess"))

        assert {response.status_code for response in flood} == {429}
        assert hashed == 3  # the 11 refused requests never reached password hashing
        # Only the first three attempts left anything behind: the requester bucket
        # and the owner's two account buckets (plus the register counter from setup).
        # The refused ones created no keys, and did not add to the owner's counters.
        login_keys = [key for key in await stored_keys(rate_limiter) if ":login:" in key]
        assert len(login_keys) == 3
        owner_bucket = Bucket("login:account", OWNER["email"], 50, 3600)
        assert await count_of(rate_limiter, owner_bucket) == 3

    async def test_unknown_and_existing_accounts_are_limited_and_answered_alike(
        self, client: AsyncClient, client_at: ClientAt
    ) -> None:
        await register_owner(client)

        async def run(email: str, address: str) -> list[tuple[int, bool, str]]:
            seen = []
            for _ in range(7):
                r = await sign_in(client_at(address), email, "wrong-password")
                body = r.json()["detail"]
                said = body.split(" Try again")[0]
                seen.append((r.status_code, "Retry-After" in r.headers, said))
            return seen

        known = await run(OWNER["email"], "203.0.113.10")
        unknown = await run("nobody-here@example.com", "203.0.113.11")

        assert known == unknown
        assert [status for status, _, _ in known] == [401] * 5 + [429] * 2

    async def test_email_case_does_not_make_a_new_bucket(
        self, client: AsyncClient
    ) -> None:
        await register_owner(client)
        variants = ["owner@example.com", "OWNER@example.com", "Owner@Example.com"]
        statuses = [
            (await sign_in(client, variants[n % 3], "wrong-password")).status_code for n in range(7)
        ]

        assert statuses == [401] * 5 + [429] * 2

    async def test_a_parallel_burst_of_wrong_passwords_cannot_overshoot(
        self, client: AsyncClient
    ) -> None:
        await register_owner(client)

        responses = await asyncio.gather(
            *(sign_in(client, OWNER["email"], "wrong-password") for _ in range(25))
        )

        statuses = sorted(response.status_code for response in responses)
        assert statuses == [401] * 5 + [429] * 20

    async def test_forwarding_headers_do_not_choose_the_bucket(
        self,
        client: AsyncClient,
        client_at: ClientAt,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        # Supported model: no proxy in front, the TCP peer is the caller. Headers a
        # caller writes about itself must not move it into a fresh bucket.
        limits(monkeypatch, LOGIN_IP_LIMIT=3)
        statuses = []
        for n in range(8):
            spoof = {
                "X-Forwarded-For": f"10.9.8.{n}",
                "X-Real-IP": f"10.7.7.{n}",
                "Forwarded": f"for=10.6.6.{n}",
                "CF-Connecting-IP": f"10.5.5.{n}",
            }
            r = await client.post(
                "/auth/login",
                json={"email": f"who{n}@example.com", "password": "guess"},
                headers=spoof,
            )
            statuses.append(r.status_code)

        assert statuses == [401] * 3 + [429] * 5
        # A genuinely different peer is a different requester.
        other = await sign_in(client_at("198.51.100.77"), "who@example.com", "guess")
        assert other.status_code == 401

    async def test_a_burst_of_bad_bodies_is_counted_too(
        self, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        limits(monkeypatch, LOGIN_IP_LIMIT=2)

        statuses = [
            (await client.post("/auth/login", json={"email": "not-an-email"})).status_code
            for _ in range(4)
        ]

        assert statuses == [422, 422, 429, 429]


class TestRegister:
    async def test_registrations_from_one_address_are_capped_whatever_their_outcome(
        self,
        client: AsyncClient,
        client_at: ClientAt,
        rate_limiter: RateLimiter,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        limits(monkeypatch, REGISTER_IP_LIMIT=3)

        def body(name: str) -> dict[str, str]:
            return {"email": f"{name}@example.com", "username": name, "password": "supersecret123"}

        first = await client.post("/auth/register", json=body("first"))
        taken = await client.post("/auth/register", json=body("first"))  # 409 still counts
        second = await client.post("/auth/register", json=body("second"))
        refused = await client.post("/auth/register", json=body("third"))

        assert [first.status_code, taken.status_code, second.status_code] == [201, 409, 201]
        assert refused.status_code == 429
        window = settings.RATE_LIMIT_REGISTER_IP_WINDOW_SECONDS
        assert 1 <= int(refused.headers["Retry-After"]) <= window
        assert refused.json()["detail"].startswith("Too many sign-up attempts.")
        # Another address is unaffected, and the refused account was never created.
        assert (await client_at("198.51.100.5").post("/auth/register", json=body("third"))
                ).status_code == 201

    async def test_login_and_register_have_separate_allowances(
        self, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        limits(monkeypatch, LOGIN_IP_LIMIT=1, REGISTER_IP_LIMIT=1)
        assert (await sign_in(client, "x@example.com", "guess")).status_code == 401
        assert (await sign_in(client, "x@example.com", "guess")).status_code == 429

        assert (await client.post("/auth/register", json=OWNER)).status_code == 201


class TestRefresh:
    @staticmethod
    async def refresh(client: AsyncClient, token: str) -> Response:
        return await client.post("/auth/refresh", json={"refresh_token": token})

    @staticmethod
    def forged_refresh_token(user_id: str) -> str:
        now = datetime.now(UTC)
        claims = {
            "sub": user_id,
            "type": "refresh",
            "jti": str(uuid4()),
            "iat": now,
            "exp": now + timedelta(days=1),
        }
        return jwt.encode(claims, "an attacker's own signing key!!!!!", algorithm="HS256")

    async def test_the_requester_bucket_counts_every_refresh_attempt(
        self, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        limits(monkeypatch, REFRESH_IP_LIMIT=3)

        statuses = [(await self.refresh(client, "garbage")).status_code for _ in range(5)]

        assert statuses == [401, 401, 401, 429, 429]

    async def test_one_account_can_only_refresh_so_often_and_a_refusal_keeps_the_token_valid(
        self,
        client: AsyncClient,
        db: AsyncSession,
        rate_limiter: RateLimiter,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        limits(monkeypatch, REFRESH_USER_LIMIT=2)
        tokens = (await register_owner(client))["tokens"]
        assert isinstance(tokens, dict)
        refresh_token = tokens["refresh_token"]

        for _ in range(2):
            rotated = await self.refresh(client, refresh_token)
            assert rotated.status_code == 200
            refresh_token = rotated.json()["refresh_token"]

        refused = await self.refresh(client, refresh_token)

        assert refused.status_code == 429
        window = settings.RATE_LIMIT_REFRESH_USER_WINDOW_SECONDS
        assert 1 <= int(refused.headers["Retry-After"]) <= window
        # The refusal came before the token was touched: not revoked, not rotated,
        # and not mistaken for a replay (which would sign the account out everywhere).
        live = await db.scalar(
            select(func.count()).select_from(RefreshToken).where(RefreshToken.revoked_at.is_(None))
        )
        assert live == 1
        await let_every_window_end(rate_limiter)
        assert (await self.refresh(client, refresh_token)).status_code == 200

    async def test_a_token_that_does_not_verify_never_supplies_an_identity(
        self,
        client: AsyncClient,
        rate_limiter: RateLimiter,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        limits(monkeypatch, REFRESH_USER_LIMIT=2)
        registered = await register_owner(client)
        owner_id = str(registered["user"]["id"])  # type: ignore[index]
        owner_tokens = registered["tokens"]
        assert isinstance(owner_tokens, dict)

        expired = jwt.encode(
            {"sub": owner_id, "type": "refresh", "exp": datetime.now(UTC) - timedelta(hours=1)},
            settings.JWT_SECRET_KEY,
            algorithm=settings.JWT_ALGORITHM,
        )
        attempts = [
            *(self.forged_refresh_token(owner_id) for _ in range(5)),  # wrong signing key
            expired,  # right key, but expired
            create_access_token(UUID(owner_id)),  # right key, but an access token
            "not even a token",
        ]
        for attempt in attempts:
            assert (await self.refresh(client, attempt)).status_code == 401

        # None of that touched the owner's own allowance...
        owner_bucket = Bucket("refresh:user", owner_id, 2, 600)
        assert await count_of(rate_limiter, owner_bucket) == 0
        # ...so the owner's real refresh is still admitted.
        assert (await self.refresh(client, owner_tokens["refresh_token"])).status_code == 200
        assert await count_of(rate_limiter, owner_bucket) == 1

    async def test_rotation_and_replay_detection_still_work_under_the_limiter(
        self, client: AsyncClient
    ) -> None:
        tokens = (await register_owner(client))["tokens"]
        assert isinstance(tokens, dict)
        first = tokens["refresh_token"]
        second = (await self.refresh(client, first)).json()["refresh_token"]

        replay = await self.refresh(client, first)

        assert replay.status_code == 401
        assert "already used" in replay.json()["detail"]
        assert (await self.refresh(client, second)).status_code == 401  # all sessions gone


class TestOnlyTheAuthEndpointsAreLimited:
    async def test_health_logout_and_ordinary_routes_do_not_touch_the_counters(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        rate_limiter: RateLimiter,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        # auth_headers registered one account, which left its register counter.
        before = set(await stored_keys(rate_limiter))
        limits(monkeypatch, LOGIN_IP_LIMIT=1, REGISTER_IP_LIMIT=1, REFRESH_IP_LIMIT=1)

        for _ in range(30):
            assert (await client.get("http://test/health")).status_code == 200
            assert (await client.get("/users/me", headers=auth_headers)).status_code == 200
        logout = await client.post("/auth/logout", json={"refresh_token": "whatever"})

        assert logout.status_code == 204
        assert set(await stored_keys(rate_limiter)) == before


class TestRedisUnavailable:
    @pytest.fixture
    async def signed_up(self, client: AsyncClient) -> dict[str, object]:
        return await register_owner(client)

    @pytest.fixture
    def redis_down(self) -> RateLimiter:
        dead = DeadRedis.refusing_limiter()
        app.dependency_overrides[get_rate_limiter] = lambda: dead
        return dead

    async def test_the_limited_endpoints_answer_503_and_admit_nobody(
        self,
        client: AsyncClient,
        db: AsyncSession,
        signed_up: dict[str, object],
        redis_down: RateLimiter,
    ) -> None:
        tokens = signed_up["tokens"]
        assert isinstance(tokens, dict)
        sessions_before = await db.scalar(select(func.count()).select_from(RefreshToken))

        correct_password = await sign_in(client, OWNER["email"], OWNER["password"])
        new_account = await client.post(
            "/auth/register",
            json={"email": "new@example.com", "username": "newbie", "password": "supersecret123"},
        )
        refresh = await client.post(
            "/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
        )

        for response in (correct_password, new_account, refresh):
            assert response.status_code == 503
            assert response.headers["Retry-After"] == "10"
            assert response.json() == {
                "detail": "The service is temporarily unavailable. Try again in a moment."
            }
        # Nothing slipped through: no session was issued, no account was made.
        assert await db.scalar(select(func.count()).select_from(RefreshToken)) == sessions_before
        assert (
            await db.scalar(
                select(func.count()).select_from(RefreshToken).where(RefreshToken.revoked_at.is_(None))
            )
            == sessions_before
        )

    async def test_unrelated_routes_keep_working(
        self,
        client: AsyncClient,
        signed_up: dict[str, object],
        redis_down: RateLimiter,
    ) -> None:
        tokens = signed_up["tokens"]
        assert isinstance(tokens, dict)
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}

        assert (await client.get("http://test/health")).status_code == 200
        assert (await client.get("/users/me", headers=headers)).status_code == 200
        assert (await client.get("/exercises?q=bench", headers=headers)).status_code == 200
        logout = await client.post("/auth/logout", json={"refresh_token": tokens["refresh_token"]})
        assert logout.status_code == 204
