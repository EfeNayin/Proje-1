"""Sign in with Google and Apple: the account flows, through the real app and database.

The providers are faked at their boundary (tests/support/fake_social.py); what is under test is
what an identity means for an account. The properties that matter most: an email never selects
or links an account, nothing is created before onboarding finishes, a provider account belongs
to exactly one Aures account, concurrent attempts leave exactly one winner and no orphan, a
credential works once, and an account without a password is never reachable by one.
"""

import asyncio
import logging
from collections.abc import AsyncIterator
from typing import Any

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import hash_token
from app.domains.auth.social_deps import get_social
from app.main import app
from tests.support.fake_social import (
    FakeProviders,
    apple_token,
    google_code,
    make_social,
    notice,
)

PASSWORD = "supersecret123"
LOGIN = "/auth/social/login"
COMPLETE = "/auth/social/complete"
LINK_EXISTING = "/auth/social/link-existing"
LINK = "/auth/social/link"
DELETE = "/users/me/delete-account"


@pytest.fixture
async def fake(client: AsyncClient) -> AsyncIterator[FakeProviders]:
    social, providers = make_social()
    app.dependency_overrides[get_social] = lambda: social
    yield providers


# ── helpers ──────────────────────────────────────────────────────────────


def bearer(tokens: dict[str, Any]) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def count(db: AsyncSession, table: str) -> int:
    return int((await db.execute(text(f'SELECT count(*) FROM "{table}"'))).scalar_one())


async def google_login(client: AsyncClient, code: str | None = None, **kw: Any) -> Response:
    return await client.post(
        LOGIN, json={"provider": "google", "authorization_code": code or google_code(**kw)}
    )


async def fresh_nonce(client: AsyncClient) -> str:
    response = await client.post("/auth/social/nonce")
    assert response.status_code == 200, response.text
    return str(response.json()["nonce"])


def apple_body(nonce: str, sub: str = "a-1", **kw: Any) -> dict[str, Any]:
    extra = {k: kw.pop(k) for k in ("authorization_code", "first_name", "last_name") if k in kw}
    return {
        "provider": "apple",
        "identity_token": apple_token(nonce, sub, **kw),
        "nonce": nonce,
        **extra,
    }


async def apple_login(client: AsyncClient, sub: str = "a-1", **kw: Any) -> Response:
    return await client.post(LOGIN, json=apple_body(await fresh_nonce(client), sub, **kw))


async def offer(client: AsyncClient, response: Response | None = None, **kw: Any) -> dict[str, Any]:
    response = response or await google_login(client, **kw)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "onboarding", body
    return dict(body["onboarding"])


async def complete(
    client: AsyncClient, token: str, username: str = "lifter", **kw: Any
) -> Response:
    return await client.post(COMPLETE, json={"onboarding_token": token, "username": username, **kw})


async def signed_up_google(client: AsyncClient, **kw: Any) -> dict[str, Any]:
    """A Google-only account, signed in. Returns the AuthResponse body."""
    token = (await offer(client, **kw))["token"]
    response = await complete(client, token, kw.pop("username", "lifter"))
    assert response.status_code == 201, response.text
    return dict(response.json())


async def password_user(
    client: AsyncClient, email: str = "efe@example.com", username: str = "efe"
) -> dict[str, Any]:
    response = await client.post(
        "/auth/register", json={"email": email, "username": username, "password": PASSWORD}
    )
    assert response.status_code == 201, response.text
    return dict(response.json())


# ── what is on offer ─────────────────────────────────────────────────────


class TestProviders:
    async def test_it_advertises_only_what_works_and_no_secret(
        self, client: AsyncClient, fake: FakeProviders
    ) -> None:
        response = await client.get("/auth/social/providers")
        assert response.status_code == 200
        body = response.json()
        assert body["google"]["enabled"] is True and body["apple"]["enabled"] is True
        assert "secret" not in response.text.lower() and "key" not in set(body["apple"])

    async def test_a_disabled_provider_is_reported_and_refuses_credentials(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        fake.google_enabled = False
        fake.apple_enabled = False
        body = (await client.get("/auth/social/providers")).json()
        assert body["google"]["enabled"] is False and body["google"]["web_client_id"] is None
        assert body["apple"]["enabled"] is False

        refused = await google_login(client)
        assert refused.status_code == 400
        assert refused.json()["code"] == "social_provider_disabled"
        assert (await client.post("/auth/social/nonce")).status_code == 400
        assert await count(db, "users") == 0 and await count(db, "social_nonces") == 0


# ── first sign-in: nothing is created until onboarding finishes ──────────


class TestFirstSignIn:
    async def test_a_new_identity_gets_an_offer_and_no_account(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        response = await google_login(client, sub="g-new", email="lifter@gmail.com", name="Efe")
        body = response.json()
        assert response.status_code == 200
        assert body["status"] == "onboarding"
        assert body["user"] is None and body["tokens"] is None
        offered = body["onboarding"]
        assert offered["email"] == "lifter@gmail.com" and offered["email_is_usable"] is True
        assert offered["first_name"] == "Efe" and offered["suggested_username"] == "Efe"
        assert 0 < offered["expires_in"] <= 3600
        # No user, no identity, no session: only the short-lived record.
        assert await count(db, "users") == 0
        assert await count(db, "user_identities") == 0
        assert await count(db, "refresh_tokens") == 0
        assert await count(db, "social_signup_challenges") == 1

    async def test_the_onboarding_token_is_stored_only_as_a_hash(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        token = (await offer(client))["token"]
        stored = (await db.execute(text("SELECT token_hash FROM social_signup_challenges"))).one()
        assert stored[0] == hash_token(token) and token not in stored[0]

    async def test_finishing_creates_a_password_less_account_and_signs_it_in(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        token = (await offer(client, sub="g-1", email="lifter@gmail.com", name="Efe"))["token"]
        response = await complete(client, token, "lifter", timezone="Europe/London", locale="en")
        assert response.status_code == 201, response.text
        body = response.json()
        user = body["user"]
        assert user["email"] == "lifter@gmail.com" and user["username"] == "lifter"
        assert user["first_name"] == "Efe" and user["has_password"] is False
        assert user["timezone"] == "Europe/London" and user["locale"] == "en"

        row = (await db.execute(text("SELECT password_hash FROM users"))).one()
        assert row[0] is None  # no dummy password
        identity = (
            await db.execute(text("SELECT provider, subject, user_id FROM user_identities"))
        ).one()
        assert (identity[0], identity[1], str(identity[2])) == ("google", "g-1", user["id"])
        # The record is spent and the session is real.
        assert await count(db, "social_signup_challenges") == 0
        me = await client.get("/users/me", headers=bearer(body["tokens"]))
        assert me.status_code == 200 and me.json()["id"] == user["id"]
        refreshed = await client.post(
            "/auth/refresh", json={"refresh_token": body["tokens"]["refresh_token"]}
        )
        assert refreshed.status_code == 200

    async def test_the_same_identity_signs_into_the_same_account_afterwards(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        first = await signed_up_google(client, sub="g-1")
        again = await google_login(client, sub="g-1", email="changed@gmail.com")
        assert again.status_code == 200
        body = again.json()
        assert body["status"] == "signed_in" and body["user"]["id"] == first["user"]["id"]
        assert (await client.get("/users/me", headers=bearer(body["tokens"]))).status_code == 200
        assert await count(db, "users") == 1
        # The provider's address changed; the account's did not (it is contact data, not a key).
        assert body["user"]["email"] == "lifter@gmail.com"
        stored = (await db.execute(text("SELECT email, last_login_at FROM user_identities"))).one()
        assert stored[0] == "changed@gmail.com" and stored[1] is not None

    async def test_a_second_attempt_invalidates_the_first_onboarding_token(
        self, client: AsyncClient, fake: FakeProviders
    ) -> None:
        old = (await offer(client, sub="g-1"))["token"]
        new = (await offer(client, sub="g-1"))["token"]
        assert (await complete(client, old)).status_code == 400
        assert (await complete(client, new)).status_code == 201

    async def test_a_used_unknown_or_expired_token_is_refused_the_same_way(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        token = (await offer(client))["token"]
        assert (await complete(client, token)).status_code == 201
        spent = await complete(client, token, "another")
        unknown = await complete(client, "never-issued", "another")
        assert spent.status_code == unknown.status_code == 400
        assert spent.json() == unknown.json()
        assert spent.json()["code"] == "social_onboarding_expired"

        fresh = (await offer(client, sub="g-2"))["token"]
        await db.execute(
            text("UPDATE social_signup_challenges SET expires_at = now() - interval '1 second'")
        )
        await db.commit()
        late = await complete(client, fresh, "another")
        assert late.status_code == 400 and late.json()["code"] == "social_onboarding_expired"
        assert await count(db, "users") == 1


# ── an email never selects or links an account ───────────────────────────


class TestEmailIsNotAnIdentity:
    async def test_a_matching_email_neither_signs_in_nor_links(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        owner = await password_user(client, email="victim@example.com", username="victim")
        # Someone else's Google account that reports the very same, verified address.
        response = await google_login(client, sub="g-attacker", email="victim@example.com")
        body = response.json()
        assert body["status"] == "onboarding" and body["tokens"] is None
        assert await count(db, "user_identities") == 0

        # Finishing with that address does not attach it to the owner either: it is refused.
        refused = await complete(client, body["onboarding"]["token"], "attacker")
        assert refused.status_code == 409
        assert refused.json()["code"] == "social_email_in_use"
        assert await count(db, "users") == 1 and await count(db, "user_identities") == 0
        assert (await client.get("/users/me", headers=bearer(owner["tokens"]))).status_code == 200

    async def test_a_taken_username_is_refused_and_leaves_the_flow_usable(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        await password_user(client, username="efe")
        token = (await offer(client))["token"]
        taken = await complete(client, token, "EFE")  # usernames are case-insensitive
        assert taken.status_code == 409 and taken.json()["code"] == "social_username_taken"
        assert await count(db, "users") == 1 and await count(db, "user_identities") == 0
        assert await count(db, "social_signup_challenges") == 1  # not consumed by the failure
        assert (await complete(client, token, "efe_google")).status_code == 201

    async def test_a_provider_that_gave_no_verified_email_cannot_pick_an_existing_one(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        await password_user(client, email="victim@example.com", username="victim")
        offered = await offer(client, sub="g-2", email="victim@example.com", verified=False)
        assert offered["email_is_usable"] is False
        response = await complete(client, offered["token"], "other", email="victim@example.com")
        assert response.status_code == 409
        # No more is said than registration says about a typed address.
        assert response.json()["detail"] == "Email or username is already taken"
        assert await count(db, "users") == 1


# ── linking to an account the person already has ─────────────────────────


class TestLinkExisting:
    async def test_the_password_links_the_identity_and_signs_in_that_account(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        owner = await password_user(client)
        token = (await offer(client, sub="g-9", email="other@gmail.com"))["token"]
        response = await client.post(
            LINK_EXISTING,
            json={"onboarding_token": token, "email": "efe@example.com", "password": PASSWORD},
        )
        assert response.status_code == 200, response.text
        assert response.json()["user"]["id"] == owner["user"]["id"]
        assert await count(db, "users") == 1 and await count(db, "social_signup_challenges") == 0
        # Now the identity signs into that account, and its address never changed.
        again = await google_login(client, sub="g-9", email="other@gmail.com")
        assert again.json()["status"] == "signed_in"
        assert again.json()["user"]["id"] == owner["user"]["id"]
        assert again.json()["user"]["email"] == "efe@example.com"
        # The password still works.
        login = await client.post(
            "/auth/login", json={"email": "efe@example.com", "password": PASSWORD}
        )
        assert login.status_code == 200

    async def test_the_account_is_named_by_what_was_typed_not_by_the_providers_email(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        """The provider reports victim@... but the password typed is the attacker's own
        account's: the identity goes to the account whose password was proven."""
        await password_user(client, email="victim@example.com", username="victim")
        attacker = await password_user(client, email="attacker@example.com", username="attacker")
        token = (await offer(client, sub="g-a", email="victim@example.com"))["token"]
        response = await client.post(
            LINK_EXISTING,
            json={"onboarding_token": token, "email": "attacker@example.com", "password": PASSWORD},
        )
        assert response.status_code == 200
        assert response.json()["user"]["id"] == attacker["user"]["id"]

    async def test_a_wrong_password_attaches_nothing_and_keeps_the_token(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        await password_user(client)
        token = (await offer(client))["token"]
        wrong = await client.post(
            LINK_EXISTING,
            json={"onboarding_token": token, "email": "efe@example.com", "password": "nope-nope-1"},
        )
        unknown = await client.post(
            LINK_EXISTING,
            json={"onboarding_token": token, "email": "no@example.com", "password": "nope-nope-1"},
        )
        assert wrong.status_code == unknown.status_code == 401
        assert wrong.json()["detail"] == unknown.json()["detail"] == "Invalid email or password"
        assert await count(db, "user_identities") == 0
        assert await count(db, "social_signup_challenges") == 1

    async def test_it_is_as_hard_to_guess_a_password_through_here_as_through_login(
        self, client: AsyncClient, fake: FakeProviders
    ) -> None:
        await password_user(client)
        token = (await offer(client))["token"]
        body = {"onboarding_token": token, "email": "efe@example.com", "password": "wrong-pass-1"}
        statuses = [(await client.post(LINK_EXISTING, json=body)).status_code for _ in range(7)]
        assert statuses[:5] == [401] * 5 and 429 in statuses[5:]
        right = await client.post(LINK_EXISTING, json={**body, "password": PASSWORD})
        assert right.status_code == 429  # the bucket is shared with sign-in

    async def test_an_account_without_a_password_cannot_be_linked_this_way(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        await signed_up_google(client, sub="g-1", email="lifter@gmail.com")
        token = (await offer(client, sub="g-2", email="second@gmail.com"))["token"]
        response = await client.post(
            LINK_EXISTING,
            json={"onboarding_token": token, "email": "lifter@gmail.com", "password": PASSWORD},
        )
        assert response.status_code == 401
        assert await count(db, "user_identities") == 1

    async def test_a_second_google_account_is_not_added_to_an_account_that_has_one(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        await password_user(client)
        first = (await offer(client, sub="g-1"))["token"]
        body = {"email": "efe@example.com", "password": PASSWORD}
        assert (
            await client.post(LINK_EXISTING, json={"onboarding_token": first, **body})
        ).status_code == 200
        second = (await offer(client, sub="g-2"))["token"]
        response = await client.post(LINK_EXISTING, json={"onboarding_token": second, **body})
        assert response.status_code == 409
        assert response.json()["code"] == "social_provider_already_linked"
        assert await count(db, "user_identities") == 1

    async def test_an_apple_relay_address_links_to_an_existing_account_too(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        owner = await password_user(client)
        response = await apple_login(
            client, "a-relay", email="xyz@privaterelay.appleid.com", private=True
        )
        offered = await offer(client, response)
        assert offered["is_private_email"] is True
        linked = await client.post(
            LINK_EXISTING,
            json={
                "onboarding_token": offered["token"],
                "email": "efe@example.com",
                "password": PASSWORD,
            },
        )
        assert linked.status_code == 200 and linked.json()["user"]["id"] == owner["user"]["id"]
        again = await apple_login(client, "a-relay", email="xyz@privaterelay.appleid.com")
        assert again.json()["status"] == "signed_in"


class TestLinkFromASignedInSession:
    async def test_password_and_a_fresh_credential_add_the_provider(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        owner = await password_user(client)
        response = await client.post(
            LINK,
            headers=bearer(owner["tokens"]),
            json={
                "credential": {"provider": "google", "authorization_code": google_code("g-5")},
                "password": PASSWORD,
            },
        )
        assert response.status_code == 200, response.text
        assert response.json()["has_password"] is True
        assert [p["provider"] for p in response.json()["providers"]] == ["google"]
        assert (await google_login(client, sub="g-5")).json()["status"] == "signed_in"

    async def test_no_proof_or_two_proofs_are_refused(
        self, client: AsyncClient, fake: FakeProviders
    ) -> None:
        owner = await password_user(client)
        credential = {"provider": "google", "authorization_code": google_code("g-5")}
        none = await client.post(
            LINK, headers=bearer(owner["tokens"]), json={"credential": credential}
        )
        both = await client.post(
            LINK,
            headers=bearer(owner["tokens"]),
            json={
                "credential": credential,
                "password": PASSWORD,
                "reauthenticate_with": credential,
            },
        )
        assert none.status_code == both.status_code == 422
        assert (
            "g-5" not in none.text + both.text and credential["authorization_code"] not in none.text
        )

    async def test_a_wrong_password_is_a_403_so_the_app_does_not_sign_out(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        owner = await password_user(client)
        response = await client.post(
            LINK,
            headers=bearer(owner["tokens"]),
            json={
                "credential": {"provider": "google", "authorization_code": google_code("g-5")},
                "password": "not-my-password",
            },
        )
        assert response.status_code == 403 and response.json()["code"] == "reauth_failed"
        assert await count(db, "user_identities") == 0
        assert (await client.get("/users/me", headers=bearer(owner["tokens"]))).status_code == 200

    async def test_a_bad_provider_credential_is_a_403_too(
        self, client: AsyncClient, fake: FakeProviders
    ) -> None:
        owner = await password_user(client)
        response = await client.post(
            LINK,
            headers=bearer(owner["tokens"]),
            json={
                "credential": {"provider": "google", "authorization_code": "bad-code"},
                "password": PASSWORD,
            },
        )
        assert response.status_code == 403
        assert response.json()["code"] == "social_credential_invalid"

    async def test_an_identity_linked_elsewhere_is_refused_and_nothing_moves(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        google_user = await signed_up_google(client, sub="g-1", email="a@gmail.com")
        owner = await password_user(client)
        response = await client.post(
            LINK,
            headers=bearer(owner["tokens"]),
            json={
                "credential": {"provider": "google", "authorization_code": google_code("g-1")},
                "password": PASSWORD,
            },
        )
        assert response.status_code == 409
        assert response.json()["code"] == "social_identity_already_linked"
        owners = (await db.execute(text("SELECT user_id FROM user_identities"))).all()
        assert [str(row[0]) for row in owners] == [google_user["user"]["id"]]
        assert await count(db, "users") == 2  # nobody was merged or removed

    async def test_an_account_without_a_password_re_proves_itself_with_its_own_provider(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        user = await signed_up_google(client, sub="g-1", email="a@gmail.com")
        nonce = await fresh_nonce(client)
        link_apple = {
            "provider": "apple",
            "identity_token": apple_token(nonce, "a-7", "a@example.com"),
            "nonce": nonce,
        }
        # Someone else's Google account is not proof of this one.
        stranger = await client.post(
            LINK,
            headers=bearer(user["tokens"]),
            json={
                "credential": link_apple,
                "reauthenticate_with": {
                    "provider": "google",
                    "authorization_code": google_code("g-other"),
                },
            },
        )
        assert stranger.status_code == 403 and stranger.json()["code"] == "reauth_failed"
        assert await count(db, "user_identities") == 1

        nonce2 = await fresh_nonce(client)
        proven = await client.post(
            LINK,
            headers=bearer(user["tokens"]),
            json={
                "credential": {
                    "provider": "apple",
                    "identity_token": apple_token(nonce2, "a-7", "a@example.com"),
                    "nonce": nonce2,
                },
                "reauthenticate_with": {
                    "provider": "google",
                    "authorization_code": google_code("g-1"),
                },
            },
        )
        assert proven.status_code == 200, proven.text
        assert sorted(p["provider"] for p in proven.json()["providers"]) == ["apple", "google"]

    async def test_the_sign_in_methods_of_an_account(
        self, client: AsyncClient, fake: FakeProviders
    ) -> None:
        user = await signed_up_google(client)
        body = (
            await client.get("/users/me/sign-in-methods", headers=bearer(user["tokens"]))
        ).json()
        assert body["has_password"] is False and [p["provider"] for p in body["providers"]] == [
            "google"
        ]
        assert (await client.get("/users/me/sign-in-methods")).status_code == 401


# ── invalid, replayed and cancelled credentials ──────────────────────────


class TestCredentialsAreChecked:
    async def test_an_invalid_credential_creates_nothing(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        response = await google_login(client, "bad-code")
        assert response.status_code == 401
        assert response.json() == {
            "detail": "We could not verify that sign-in. Try again.",
            "code": "social_credential_invalid",
        }
        for table in ("users", "user_identities", "social_signup_challenges", "refresh_tokens"):
            assert await count(db, table) == 0

    async def test_a_google_code_works_once(self, client: AsyncClient, fake: FakeProviders) -> None:
        code = google_code("g-1")
        assert (await google_login(client, code)).status_code == 200
        assert (await google_login(client, code)).status_code == 401

    async def test_an_apple_credential_works_once(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        nonce = await fresh_nonce(client)
        body = apple_body(nonce, "a-1")
        assert (await client.post(LOGIN, json=body)).status_code == 200
        replay = await client.post(LOGIN, json=body)
        assert replay.status_code == 401 and replay.json()["code"] == "social_nonce_invalid"
        assert await count(db, "social_nonces") == 0

    async def test_a_token_for_another_nonce_is_refused(
        self, client: AsyncClient, fake: FakeProviders
    ) -> None:
        mine, other = await fresh_nonce(client), await fresh_nonce(client)
        body = {**apple_body(other, "a-1"), "nonce": mine}
        assert (await client.post(LOGIN, json=body)).status_code == 401
        # The nonce was not spent by a credential that did not verify.
        assert (await client.post(LOGIN, json=apple_body(mine, "a-1"))).status_code == 200

    async def test_a_nonce_nobody_issued_or_one_that_expired_is_refused(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        invented = "x" * 40
        assert (await client.post(LOGIN, json=apple_body(invented))).status_code == 401
        nonce = await fresh_nonce(client)
        await db.execute(text("UPDATE social_nonces SET expires_at = now() - interval '1 second'"))
        await db.commit()
        late = await client.post(LOGIN, json=apple_body(nonce))
        assert late.status_code == 401 and late.json()["code"] == "social_nonce_invalid"

    async def test_two_requests_with_one_nonce_cannot_both_sign_in(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        nonce = await fresh_nonce(client)
        body = apple_body(nonce, "a-1")
        results = await asyncio.gather(*(client.post(LOGIN, json=body) for _ in range(4)))
        assert sorted(r.status_code for r in results) == [200, 401, 401, 401]

    async def test_a_provider_outage_is_a_503_with_a_retry_hint_and_leaves_no_trace(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        response = await google_login(client, "g|down")
        assert response.status_code == 503
        assert response.headers["Retry-After"] == "10"
        assert response.json()["code"] == "social_provider_unavailable"
        assert "email" in response.json()["detail"]  # the way forward is named
        assert await count(db, "users") == 0

    async def test_malformed_requests_are_refused_without_echoing_the_credential(
        self, client: AsyncClient, fake: FakeProviders
    ) -> None:
        secret = "very-secret-authorization-code"
        for body in (
            {"provider": "google"},
            {"provider": "google", "authorization_code": secret, "identity_token": "t"},
            {"provider": "facebook", "authorization_code": secret},
            {"provider": "apple", "identity_token": secret},
            {"provider": "google", "authorization_code": secret, "surprise": 1},
        ):
            response = await client.post(LOGIN, json=body)
            assert response.status_code == 422
            assert secret not in response.text

    async def test_credentials_are_not_written_to_the_log(
        self, client: AsyncClient, fake: FakeProviders, caplog: pytest.LogCaptureFixture
    ) -> None:
        caplog.set_level(logging.DEBUG)
        code = google_code("g-log", "log@gmail.com") + "-MARKER"
        token = (await offer(client, response=await google_login(client, code)))["token"]
        await complete(client, token, "logger")
        await google_login(client, "bad-MARKER")
        assert "MARKER" not in caplog.text and token not in caplog.text


# ── Apple specifics ──────────────────────────────────────────────────────


class TestApple:
    async def test_the_relay_address_is_the_account_email_and_never_guessed_from(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        response = await apple_login(
            client, "a-1", email="s3cr3t@privaterelay.appleid.com", private=True, first_name="Efe"
        )
        offered = await offer(client, response)
        assert offered["email_is_usable"] is True and offered["is_private_email"] is True
        # The suggestion comes from the name, never from a random relay local part.
        assert offered["suggested_username"] == "Efe"
        created = await complete(client, offered["token"], "efe_apple")
        assert created.status_code == 201
        assert created.json()["user"]["email"] == "s3cr3t@privaterelay.appleid.com"
        assert created.json()["user"]["first_name"] == "Efe"

    async def test_no_email_means_the_person_types_one(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        offered = await offer(client, await apple_login(client, "a-2", email=""))
        assert offered["email"] is None and offered["email_is_usable"] is False
        assert offered["suggested_username"] is None  # no name, no address: nothing to suggest
        missing = await complete(client, offered["token"], "no_email")
        assert missing.status_code == 400 and missing.json()["code"] == "social_email_required"
        assert await count(db, "users") == 0
        done = await complete(client, offered["token"], "no_email", email="typed@example.com")
        assert done.status_code == 201 and done.json()["user"]["email"] == "typed@example.com"

    async def test_a_missing_name_is_fine(self, client: AsyncClient, fake: FakeProviders) -> None:
        offered = await offer(client, await apple_login(client, "a-3"))
        assert offered["first_name"] is None
        created = await complete(client, offered["token"], "nameless")
        assert created.status_code == 201 and created.json()["user"]["first_name"] is None

    async def test_the_refresh_token_is_kept_encrypted_for_revocation_only(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        offered = await offer(client, await apple_login(client, "a-1", authorization_code="code1"))
        await complete(client, offered["token"], "apple_user")
        stored = (
            await db.execute(text("SELECT apple_refresh_token_encrypted FROM user_identities"))
        ).scalar_one()
        assert stored and "refresh-for-code1" not in stored
        assert fake.exchanged == ["code1"]

    async def test_a_failed_token_exchange_does_not_stop_the_sign_in(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        fake.exchange_fails = True
        offered = await offer(client, await apple_login(client, "a-1", authorization_code="code1"))
        assert (await complete(client, offered["token"], "apple_user")).status_code == 201
        stored = (
            await db.execute(text("SELECT apple_refresh_token_encrypted FROM user_identities"))
        ).scalar_one()
        assert stored is None

    async def test_a_later_sign_in_stores_the_token_if_there_was_none(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        offered = await offer(client, await apple_login(client, "a-1"))
        await complete(client, offered["token"], "apple_user")
        again = await apple_login(client, "a-1", authorization_code="code9")
        assert again.json()["status"] == "signed_in"
        stored = (
            await db.execute(text("SELECT apple_refresh_token_encrypted FROM user_identities"))
        ).scalar_one()
        assert stored


class TestAppleNotifications:
    async def _apple_only(self, client: AsyncClient) -> dict[str, Any]:
        offered = await offer(client, await apple_login(client, "a-1", authorization_code="c1"))
        response = await complete(client, offered["token"], "apple_user")
        assert response.status_code == 201
        return dict(response.json())

    async def test_revoked_consent_ends_the_sessions_of_an_account_that_only_has_apple(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        user = await self._apple_only(client)
        response = await client.post(
            "/auth/social/apple/notifications", json={"payload": notice("consent-revoked", "a-1")}
        )
        assert response.status_code == 204
        assert (await client.get("/users/me", headers=bearer(user["tokens"]))).status_code == 401
        refreshed = await client.post(
            "/auth/refresh", json={"refresh_token": user["tokens"]["refresh_token"]}
        )
        assert refreshed.status_code == 401
        row = (
            await db.execute(
                text(
                    "SELECT authorization_revoked_at, apple_refresh_token_encrypted "
                    "FROM user_identities"
                )
            )
        ).one()
        assert row[0] is not None and row[1] is None
        # Signing in with Apple again is a fresh authorization for the same account.
        back = await apple_login(client, "a-1")
        assert (
            back.json()["status"] == "signed_in" and back.json()["user"]["id"] == user["user"]["id"]
        )
        revoked_at = (
            await db.execute(text("SELECT authorization_revoked_at FROM user_identities"))
        ).scalar_one()
        assert revoked_at is None

    async def test_an_account_with_a_password_keeps_its_sessions(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        owner = await password_user(client)
        offered = await offer(client, await apple_login(client, "a-1"))
        await client.post(
            LINK_EXISTING,
            json={
                "onboarding_token": offered["token"],
                "email": "efe@example.com",
                "password": PASSWORD,
            },
        )
        await client.post(
            "/auth/social/apple/notifications", json={"payload": notice("account-delete", "a-1")}
        )
        assert (await client.get("/users/me", headers=bearer(owner["tokens"]))).status_code == 200
        revoked = (
            await db.execute(text("SELECT authorization_revoked_at FROM user_identities"))
        ).scalar_one()
        assert revoked is not None

    async def test_other_events_unknown_subjects_and_forged_payloads(
        self, client: AsyncClient, fake: FakeProviders
    ) -> None:
        user = await self._apple_only(client)
        for payload in (notice("email-disabled", "a-1"), notice("consent-revoked", "nobody")):
            response = await client.post(
                "/auth/social/apple/notifications", json={"payload": payload}
            )
            assert response.status_code == 204
        assert (await client.get("/users/me", headers=bearer(user["tokens"]))).status_code == 200
        forged = await client.post("/auth/social/apple/notifications", json={"payload": "garbage"})
        assert forged.status_code == 401


# ── an account made with a provider has no password to reach ─────────────


class TestPasswordLessAccount:
    async def test_it_cannot_sign_in_or_reset_by_password(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        await signed_up_google(client, email="lifter@gmail.com")
        for password in (PASSWORD, "", "x" * 80):
            response = await client.post(
                "/auth/login", json={"email": "lifter@gmail.com", "password": password}
            )
            assert response.status_code == 401
        assert await count(db, "refresh_tokens") == 1  # only the Google session

    async def test_existing_password_accounts_are_unchanged_by_it_all(
        self, client: AsyncClient, fake: FakeProviders
    ) -> None:
        await password_user(client)
        login = await client.post(
            "/auth/login", json={"email": "efe@example.com", "password": PASSWORD}
        )
        assert login.status_code == 200 and login.json()["user"]["has_password"] is True


# ── deleting an account made with a provider ─────────────────────────────


class TestDeletion:
    async def test_the_password_route_is_closed_to_it(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        user = await signed_up_google(client)
        response = await client.post(
            DELETE, headers=bearer(user["tokens"]), json={"password": PASSWORD}
        )
        assert response.status_code == 403
        assert await count(db, "users") == 1

    async def test_signing_in_with_the_same_provider_again_confirms_it(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        user = await signed_up_google(client, sub="g-1")
        response = await client.post(
            DELETE,
            headers=bearer(user["tokens"]),
            json={
                "provider_credential": {
                    "provider": "google",
                    "authorization_code": google_code("g-1"),
                }
            },
        )
        assert response.status_code == 204, response.text
        for table in ("users", "user_identities", "refresh_tokens"):
            assert await count(db, table) == 0
        assert (await client.get("/users/me", headers=bearer(user["tokens"]))).status_code == 401
        # The same Google account can start over, and meets onboarding like a stranger.
        assert (await google_login(client, sub="g-1")).json()["status"] == "onboarding"

    async def test_another_persons_provider_account_does_not_confirm_it(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        user = await signed_up_google(client, sub="g-1")
        response = await client.post(
            DELETE,
            headers=bearer(user["tokens"]),
            json={
                "provider_credential": {
                    "provider": "google",
                    "authorization_code": google_code("g-2"),
                }
            },
        )
        assert response.status_code == 403 and response.json()["code"] == "reauth_failed"
        assert await count(db, "users") == 1
        assert (await client.get("/users/me", headers=bearer(user["tokens"]))).status_code == 200

    async def test_an_invalid_credential_is_a_403_not_a_dead_session(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        user = await signed_up_google(client)
        response = await client.post(
            DELETE,
            headers=bearer(user["tokens"]),
            json={"provider_credential": {"provider": "google", "authorization_code": "bad"}},
        )
        assert response.status_code == 403 and await count(db, "users") == 1

    async def test_a_provider_outage_deletes_nothing_and_does_not_use_up_an_attempt(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        user = await signed_up_google(client)
        for _ in range(settings.RATE_LIMIT_DELETE_USER_LIMIT + 2):
            response = await client.post(
                DELETE,
                headers=bearer(user["tokens"]),
                json={
                    "provider_credential": {"provider": "google", "authorization_code": "g|down"}
                },
            )
            assert response.status_code == 503
        assert await count(db, "users") == 1
        ok = await client.post(
            DELETE,
            headers=bearer(user["tokens"]),
            json={
                "provider_credential": {
                    "provider": "google",
                    "authorization_code": google_code("g-1"),
                }
            },
        )
        assert ok.status_code == 204

    async def test_exactly_one_confirmation_is_required(
        self, client: AsyncClient, fake: FakeProviders
    ) -> None:
        user = await signed_up_google(client)
        credential = {"provider": "google", "authorization_code": google_code("g-1")}
        for body in ({}, {"password": PASSWORD, "provider_credential": credential}):
            response = await client.post(DELETE, headers=bearer(user["tokens"]), json=body)
            assert response.status_code == 422

    async def test_apple_authorization_is_revoked_after_the_account_is_gone(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        offered = await offer(client, await apple_login(client, "a-1", authorization_code="c1"))
        user = (await complete(client, offered["token"], "apple_user")).json()
        nonce = await fresh_nonce(client)
        response = await client.post(
            DELETE,
            headers=bearer(user["tokens"]),
            json={
                "provider_credential": {
                    "provider": "apple",
                    "identity_token": apple_token(nonce, "a-1"),
                    "nonce": nonce,
                }
            },
        )
        assert response.status_code == 204, response.text
        assert fake.revoked == ["refresh-for-c1"]
        assert await count(db, "users") == 0

    async def test_apple_being_down_does_not_block_or_undo_the_deletion(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        offered = await offer(client, await apple_login(client, "a-1", authorization_code="c1"))
        user = (await complete(client, offered["token"], "apple_user")).json()
        fake.revoke_fails = True
        nonce = await fresh_nonce(client)
        response = await client.post(
            DELETE,
            headers=bearer(user["tokens"]),
            json={
                "provider_credential": {
                    "provider": "apple",
                    "identity_token": apple_token(nonce, "a-1"),
                    "nonce": nonce,
                }
            },
        )
        assert response.status_code == 204
        assert fake.revoked == [] and await count(db, "users") == 0

    async def test_a_password_account_with_a_provider_still_deletes_with_its_password(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        owner = await password_user(client)
        offered = await offer(client)
        await client.post(
            LINK_EXISTING,
            json={
                "onboarding_token": offered["token"],
                "email": "efe@example.com",
                "password": PASSWORD,
            },
        )
        response = await client.post(
            DELETE, headers=bearer(owner["tokens"]), json={"password": PASSWORD}
        )
        assert response.status_code == 204
        assert await count(db, "users") == 0 and await count(db, "user_identities") == 0


# ── concurrency ──────────────────────────────────────────────────────────


class TestConcurrency:
    async def test_two_completions_of_one_token_make_one_account(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        token = (await offer(client))["token"]
        results = await asyncio.gather(
            complete(client, token, "winner_one"), complete(client, token, "winner_two")
        )
        assert sorted(r.status_code for r in results) == [201, 400]
        assert await count(db, "users") == 1 and await count(db, "user_identities") == 1

    async def test_two_records_for_one_identity_make_one_account_and_no_orphan(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        first = (await offer(client, sub="g-1"))["token"]
        # A second record for the same identity, as two overlapping sign-ins could leave.
        await db.execute(
            text(
                "INSERT INTO social_signup_challenges "
                "(token_hash, provider, subject, email, email_verified, expires_at) "
                "SELECT :h, provider, subject, 'other@gmail.com', true, expires_at "
                "FROM social_signup_challenges"
            ),
            {"h": hash_token("second-token")},
        )
        await db.commit()
        results = await asyncio.gather(
            complete(client, first, "one"), complete(client, "second-token", "two")
        )
        codes = sorted(r.status_code for r in results)
        assert codes[0] == 201 and codes[1] in (201, 409)
        users = await count(db, "users")
        identities = await count(db, "user_identities")
        assert identities == 1 and users == 1  # the loser left no user behind
        loser = next(r for r in results if r.status_code == 409)
        assert loser.json()["code"] in ("social_conflict", "social_identity_already_linked")

    async def test_concurrent_first_sign_ins_of_one_apple_identity_end_with_one_account(
        self, client: AsyncClient, db: AsyncSession, fake: FakeProviders
    ) -> None:
        bodies = [apple_body(await fresh_nonce(client), "a-1") for _ in range(3)]
        responses = await asyncio.gather(*(client.post(LOGIN, json=b) for b in bodies))
        assert all(r.status_code == 200 for r in responses)
        tokens = [r.json()["onboarding"]["token"] for r in responses]
        done = await asyncio.gather(
            *(complete(client, t, f"user_{i}") for i, t in enumerate(tokens))
        )
        assert [r.status_code for r in done].count(201) == 1
        assert await count(db, "users") == 1 and await count(db, "user_identities") == 1


# ── limits ───────────────────────────────────────────────────────────────


class TestRateLimits:
    async def test_nonces_are_limited_per_requester(
        self, client: AsyncClient, fake: FakeProviders, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "RATE_LIMIT_SOCIAL_NONCE_IP_LIMIT", 2)
        statuses = [(await client.post("/auth/social/nonce")).status_code for _ in range(3)]
        assert statuses == [200, 200, 429]

    async def test_sign_ins_are_limited_before_the_provider_is_called(
        self, client: AsyncClient, fake: FakeProviders, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "RATE_LIMIT_SOCIAL_SIGNIN_IP_LIMIT", 2)
        statuses = [(await google_login(client, sub=f"g-{i}")).status_code for i in range(3)]
        assert statuses == [200, 200, 429]
        assert len(fake.used_codes) == 2  # the third never reached the provider
