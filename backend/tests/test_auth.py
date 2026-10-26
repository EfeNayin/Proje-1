"""Tests for /auth/register, /auth/login and /auth/refresh."""

import asyncio
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import verify_password
from app.domains.auth.schemas import TokenPair
from app.models import RefreshToken, User


class TestRegister:
    async def test_creates_account_and_returns_tokens(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        response = await client.post("/auth/register", json=register_payload)

        assert response.status_code == 201, response.text
        body = response.json()
        assert body["user"]["username"] == "efe"
        assert body["user"]["first_name"] == "Efe"
        assert body["user"]["last_name"] is None
        assert body["tokens"]["access_token"]
        assert body["tokens"]["refresh_token"]
        assert body["tokens"]["token_type"] == "bearer"

    async def test_privacy_defaults_to_private(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        """Social features are opt-in; a new account must not be public."""
        response = await client.post("/auth/register", json=register_payload)
        assert response.json()["user"]["is_private"] is True

    async def test_defaults_for_unit_timezone_and_locale(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        user = (await client.post("/auth/register", json=register_payload)).json()["user"]
        assert user["weight_unit"] == "kg"
        assert user["timezone"] == "Europe/Istanbul"
        assert user["locale"] == "tr"

    async def test_password_is_never_stored_in_plaintext(
        self, client: AsyncClient, db: AsyncSession, register_payload: dict[str, str]
    ) -> None:
        await client.post("/auth/register", json=register_payload)

        user = await db.scalar(select(User).where(User.username == "efe"))
        assert user is not None
        assert user.password_hash != register_payload["password"]
        assert user.password_hash.startswith("$2b$")  # bcrypt

    async def test_duplicate_email_is_rejected_case_insensitively(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        """email is CITEXT, so casing must not create a second account."""
        await client.post("/auth/register", json=register_payload)

        shouting = {**register_payload, "email": "EFE@EXAMPLE.COM", "username": "other"}
        response = await client.post("/auth/register", json=shouting)

        assert response.status_code == 409

    async def test_duplicate_username_is_rejected_case_insensitively(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        await client.post("/auth/register", json=register_payload)

        response = await client.post(
            "/auth/register",
            json={**register_payload, "email": "other@example.com", "username": "EFE"},
        )

        assert response.status_code == 409

    async def test_conflict_does_not_reveal_which_field_collided(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        """Naming the field would let anyone probe which emails are registered."""
        await client.post("/auth/register", json=register_payload)

        response = await client.post(
            "/auth/register", json={**register_payload, "username": "other"}
        )

        detail = response.json()["detail"].lower()
        assert "email" in detail and "username" in detail

    async def test_rejects_password_over_72_bytes(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        """bcrypt truncates past 72 bytes, which would make long passwords
        interchangeable. 72 Turkish characters are 138 bytes."""
        turkish = "ğüşiöçĞÜŞİÖÇ" * 6
        assert len(turkish) == 72
        assert len(turkish.encode("utf-8")) > 72

        response = await client.post(
            "/auth/register", json={**register_payload, "password": turkish}
        )

        assert response.status_code == 422

    async def test_rejects_short_password(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        response = await client.post(
            "/auth/register", json={**register_payload, "password": "short"}
        )
        assert response.status_code == 422

    async def test_rejects_username_with_spaces_or_symbols(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        response = await client.post(
            "/auth/register", json={**register_payload, "username": "ge çersiz!"}
        )
        assert response.status_code == 422

    async def test_accepts_explicit_timezone_and_locale(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        response = await client.post(
            "/auth/register",
            json={**register_payload, "timezone": "America/New_York", "locale": "en"},
        )

        assert response.status_code == 201
        user = response.json()["user"]
        assert user["timezone"] == "America/New_York"
        assert user["locale"] == "en"

    async def test_rejects_unknown_timezone(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        """An unvalidated value would only fail much later, inside the
        analytics query where PostgreSQL evaluates AT TIME ZONE."""
        response = await client.post(
            "/auth/register", json={**register_payload, "timezone": "Mars/Olympus"}
        )
        assert response.status_code == 422

    async def test_rejects_unsupported_locale(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        response = await client.post(
            "/auth/register", json={**register_payload, "locale": "de"}
        )
        assert response.status_code == 422


class TestLogin:
    async def test_succeeds_with_correct_credentials(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        await client.post("/auth/register", json=register_payload)

        response = await client.post(
            "/auth/login",
            json={"email": register_payload["email"], "password": register_payload["password"]},
        )

        assert response.status_code == 200, response.text
        assert response.json()["tokens"]["access_token"]

    async def test_works_immediately_after_register(
        self, client: AsyncClient, db: AsyncSession, register_payload: dict[str, str]
    ) -> None:
        """Regression: tokens carried no jti, so two issued in the same second
        were byte-identical and collided on refresh_tokens.token_hash."""
        await client.post("/auth/register", json=register_payload)

        response = await client.post(
            "/auth/login",
            json={"email": register_payload["email"], "password": register_payload["password"]},
        )

        assert response.status_code == 200, response.text
        # Two independent sessions must now exist.
        assert await db.scalar(select(func.count()).select_from(RefreshToken)) == 2

    async def test_email_casing_does_not_matter(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        await client.post("/auth/register", json=register_payload)

        response = await client.post(
            "/auth/login",
            json={"email": "EFE@EXAMPLE.COM", "password": register_payload["password"]},
        )

        assert response.status_code == 200

    async def test_wrong_password_is_rejected(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        await client.post("/auth/register", json=register_payload)

        response = await client.post(
            "/auth/login",
            json={"email": register_payload["email"], "password": "wrong-password"},
        )

        assert response.status_code == 401

    async def test_unknown_email_gives_the_same_error_as_wrong_password(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        """Different messages would turn login into an account-existence oracle."""
        await client.post("/auth/register", json=register_payload)

        wrong_password = await client.post(
            "/auth/login",
            json={"email": register_payload["email"], "password": "wrong-password"},
        )
        unknown_email = await client.post(
            "/auth/login",
            json={"email": "nobody@example.com", "password": register_payload["password"]},
        )

        assert wrong_password.status_code == unknown_email.status_code == 401
        assert wrong_password.json()["detail"] == unknown_email.json()["detail"]


    async def test_unknown_email_costs_the_same_password_verification(
        self,
        client: AsyncClient,
        register_payload: dict[str, str],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Answering at once for an unknown email would reveal it is unregistered
        through response time even though the messages match. Wall-clock time is
        too noisy to assert, so this counts the bcrypt verifications instead."""
        await client.post("/auth/register", json=register_payload)
        seen: list[str] = []

        def spy(plain: str, password_hash: str) -> bool:
            seen.append(password_hash)
            return verify_password(plain, password_hash)

        monkeypatch.setattr("app.domains.auth.service.verify_password", spy)

        unknown = await client.post(
            "/auth/login", json={"email": "nobody@example.com", "password": "wrong-password"}
        )
        known = await client.post(
            "/auth/login",
            json={"email": register_payload["email"], "password": "wrong-password"},
        )

        assert unknown.status_code == known.status_code == 401
        assert len(seen) == 2
        assert seen[0] != seen[1]  # a throwaway hash, not the real account's
        assert seen[0].startswith("$2")  # a real bcrypt hash, so the work is the same

    async def test_overlong_password_is_a_client_error_not_a_server_error(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        """passlib refuses secrets over 4096 characters; that used to be a 500."""
        await client.post("/auth/register", json=register_payload)

        response = await client.post(
            "/auth/login",
            json={"email": register_payload["email"], "password": "A" * 100_000},
        )

        assert response.status_code == 422

    async def test_password_longer_than_the_bcrypt_limit_cannot_match_by_prefix(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        """bcrypt compares only the first 72 bytes, so the right password plus
        any suffix used to log in."""
        register_payload["password"] = "Aa1-" + "x" * 68  # exactly 72 bytes
        assert (await client.post("/auth/register", json=register_payload)).status_code == 201

        exact = await client.post(
            "/auth/login",
            json={"email": register_payload["email"], "password": register_payload["password"]},
        )
        with_suffix = await client.post(
            "/auth/login",
            json={
                "email": register_payload["email"],
                "password": register_payload["password"] + "extra",
            },
        )

        assert exact.status_code == 200
        assert with_suffix.status_code == 401


class TestRefresh:
    async def test_returns_a_new_pair(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        tokens = (await client.post("/auth/register", json=register_payload)).json()["tokens"]

        response = await client.post(
            "/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
        )

        assert response.status_code == 200, response.text
        assert response.json()["refresh_token"] != tokens["refresh_token"]

    async def test_old_token_is_revoked_after_rotation(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        tokens = (await client.post("/auth/register", json=register_payload)).json()["tokens"]
        await client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})

        replay = await client.post(
            "/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
        )

        assert replay.status_code == 401

    async def test_replay_revokes_every_session(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        """A used token showing up again suggests it was stolen, so every
        session for that account is dropped rather than just this one."""
        first = (await client.post("/auth/register", json=register_payload)).json()["tokens"]
        second = (
            await client.post("/auth/refresh", json={"refresh_token": first["refresh_token"]})
        ).json()

        # Replay the already-rotated token.
        await client.post("/auth/refresh", json={"refresh_token": first["refresh_token"]})

        # The currently valid one must now be dead too.
        response = await client.post(
            "/auth/refresh", json={"refresh_token": second["refresh_token"]}
        )
        assert response.status_code == 401

    async def test_access_token_cannot_be_used_to_refresh(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        tokens = (await client.post("/auth/register", json=register_payload)).json()["tokens"]

        response = await client.post(
            "/auth/refresh", json={"refresh_token": tokens["access_token"]}
        )

        assert response.status_code == 401

    async def test_garbage_token_is_rejected(self, client: AsyncClient) -> None:
        response = await client.post("/auth/refresh", json={"refresh_token": "not.a.token"})
        assert response.status_code == 401

    async def test_stores_only_the_hash_of_the_refresh_token(
        self, client: AsyncClient, db: AsyncSession, register_payload: dict[str, str]
    ) -> None:
        """If the database leaks, the tokens themselves must still be useless."""
        tokens = (await client.post("/auth/register", json=register_payload)).json()["tokens"]

        stored = await db.scalar(select(RefreshToken))
        assert stored is not None
        assert stored.token_hash != tokens["refresh_token"]
        assert len(stored.token_hash) == 64  # sha256 hex


class TestLogout:
    async def _second_session(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> dict[str, str]:
        response = await client.post(
            "/auth/login",
            json={"email": register_payload["email"], "password": register_payload["password"]},
        )
        assert response.status_code == 200, response.text
        tokens: dict[str, str] = response.json()["tokens"]
        return tokens

    async def test_the_refresh_token_stops_working(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        tokens = (await client.post("/auth/register", json=register_payload)).json()["tokens"]

        response = await client.post(
            "/auth/logout", json={"refresh_token": tokens["refresh_token"]}
        )
        assert response.status_code == 204
        assert response.content == b""

        refreshed = await client.post(
            "/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
        )
        assert refreshed.status_code == 401

    async def test_other_sessions_of_the_account_survive(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        """Logging out one device is not "log out everywhere", and a late
        refresh from the device that just left must not look like token theft."""
        phone = (await client.post("/auth/register", json=register_payload)).json()["tokens"]
        tablet = await self._second_session(client, register_payload)

        await client.post("/auth/logout", json={"refresh_token": phone["refresh_token"]})
        # A refresh already in flight from the signed-out device arrives afterwards.
        late = await client.post("/auth/refresh", json={"refresh_token": phone["refresh_token"]})
        assert late.status_code == 401
        assert "already used" not in late.json()["detail"]

        still_alive = await client.post(
            "/auth/refresh", json={"refresh_token": tablet["refresh_token"]}
        )
        assert still_alive.status_code == 200, still_alive.text

    async def test_it_only_removes_the_presented_token(
        self, client: AsyncClient, db: AsyncSession, register_payload: dict[str, str]
    ) -> None:
        phone = (await client.post("/auth/register", json=register_payload)).json()["tokens"]
        await self._second_session(client, register_payload)
        assert await db.scalar(select(func.count()).select_from(RefreshToken)) == 2

        await client.post("/auth/logout", json={"refresh_token": phone["refresh_token"]})

        db.expire_all()
        assert await db.scalar(select(func.count()).select_from(RefreshToken)) == 1

    async def test_it_is_idempotent_and_does_not_reveal_whether_a_token_was_real(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        tokens = (await client.post("/auth/register", json=register_payload)).json()["tokens"]

        for presented in (
            tokens["refresh_token"],
            tokens["refresh_token"],  # again, now already gone
            "not.a.token",
            "",
        ):
            response = await client.post("/auth/logout", json={"refresh_token": presented})
            assert response.status_code == 204, presented

    async def test_an_access_token_cannot_be_used_to_log_a_session_out(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        tokens = (await client.post("/auth/register", json=register_payload)).json()["tokens"]

        response = await client.post("/auth/logout", json={"refresh_token": tokens["access_token"]})
        assert response.status_code == 204

        refreshed = await client.post(
            "/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
        )
        assert refreshed.status_code == 200

    async def test_an_issued_access_token_stays_valid_until_it_expires(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        """Documents the revocation window: access tokens are stateless, so logout
        ends the ability to renew, not the token already in hand."""
        tokens = (await client.post("/auth/register", json=register_payload)).json()["tokens"]
        await client.post("/auth/logout", json={"refresh_token": tokens["refresh_token"]})

        response = await client.get(
            "/users/me", headers={"Authorization": f"Bearer {tokens['access_token']}"}
        )
        assert response.status_code == 200

    async def test_a_body_is_required(self, client: AsyncClient) -> None:
        assert (await client.post("/auth/logout", json={})).status_code == 422


class TestConcurrentRefresh:
    """Regression tests for the race fixed in Adım 19 (PROJE_1_CODEX_INCELEME.md):
    `refresh()` now takes a row lock (`SELECT ... FOR UPDATE`) on the presented
    refresh token before checking `revoked_at`.

    Same shape as the Adım 18 workout race, and the same testing lesson
    applies: a bare `asyncio.gather` of two requests against a fast local
    database does not reliably interleave two SQL statements just because
    the two coroutines are concurrent — it was checked by hand and found to
    pass whether or not the lock existed, so it proves nothing on its own.
    `monkeypatch` injects a real `await asyncio.sleep()` between reading the
    token and committing the rotation, widening the race window to
    something the scheduler cannot dodge; both directions (fails without
    the fix, passes with it) were checked by hand before this was kept.
    """

    async def test_replaying_the_same_token_concurrently_still_gets_caught(
        self,
        client: AsyncClient,
        db: AsyncSession,
        register_payload: dict[str, str],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Before the fix: two requests presenting the same still-valid token
        at the same moment (a dropped-response retry, or a stolen token
        raced against the legitimate device) would both read `revoked_at IS
        NULL` before either commits, and both would rotate successfully —
        two live token pairs minted from one input, and the replay check
        below never triggers for either. With the fix, the second request's
        lock acquisition waits for the first's entire transaction, so it
        always sees the already-used token and takes the theft-response
        branch — which revokes every token for the account, including the
        one the "winning" request just received a moment before.
        """
        import app.domains.auth.service as auth_service

        original_issue_token_pair = auth_service._issue_token_pair

        async def slow_issue_token_pair(db: AsyncSession, user_id: UUID) -> TokenPair:
            pair = await original_issue_token_pair(db, user_id)
            await asyncio.sleep(0.3)
            return pair

        monkeypatch.setattr(auth_service, "_issue_token_pair", slow_issue_token_pair)

        tokens = (await client.post("/auth/register", json=register_payload)).json()["tokens"]

        first, second = await asyncio.gather(
            client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]}),
            client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]}),
        )

        assert sorted([first.status_code, second.status_code]) == [200, 401]

        user = await db.scalar(select(User).where(User.email == register_payload["email"]))
        assert user is not None
        active_count = await db.scalar(
            select(func.count())
            .select_from(RefreshToken)
            .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
        )
        # Every token for the account — including the pair the "winning"
        # request just received — was revoked once the replay was detected.
        assert active_count == 0