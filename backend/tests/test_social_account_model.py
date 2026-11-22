"""The account model behind Google/Apple sign-in, against real PostgreSQL.

Covers the guarantees the flows rely on: a provider identity belongs to one account, an
account has at most one identity per provider, an account may have no password, and the
database (not application code) refuses the second writer of a concurrent first sign-in.
"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession


async def _user(db: AsyncSession, name: str, *, password_hash: str | None = None) -> str:
    row = await db.execute(
        text(
            "INSERT INTO users (email, username, password_hash) " "VALUES (:e, :u, :p) RETURNING id"
        ),
        {"e": f"{name}@example.com", "u": name, "p": password_hash},
    )
    user_id = str(row.scalar_one())
    await db.commit()
    return user_id


async def _identity(
    db: AsyncSession, user_id: str, provider: str, subject: str, **extra: object
) -> None:
    columns = ["user_id", "provider", "subject", *extra]
    placeholders = [":user_id", ":provider", ":subject", *(f":{key}" for key in extra)]
    await db.execute(
        text(
            f"INSERT INTO user_identities ({', '.join(columns)}) "
            f"VALUES ({', '.join(placeholders)})"
        ),
        {"user_id": user_id, "provider": provider, "subject": subject, **extra},
    )
    await db.commit()


class TestAccountWithoutPassword:
    async def test_an_account_can_exist_without_any_password(self, db: AsyncSession) -> None:
        user_id = await _user(db, "providerlifter")
        stored = await db.execute(
            text("SELECT password_hash FROM users WHERE id = :i"), {"i": user_id}
        )
        assert stored.scalar_one() is None

    async def test_existing_password_accounts_keep_their_hash(
        self, client: AsyncClient, db: AsyncSession
    ) -> None:
        response = await client.post(
            "/auth/register",
            json={"email": "old@example.com", "username": "olduser", "password": "supersecret123"},
        )
        assert response.status_code == 201
        stored = await db.execute(
            text("SELECT password_hash FROM users WHERE username = 'olduser'")
        )
        assert str(stored.scalar_one()).startswith("$2")


class TestIdentityKeys:
    async def test_a_provider_account_belongs_to_one_aures_account(self, db: AsyncSession) -> None:
        first = await _user(db, "first")
        second = await _user(db, "second")
        await _identity(db, first, "google", "sub-1")
        with pytest.raises(IntegrityError):
            await _identity(db, second, "google", "sub-1")
        await db.rollback()

    async def test_the_same_subject_at_another_provider_is_a_different_identity(
        self, db: AsyncSession
    ) -> None:
        first = await _user(db, "first")
        second = await _user(db, "second")
        await _identity(db, first, "google", "same-subject")
        await _identity(db, second, "apple", "same-subject")

    async def test_an_account_has_at_most_one_identity_per_provider(self, db: AsyncSession) -> None:
        user_id = await _user(db, "only")
        await _identity(db, user_id, "google", "sub-1")
        with pytest.raises(IntegrityError):
            await _identity(db, user_id, "google", "sub-2")
        await db.rollback()
        await _identity(db, user_id, "apple", "apple-sub")

    async def test_an_unknown_provider_or_an_empty_subject_is_refused(
        self, db: AsyncSession
    ) -> None:
        user_id = await _user(db, "only")
        for provider, subject in (("facebook", "x"), ("google", "")):
            with pytest.raises(IntegrityError):
                await _identity(db, user_id, provider, subject)
            await db.rollback()

    async def test_the_email_a_provider_reports_is_not_a_key(self, db: AsyncSession) -> None:
        first = await _user(db, "first")
        second = await _user(db, "second")
        await _identity(db, first, "google", "sub-1", email="shared@example.com")
        await _identity(db, second, "apple", "sub-2", email="shared@example.com")

    async def test_deleting_the_account_deletes_its_identities(self, db: AsyncSession) -> None:
        user_id = await _user(db, "goner")
        await _identity(db, user_id, "google", "sub-1")
        await db.execute(text("DELETE FROM users WHERE id = :i"), {"i": user_id})
        await db.commit()
        left = await db.execute(text("SELECT count(*) FROM user_identities"))
        assert left.scalar_one() == 0


class TestShortLivedRecords:
    async def test_a_signup_challenge_needs_a_known_provider_and_a_unique_token(
        self, db: AsyncSession
    ) -> None:
        expires = datetime.now(UTC) + timedelta(minutes=10)
        insert = text(
            "INSERT INTO social_signup_challenges (token_hash, provider, subject, expires_at) "
            "VALUES (:t, :p, 's', :e)"
        )
        await db.execute(insert, {"t": "hash-1", "p": "google", "e": expires})
        await db.commit()
        for token, provider in (("hash-1", "google"), ("hash-2", "myspace")):
            with pytest.raises(IntegrityError):
                await db.execute(insert, {"t": token, "p": provider, "e": expires})
                await db.commit()
            await db.rollback()

    async def test_a_nonce_can_be_spent_exactly_once(self, db: AsyncSession) -> None:
        value = uuid4().hex
        await db.execute(
            text("INSERT INTO social_nonces (nonce_hash, expires_at) VALUES (:h, now() + '5 min')"),
            {"h": value},
        )
        await db.commit()
        spend = text(
            "DELETE FROM social_nonces WHERE nonce_hash = :h AND expires_at > now() "
            "RETURNING nonce_hash"
        )
        assert (await db.execute(spend, {"h": value})).first() is not None
        await db.commit()
        assert (await db.execute(spend, {"h": value})).first() is None


class _RecordingMailer:
    """Stands in for the mail transport: delivery is "configured" and every send is kept."""

    enabled = True

    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []

    async def send(self, to: str, subject: str, body: str) -> None:
        self.sent.append((to, subject))


class TestAccountsWithoutAPasswordAreNotReachableByPassword:
    """Audit of every place a password is checked or set, for an account that has none."""

    async def test_signing_in_with_any_password_is_refused_like_a_wrong_password(
        self, client: AsyncClient, db: AsyncSession
    ) -> None:
        await _user(db, "providerlifter")
        wrong = await client.post(
            "/auth/login", json={"email": "nobody@example.com", "password": "whatever-123"}
        )
        passwordless = await client.post(
            "/auth/login", json={"email": "providerlifter@example.com", "password": "whatever-123"}
        )
        assert passwordless.status_code == 401
        assert passwordless.json() == wrong.json() == {"detail": "Invalid email or password"}
        # An empty or absurd password does not get in either.
        for password in ("", "x" * 100):
            response = await client.post(
                "/auth/login",
                json={"email": "providerlifter@example.com", "password": password},
            )
            assert response.status_code == 401

    async def test_recovery_sends_nothing_and_stores_nothing_for_it(
        self, client: AsyncClient, db: AsyncSession
    ) -> None:
        from app.core.mailer import get_mailer
        from app.main import app

        mailer = _RecordingMailer()
        app.dependency_overrides[get_mailer] = lambda: mailer
        await _user(db, "providerlifter")
        await _user(db, "passwordlifter", password_hash="$2b$12$" + "x" * 53)

        for email in ("providerlifter@example.com", "nobody@example.com"):
            response = await client.post("/auth/password-recovery/request", json={"email": email})
            assert response.status_code == 202
        assert mailer.sent == []
        challenges = await db.execute(text("SELECT count(*) FROM password_reset_challenges"))
        assert challenges.scalar_one() == 0

        # A password account is still sent a code (the control for this test).
        response = await client.post(
            "/auth/password-recovery/request", json={"email": "passwordlifter@example.com"}
        )
        assert response.status_code == 202
        assert len(mailer.sent) == 1

    async def test_a_reset_cannot_give_it_a_password(
        self, client: AsyncClient, db: AsyncSession
    ) -> None:
        user_id = await _user(db, "providerlifter")
        # Even a live challenge (it cannot be created through the API) does not help.
        await db.execute(
            text(
                "INSERT INTO password_reset_challenges (user_id, code_hash, expires_at) "
                "VALUES (:u, 'x', now() + '15 min')"
            ),
            {"u": user_id},
        )
        await db.commit()
        response = await client.post(
            "/auth/password-recovery/confirm",
            json={
                "email": "providerlifter@example.com",
                "code": "12345678",
                "new_password": "brand-new-pass-9",
            },
        )
        assert response.status_code == 400
        stored = await db.execute(
            text("SELECT password_hash FROM users WHERE id = :i"), {"i": user_id}
        )
        assert stored.scalar_one() is None

    async def test_deleting_with_a_password_is_refused_and_nothing_is_deleted(
        self, client: AsyncClient, db: AsyncSession
    ) -> None:
        # Signed in the only way an account of this kind can be before the provider flows:
        # a token minted for the row.
        from uuid import UUID

        from app.core.security import create_access_token

        user_id = await _user(db, "providerlifter")
        token = create_access_token(UUID(user_id), 0)
        response = await client.post(
            "/users/me/delete-account",
            headers={"Authorization": f"Bearer {token}"},
            json={"password": "anything-at-all"},
        )
        assert response.status_code == 403
        assert response.json() == {"detail": "Incorrect password"}
        assert (await db.execute(text("SELECT count(*) FROM users"))).scalar_one() == 1
