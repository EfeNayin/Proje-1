"""Logout against refresh: what a signed-out session may still do.

`logout` ends the session the presented refresh token belongs to. Rotation makes
that more than one row: every refresh revokes its token and issues a successor, so
a session is a chain of tokens. If logout only removed the token it was handed, a
refresh that rotated it a moment earlier would leave its successor live, a
credential for a session the user had just ended.

These run against the real database. The interleavings are forced with an `await
asyncio.sleep()` inside the refresh transaction (see TestConcurrentRefresh in
test_auth.py for why a bare `asyncio.gather` proves nothing here), and the
sequential cases need no timing at all.
"""

import asyncio
from collections.abc import Callable
from typing import Any

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

import app.domains.auth.service as auth_service
from app.domains.auth.schemas import TokenPair
from app.models import RefreshToken, User

Tokens = dict[str, str]


async def register(client: AsyncClient, payload: dict[str, str]) -> Tokens:
    response = await client.post("/auth/register", json=payload)
    assert response.status_code == 201, response.text
    tokens: Tokens = response.json()["tokens"]
    return tokens


async def login(client: AsyncClient, payload: dict[str, str]) -> Tokens:
    response = await client.post(
        "/auth/login", json={"email": payload["email"], "password": payload["password"]}
    )
    assert response.status_code == 200, response.text
    tokens: Tokens = response.json()["tokens"]
    return tokens


def refresh(client: AsyncClient, tokens: Tokens) -> Any:
    return client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})


def logout(client: AsyncClient, tokens: Tokens) -> Any:
    return client.post("/auth/logout", json={"refresh_token": tokens["refresh_token"]})


async def live_tokens(db: AsyncSession, email: str) -> int:
    db.expire_all()
    count = await db.scalar(
        select(func.count())
        .select_from(RefreshToken)
        .join(User, User.id == RefreshToken.user_id)
        .where(User.email == email, RefreshToken.revoked_at.is_(None))
    )
    assert count is not None
    return count


def slow_rotation(monkeypatch: pytest.MonkeyPatch, seconds: float = 0.4) -> None:
    """Keep every rotation open (row locked, successor inserted, uncommitted) a while."""
    original: Callable[..., Any] = auth_service._issue_token_pair

    async def slow(*args: Any, **kwargs: Any) -> TokenPair:
        pair: TokenPair = await original(*args, **kwargs)
        await asyncio.sleep(seconds)
        return pair

    monkeypatch.setattr(auth_service, "_issue_token_pair", slow)


class TestLogoutAfterRotation:
    async def test_a_successor_minted_before_logout_cannot_be_used(
        self, client: AsyncClient, db: AsyncSession, register_payload: dict[str, str]
    ) -> None:
        """Refresh commits, then the device logs out with the token it held before.

        The device never saw the successor (its response was lost or arrived after
        the sign-out), but the server issued it, so ending the session has to end it.
        """
        first = await register(client, register_payload)
        rotated = (await refresh(client, first)).json()

        assert (await logout(client, first)).status_code == 204

        assert (await refresh(client, rotated)).status_code == 401
        assert await live_tokens(db, register_payload["email"]) == 0

    async def test_logging_out_with_the_successor_ends_the_whole_chain(
        self, client: AsyncClient, db: AsyncSession, register_payload: dict[str, str]
    ) -> None:
        first = await register(client, register_payload)
        second = (await refresh(client, first)).json()
        third = (await refresh(client, second)).json()

        assert (await logout(client, third)).status_code == 204

        assert await live_tokens(db, register_payload["email"]) == 0
        assert (await refresh(client, third)).status_code == 401

    async def test_logging_out_with_an_old_token_ends_the_chain_too(
        self, client: AsyncClient, db: AsyncSession, register_payload: dict[str, str]
    ) -> None:
        """A stale copy of the token (a retry, a request that lost a race) still ends it."""
        first = await register(client, register_payload)
        second = (await refresh(client, first)).json()
        third = (await refresh(client, second)).json()

        assert (await logout(client, first)).status_code == 204

        assert (await refresh(client, third)).status_code == 401
        assert await live_tokens(db, register_payload["email"]) == 0

    async def test_only_this_session_ends_not_the_other_devices(
        self, client: AsyncClient, db: AsyncSession, register_payload: dict[str, str]
    ) -> None:
        phone = await register(client, register_payload)
        tablet = await login(client, register_payload)
        phone_next = (await refresh(client, phone)).json()
        tablet_next = (await refresh(client, tablet)).json()

        assert (await logout(client, phone)).status_code == 204

        assert (await refresh(client, phone_next)).status_code == 401
        survivor = await refresh(client, tablet_next)
        assert survivor.status_code == 200, survivor.text
        assert await live_tokens(db, register_payload["email"]) == 1

    async def test_two_accounts_are_independent(
        self,
        client: AsyncClient,
        register_payload: dict[str, str],
        second_register_payload: dict[str, str],
    ) -> None:
        a = await register(client, register_payload)
        b = await register(client, second_register_payload)
        b_next = (await refresh(client, b)).json()
        a_next = (await refresh(client, a)).json()

        assert (await logout(client, a)).status_code == 204

        assert (await refresh(client, a_next)).status_code == 401
        assert (await refresh(client, b_next)).status_code == 200

    async def test_a_late_refresh_with_the_logged_out_token_is_a_plain_401(
        self, client: AsyncClient, db: AsyncSession, register_payload: dict[str, str]
    ) -> None:
        """Not a theft signal: the user's other devices must survive a stale request."""
        phone = await register(client, register_payload)
        tablet = await login(client, register_payload)
        rotated = (await refresh(client, phone)).json()

        await logout(client, rotated)
        late = await refresh(client, rotated)

        assert late.status_code == 401
        assert "already used" not in late.json()["detail"]
        assert (await refresh(client, tablet)).status_code == 200

    async def test_a_late_refresh_with_the_token_logout_was_given_is_a_plain_401(
        self, client: AsyncClient, register_payload: dict[str, str]
    ) -> None:
        """Logout removes the token it was handed even after that token was rotated."""
        phone = await register(client, register_payload)
        tablet = await login(client, register_payload)
        await refresh(client, phone)

        await logout(client, phone)
        late = await refresh(client, phone)

        assert late.status_code == 401
        assert "already used" not in late.json()["detail"]
        assert (await refresh(client, tablet)).status_code == 200

    async def test_replaying_an_older_rotated_token_is_still_a_theft_signal(
        self, client: AsyncClient, db: AsyncSession, register_payload: dict[str, str]
    ) -> None:
        """History needed for replay detection is kept: logout removes live tokens and
        the presented one, never the record that earlier tokens were already used."""
        first = await register(client, register_payload)
        tablet = await login(client, register_payload)
        second = (await refresh(client, first)).json()
        third = (await refresh(client, second)).json()

        await logout(client, third)
        db.expire_all()
        revoked = await db.scalar(
            select(func.count())
            .select_from(RefreshToken)
            .join(User, User.id == RefreshToken.user_id)
            .where(User.email == register_payload["email"], RefreshToken.revoked_at.is_not(None))
        )
        assert revoked is not None and revoked >= 1  # the rotated history is still there

        replay = await refresh(client, first)  # an old token surfacing again
        assert replay.status_code == 401
        assert "already used" in replay.json()["detail"]
        assert (await refresh(client, tablet)).status_code == 401  # theft response, as before


class TestLogoutRacingRefresh:
    async def test_logout_during_a_rotation_leaves_no_usable_successor(
        self,
        client: AsyncClient,
        db: AsyncSession,
        register_payload: dict[str, str],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Logout arrives while the rotation is open: the new token is inserted but
        not yet committed, so a plain DELETE of the presented row cannot see it."""
        first = await register(client, register_payload)
        slow_rotation(monkeypatch)

        rotating = asyncio.create_task(refresh(client, first))
        await asyncio.sleep(0.15)  # the rotation holds the lock and has inserted its successor
        logging_out = await logout(client, first)
        refreshed = await rotating

        assert logging_out.status_code == 204
        assert refreshed.status_code == 200  # it won the lock; the client may well get this answer
        monkeypatch.undo()
        assert (await refresh(client, refreshed.json())).status_code == 401
        assert await live_tokens(db, register_payload["email"]) == 0

    async def test_logout_first_makes_the_waiting_refresh_fail(
        self,
        client: AsyncClient,
        db: AsyncSession,
        register_payload: dict[str, str],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """The other order: logout holds the session, the refresh waits and then finds nothing."""
        first = await register(client, register_payload)
        tablet = await login(client, register_payload)

        # Hold logout's transaction open (its writes done, not committed) for a while.
        slow = {"on": True}
        original_commit: Callable[..., Any] = AsyncSession.commit

        async def slow_commit(self: AsyncSession) -> None:
            if slow["on"]:
                await asyncio.sleep(0.4)
            await original_commit(self)

        monkeypatch.setattr(AsyncSession, "commit", slow_commit)

        logging_out = asyncio.create_task(logout(client, first))
        await asyncio.sleep(0.15)
        slow["on"] = False
        refreshing = asyncio.create_task(refresh(client, first))
        out, late = await asyncio.gather(logging_out, refreshing)
        monkeypatch.undo()

        assert out.status_code == 204
        assert late.status_code == 401
        assert "already used" not in late.json()["detail"]
        assert (await refresh(client, tablet)).status_code == 200
        assert await live_tokens(db, register_payload["email"]) == 1

    async def test_logout_racing_a_chain_of_rotations(
        self,
        client: AsyncClient,
        db: AsyncSession,
        register_payload: dict[str, str],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Logout presents a token two links back while the newest one is mid-rotation."""
        first = await register(client, register_payload)
        second = (await refresh(client, first)).json()
        slow_rotation(monkeypatch)

        rotating = asyncio.create_task(refresh(client, second))
        await asyncio.sleep(0.15)
        await logout(client, first)
        newest = await rotating
        monkeypatch.undo()

        assert newest.status_code == 200
        assert (await refresh(client, newest.json())).status_code == 401
        assert await live_tokens(db, register_payload["email"]) == 0

    async def test_many_logouts_and_refreshes_at_once_never_leave_a_live_token(
        self,
        client: AsyncClient,
        db: AsyncSession,
        register_payload: dict[str, str],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        first = await register(client, register_payload)
        slow_rotation(monkeypatch, seconds=0.05)

        results: list[Response] = await asyncio.gather(
            *[refresh(client, first) for _ in range(3)],
            *[logout(client, first) for _ in range(3)],
        )
        monkeypatch.undo()

        assert all(r.status_code in (200, 204, 401) for r in results)
        assert await live_tokens(db, register_payload["email"]) == 0


@pytest.fixture
def second_register_payload() -> dict[str, str]:
    return {
        "email": "second@example.com",
        "username": "second_user",
        "password": "correct horse battery staple",
        "first_name": "Second",
    }
