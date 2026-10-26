"""Invite-code lookups share their limits through Redis.

The behaviour of the limit itself (ten wrong codes, valid ones free, a parallel
burst cannot overshoot) is covered in test_coaching.py; this file is about what
moved to Redis: counters shared between backend instances, the per-address
bucket, and the failure modes.
"""

from collections.abc import Callable

import pytest
from httpx import AsyncClient
from jose import jwt

from app.core.config import settings
from app.core.ratelimit import RateLimiter, get_rate_limiter
from app.main import app
from tests.test_coaching import _accept, _invite, _preview, _register
from tests.test_ratelimit import DeadRedis, stored_keys

WRONG = "AAAA-AAAA-AAAA"
ClientAt = Callable[[str], AsyncClient]


async def invite_keys(limiter: RateLimiter) -> list[str]:
    return [key for key in await stored_keys(limiter) if ":invite:" in key]


class TestSharedBetweenInstances:
    async def test_two_backend_instances_spend_one_allowance(
        self, client: AsyncClient, rate_limiter: RateLimiter
    ) -> None:
        # Two limiters with separate Redis connections stand in for two backend
        # processes; the only thing they share is Redis.
        athlete = await _register(client, "athlete")
        second = RateLimiter.from_settings(
            rate_limiter._url, rate_limiter.key_prefix  # same Redis, same namespace
        )
        try:
            for _ in range(5):
                assert (await _preview(client, athlete, WRONG)).status_code == 404
            app.dependency_overrides[get_rate_limiter] = lambda: second
            for _ in range(5):
                assert (await _preview(client, athlete, WRONG)).status_code == 404

            from_second = await _preview(client, athlete, WRONG)
            app.dependency_overrides[get_rate_limiter] = lambda: rate_limiter
            from_first = await _accept(client, athlete, WRONG)

            assert from_second.status_code == from_first.status_code == 429
            assert int(from_second.headers["Retry-After"]) >= 1
            assert from_second.json()["detail"].startswith("Too many wrong codes. Try again in ")
        finally:
            await second.aclose()

    async def test_preview_and_accept_spend_the_same_allowance(
        self, client: AsyncClient
    ) -> None:
        athlete = await _register(client, "athlete")
        for n in range(10):
            lookup = _preview if n % 2 else _accept
            assert (await lookup(client, athlete, WRONG)).status_code == 404

        assert (await _preview(client, athlete, WRONG)).status_code == 429
        assert (await _accept(client, athlete, WRONG)).status_code == 429


class TestPerAddressBucket:
    async def test_new_accounts_do_not_multiply_the_guesses_from_one_address(
        self,
        client: AsyncClient,
        client_at: ClientAt,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "RATE_LIMIT_INVITE_IP_LIMIT", 4)
        first = await _register(client, "first")
        second = await _register(client, "second")
        third = await _register(client, "third")

        for headers in (first, first, second, second):
            assert (await _preview(client, headers, WRONG)).status_code == 404

        # `third` has not guessed once, but the address has used its guesses up.
        assert (await _preview(client, third, WRONG)).status_code == 429
        # Someone connecting from elsewhere is untouched.
        elsewhere = client_at("198.51.100.20")
        assert (await _preview(elsewhere, third, WRONG)).status_code == 404

    async def test_one_account_is_limited_by_itself_not_by_a_neighbour(
        self, client: AsyncClient
    ) -> None:
        noisy = await _register(client, "noisy")
        quiet = await _register(client, "quiet")
        for _ in range(10):
            await _preview(client, noisy, WRONG)

        assert (await _preview(client, noisy, WRONG)).status_code == 429
        assert (await _preview(client, quiet, WRONG)).status_code == 404

    async def test_right_codes_cost_neither_bucket(
        self, client: AsyncClient, rate_limiter: RateLimiter
    ) -> None:
        coach = await _register(client, "coach")
        await client.post("/coaching/enable", headers=coach)
        athlete = await _register(client, "athlete")
        code = await _invite(client, coach)

        for _ in range(12):
            assert (await _preview(client, athlete, code)).status_code == 200

        counts = [
            int(await rate_limiter.connection().get(key)) for key in await invite_keys(rate_limiter)
        ]
        assert counts == [0, 0]


class TestNoIdentityFromUnverifiedTokens:
    async def test_a_token_that_does_not_verify_spends_nobody_s_allowance(
        self, client: AsyncClient, rate_limiter: RateLimiter
    ) -> None:
        victim = await _register(client, "victim")
        victim_token = victim["Authorization"].split()[1]
        subject = jwt.get_unverified_claims(victim_token)["sub"]
        forged = jwt.encode(
            {"sub": subject, "type": "access", "exp": 4_000_000_000},
            "an attacker's own signing key!!!!!",
            algorithm="HS256",
        )

        for token in (forged, "garbage", forged[:-3] + "abc"):
            response = await _preview(client, {"Authorization": f"Bearer {token}"}, WRONG)
            assert response.status_code == 401
        missing = await client.post("/coaching/invites/preview", json={"code": WRONG})
        assert missing.status_code == 401

        assert await invite_keys(rate_limiter) == []
        # The victim's own lookups are unaffected.
        assert (await _preview(client, victim, WRONG)).status_code == 404


class TestRedisUnavailable:
    async def test_lookups_answer_503_instead_of_running_unlimited(
        self, client: AsyncClient
    ) -> None:
        athlete = await _register(client, "athlete")
        dead = DeadRedis.refusing_limiter()
        app.dependency_overrides[get_rate_limiter] = lambda: dead

        for lookup in (_preview, _accept):
            response = await lookup(client, athlete, WRONG)
            assert response.status_code == 503
            assert response.headers["Retry-After"] == "10"

        # Everything that does not look a code up carries on.
        assert (await client.get("/users/me", headers=athlete)).status_code == 200
        assert (await client.get("/coaching/coaches", headers=athlete)).status_code == 200
