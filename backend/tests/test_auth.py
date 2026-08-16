"""Tests for /auth/register, /auth/login and /auth/refresh."""

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import RefreshToken, User


class TestRegister:
    async def test_creates_account_and_returns_tokens(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        response = await client.post("/auth/register", json=register_payload)

        assert response.status_code == 201, response.text
        body = response.json()
        assert body["user"]["username"] == "efe"
        assert body["user"]["display_name"] == "Efe"
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