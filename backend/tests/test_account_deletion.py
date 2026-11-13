"""Deleting an account: what goes, what stays, and what can race it.

Run through the real app against the real test database (and a real Redis for the
limiter). The tests that matter most are about ownership (the other person's
records survive, without any trace of the deleted account), about sessions (a deleted
account's tokens stop working), and about the interleavings that could leave a usable
session or an orphaned row behind. Racing requests are forced to overlap with a pause
inside the transaction that must be caught mid-way, because a bare `asyncio.gather`
proves nothing here (see tests/test_logout_refresh_race.py).
"""

import asyncio
import threading
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

import app.domains.auth.service as auth_service
import app.domains.programs.service as programs_service
import app.domains.users.deletion as deletion
from app.core.config import settings
from app.core.ratelimit import RateLimiter, get_rate_limiter
from app.main import app
from tests.test_coaching import Headers, _connect
from tests.test_coaching_feedback import _create as _feedback
from tests.test_coaching_workouts import _log, _set, _share
from tests.test_password_offload import wait_until
from tests.test_program_lineages import _publish_edit, _ready, _version
from tests.test_program_offers import _accept as _accept_offer
from tests.test_program_offers import _offer, _program, _programs, _shape
from tests.test_ratelimit import DeadRedis, stored_keys

PASSWORD = "supersecret123"
URL = "/users/me/delete-account"
LOCK = "app.domains.users.deletion.lock_active_program"

# Seeded reference data, which no account owns.
CATALOGUE = ("exercises", "muscle_groups", "exercise_muscle_groups")


@dataclass
class Account:
    name: str
    id: str
    email: str
    headers: Headers
    refresh_token: str


async def _signup(client: AsyncClient, name: str) -> Account:
    response = await client.post(
        "/auth/register",
        json={
            "email": f"{name}@example.com",
            "username": name,
            "password": PASSWORD,
            "first_name": name.capitalize(),
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    return Account(
        name=name,
        id=body["user"]["id"],
        email=f"{name}@example.com",
        headers={"Authorization": f"Bearer {body['tokens']['access_token']}"},
        refresh_token=body["tokens"]["refresh_token"],
    )


def _delete(client: AsyncClient, who: Account, password: str = PASSWORD) -> Any:
    return client.post(URL, headers=who.headers, json={"password": password})


async def _signed_in(client: AsyncClient, who: Account) -> bool:
    return (await client.get("/users/me", headers=who.headers)).status_code == 200


async def _count(db: AsyncSession, table: str) -> int:
    return int((await db.execute(text(f'SELECT count(*) FROM "{table}"'))).scalar_one())


async def _tables(db: AsyncSession) -> list[str]:
    rows = await db.execute(
        text(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_type = 'BASE TABLE' "
            "AND table_name <> 'alembic_version' ORDER BY table_name"
        )
    )
    return [row[0] for row in rows]


async def _row_counts(db: AsyncSession) -> dict[str, int]:
    return {table: await _count(db, table) for table in await _tables(db)}


async def _mentions(db: AsyncSession, *needles: str) -> dict[str, int]:
    """Rows, in any table and any column (JSON included), that contain any of the needles."""
    found: dict[str, int] = {}
    for table in await _tables(db):
        for needle in needles:
            result = await db.execute(
                text(f'SELECT count(*) FROM "{table}" AS r WHERE r::text ILIKE :n'),
                {"n": f"%{needle}%"},
            )
            hits = int(result.scalar_one())
            if hits:
                found[f"{table}:{needle}"] = hits
    return found


async def _user_row(db: AsyncSession, user_id: str) -> bool:
    result = await db.execute(text("SELECT 1 FROM users WHERE id = :i"), {"i": UUID(user_id)})
    return result.first() is not None


@pytest.fixture
async def exercise_ids(client: AsyncClient) -> list[str]:
    who = await _signup(client, "catalogue")
    response = await client.get("/exercises?limit=6", headers=who.headers)
    assert response.status_code == 200, response.text
    ids = [item["id"] for item in response.json()["items"]]
    assert (await _delete(client, who)).status_code == 204
    return ids


# ── who may delete, and what they must prove ─────────────────────────────


class TestAuthorizationAndPassword:
    async def test_a_signed_out_request_deletes_nothing(
        self, client: AsyncClient, db: AsyncSession
    ) -> None:
        who = await _signup(client, "efe")

        response = await client.post(URL, json={"password": PASSWORD})

        assert response.status_code == 401
        assert await _user_row(db, who.id)
        assert await _signed_in(client, who)

    async def test_a_garbage_token_deletes_nothing(
        self, client: AsyncClient, db: AsyncSession
    ) -> None:
        who = await _signup(client, "efe")

        response = await client.post(
            URL, headers={"Authorization": "Bearer not-a-token"}, json={"password": PASSWORD}
        )

        assert response.status_code == 401
        assert await _user_row(db, who.id)

    async def test_a_refresh_token_cannot_authorise_deletion(
        self, client: AsyncClient, db: AsyncSession
    ) -> None:
        who = await _signup(client, "efe")

        response = await client.post(
            URL,
            headers={"Authorization": f"Bearer {who.refresh_token}"},
            json={"password": PASSWORD},
        )

        assert response.status_code == 401
        assert await _user_row(db, who.id)

    async def test_a_wrong_password_is_a_403_and_the_account_and_session_survive(
        self, client: AsyncClient, db: AsyncSession
    ) -> None:
        who = await _signup(client, "efe")

        response = await _delete(client, who, "not-the-password")

        # 403, never 401: the mobile client reads a 401 as "the session ended".
        assert response.status_code == 403
        assert response.json() == {"detail": "Incorrect password"}
        assert await _user_row(db, who.id)
        assert await _signed_in(client, who)
        refreshed = await client.post("/auth/refresh", json={"refresh_token": who.refresh_token})
        assert refreshed.status_code == 200

    async def test_a_longer_string_with_the_right_prefix_is_not_the_password(
        self, client: AsyncClient, db: AsyncSession
    ) -> None:
        """bcrypt only reads 72 bytes; the same rule as sign-in applies here."""
        who = await _signup(client, "efe")

        response = await _delete(client, who, PASSWORD + "x" * 80)

        assert response.status_code == 403
        assert await _user_row(db, who.id)

    async def test_the_right_password_deletes_the_account(
        self, client: AsyncClient, db: AsyncSession
    ) -> None:
        who = await _signup(client, "efe")

        response = await _delete(client, who)

        assert response.status_code == 204
        assert response.content == b""
        assert not await _user_row(db, who.id)

    async def test_the_password_is_case_sensitive_and_exact(
        self, client: AsyncClient, db: AsyncSession
    ) -> None:
        who = await _signup(client, "efe")

        for wrong in (PASSWORD.upper(), PASSWORD + " ", " " + PASSWORD):
            assert (await _delete(client, who, wrong)).status_code == 403

        assert await _user_row(db, who.id)

    async def test_an_empty_password_is_refused_without_deleting(
        self, client: AsyncClient, db: AsyncSession
    ) -> None:
        who = await _signup(client, "efe")

        response = await _delete(client, who, "")

        assert response.status_code == 422
        assert await _user_row(db, who.id)


class TestTheTargetIsAlwaysTheCaller:
    async def test_a_body_naming_another_user_is_refused_and_nobody_is_deleted(
        self, client: AsyncClient, db: AsyncSession
    ) -> None:
        caller = await _signup(client, "efe")
        other = await _signup(client, "intruder")

        for extra in ({"user_id": other.id}, {"id": other.id}, {"email": other.email}):
            response = await client.post(
                URL, headers=caller.headers, json={"password": PASSWORD, **extra}
            )
            assert response.status_code == 422, extra

        assert await _user_row(db, caller.id)
        assert await _user_row(db, other.id)

    async def test_the_account_is_chosen_by_the_token_alone(
        self, client: AsyncClient, db: AsyncSession
    ) -> None:
        caller = await _signup(client, "efe")
        other = await _signup(client, "intruder")

        # Another account's password does not delete the caller, or the other account.
        response = await client.post(
            URL, headers=caller.headers, params={"user_id": other.id}, json={"password": PASSWORD}
        )

        assert response.status_code == 204
        assert not await _user_row(db, caller.id)
        assert await _user_row(db, other.id)
        assert await _signed_in(client, other)

    async def test_the_password_cannot_be_sent_in_the_url(
        self, client: AsyncClient, db: AsyncSession
    ) -> None:
        who = await _signup(client, "efe")

        response = await client.post(f"{URL}?password={PASSWORD}", headers=who.headers)

        assert response.status_code == 422
        assert await _user_row(db, who.id)

    async def test_the_old_verbs_and_paths_do_not_delete(
        self, client: AsyncClient, db: AsyncSession
    ) -> None:
        who = await _signup(client, "efe")

        for method, path in (("DELETE", "/users/me"), ("DELETE", "/users"), ("GET", URL)):
            response = await client.request(
                method, path, headers=who.headers, json={"password": PASSWORD}
            )
            assert response.status_code in (404, 405), (method, path)

        assert await _user_row(db, who.id)


class TestErrorsNeverCarryTheSecret:
    SECRET = "Hunter2-Very-Secret"

    async def _assert_clean(self, response: Response) -> None:
        assert self.SECRET not in response.text
        detail = response.json()["detail"]
        if isinstance(detail, list):
            assert all("input" not in error for error in detail), "no error carries the value"

    async def test_validation_errors_do_not_echo_what_was_sent(self, client: AsyncClient) -> None:
        who = await _signup(client, "efe")
        bodies: list[Any] = [
            {"password": self.SECRET, "user_id": "x"},
            {"password": self.SECRET * 100},
            {"password": [self.SECRET]},
            {"password": {"nested": self.SECRET}},
            {"pasword": self.SECRET},
            self.SECRET,
            [self.SECRET],
        ]

        for body in bodies:
            response = await client.post(URL, headers=who.headers, json=body)
            assert response.status_code == 422, body
            await self._assert_clean(response)
            assert response.json()["detail"], "the problem is still described"

    async def test_the_other_password_fields_are_covered_too(self, client: AsyncClient) -> None:
        """The same handler serves sign-in and sign-up."""
        login = await client.post(
            "/auth/login", json={"email": "a@example.com", "password": self.SECRET * 100}
        )
        register = await client.post(
            "/auth/register",
            json={"email": "a@example.com", "username": "aa", "password": [self.SECRET]},
        )

        for response in (login, register):
            assert response.status_code == 422
            await self._assert_clean(response)

    async def test_wrong_password_and_rate_limit_answers_do_not_carry_it(
        self, client: AsyncClient
    ) -> None:
        who = await _signup(client, "efe")

        wrong = await _delete(client, who, self.SECRET)
        assert wrong.status_code == 403
        await self._assert_clean(wrong)

        for _ in range(settings.RATE_LIMIT_DELETE_USER_LIMIT):
            await _delete(client, who, self.SECRET)
        limited = await _delete(client, who, self.SECRET)
        assert limited.status_code == 429
        await self._assert_clean(limited)

    async def test_the_password_is_not_in_the_application_log(
        self, client: AsyncClient, caplog: pytest.LogCaptureFixture
    ) -> None:
        who = await _signup(client, "efe")
        caplog.set_level("DEBUG")

        await _delete(client, who, self.SECRET)
        await client.post(URL, headers=who.headers, json={"password": [self.SECRET]})

        assert self.SECRET not in caplog.text


# ── the shared limiter ───────────────────────────────────────────────────


class TestBusyPasswordWork:
    async def test_a_busy_worker_refuses_with_503_deletes_nothing_and_spends_no_attempt(
        self, client: AsyncClient, db: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # One worker and no waiting place, taken by a sign-in whose check is held.
        monkeypatch.setattr(settings, "PASSWORD_WORK_WORKERS", 1)
        monkeypatch.setattr(settings, "PASSWORD_WORK_MAX_QUEUED", 0)
        who = await _signup(client, "efe")
        entered, release = threading.Event(), threading.Event()
        real = auth_service.verify_password

        def held(plain: str, password_hash: str) -> bool:
            entered.set()
            release.wait(timeout=10)
            return real(plain, password_hash)

        monkeypatch.setattr(auth_service, "verify_password", held)
        sign_in = asyncio.create_task(
            client.post("/auth/login", json={"email": who.email, "password": PASSWORD})
        )
        await wait_until(entered.is_set)

        refused = await _delete(client, who, "wrong")

        assert refused.status_code == 503
        assert refused.headers["Retry-After"] == "2"
        assert "wrong" not in refused.text
        release.set()
        assert (await sign_in).status_code == 200
        assert await _user_row(db, who.id)
        # The refused request counted for nothing: the whole allowance of wrong passwords
        # is still there, and only the one after it is refused.
        limit = settings.RATE_LIMIT_DELETE_USER_LIMIT
        for _ in range(limit):
            assert (await _delete(client, who, "wrong")).status_code == 403
        assert (await _delete(client, who, "wrong")).status_code == 429


class TestSharedRateLimit:
    async def test_wrong_passwords_are_limited_per_account_with_a_retry_after(
        self, client: AsyncClient, db: AsyncSession
    ) -> None:
        who = await _signup(client, "efe")
        limit = settings.RATE_LIMIT_DELETE_USER_LIMIT

        for _ in range(limit):
            assert (await _delete(client, who, "wrong")).status_code == 403
        refused = await _delete(client, who, "wrong")

        assert refused.status_code == 429
        assert int(refused.headers["Retry-After"]) >= 1
        # Even the right password waits: the limit is checked before the password.
        assert (await _delete(client, who)).status_code == 429
        assert await _user_row(db, who.id)

    async def test_one_account_using_up_its_attempts_does_not_lock_another_out(
        self, client: AsyncClient, db: AsyncSession
    ) -> None:
        attacker = await _signup(client, "efe")
        bystander = await _signup(client, "intruder")
        for _ in range(settings.RATE_LIMIT_DELETE_USER_LIMIT + 1):
            await _delete(client, attacker, "wrong")

        response = await _delete(client, bystander)

        assert response.status_code == 204
        assert not await _user_row(db, bystander.id)

    async def test_the_right_password_gives_its_attempt_back(self, client: AsyncClient) -> None:
        who = await _signup(client, "efe")
        for _ in range(settings.RATE_LIMIT_DELETE_USER_LIMIT - 1):
            assert (await _delete(client, who, "wrong")).status_code == 403

        # One attempt left, and it is the right one.
        assert (await _delete(client, who)).status_code == 204

    async def test_a_burst_of_wrong_passwords_cannot_overshoot_the_limit(
        self, client: AsyncClient
    ) -> None:
        who = await _signup(client, "efe")
        limit = settings.RATE_LIMIT_DELETE_USER_LIMIT

        responses = await asyncio.gather(*(_delete(client, who, "wrong") for _ in range(limit * 3)))

        statuses = sorted(response.status_code for response in responses)
        assert statuses.count(403) == limit
        assert statuses.count(429) == limit * 2

    async def test_the_limiter_is_the_shared_redis_one_and_keeps_no_identity(
        self, client: AsyncClient, rate_limiter: RateLimiter
    ) -> None:
        who = await _signup(client, "efe")
        await _delete(client, who, "wrong")

        keys = await stored_keys(rate_limiter)

        mine = [key for key in keys if "account-delete" in key]
        assert len(mine) == 2, "one account bucket and one address bucket"
        joined = " ".join(keys)
        assert who.id not in joined
        assert who.email not in joined
        assert "127.0.0.1" not in joined

    async def test_when_redis_cannot_answer_nothing_is_deleted(
        self, client: AsyncClient, db: AsyncSession
    ) -> None:
        who = await _signup(client, "efe")
        app.dependency_overrides[get_rate_limiter] = lambda: DeadRedis.refusing_limiter()

        response = await _delete(client, who)

        assert response.status_code == 503
        assert response.headers["Retry-After"] == "10"
        assert await _user_row(db, who.id)


# ── what is deleted ──────────────────────────────────────────────────────


async def _populate(
    client: AsyncClient, db: AsyncSession, who: Account, exercises: list[str]
) -> None:
    """Everything an account can own that is not about coaching."""
    # A second device, and a rotated session.
    login = await client.post("/auth/login", json={"email": who.email, "password": PASSWORD})
    assert login.status_code == 200
    rotated = await client.post("/auth/refresh", json={"refresh_token": who.refresh_token})
    assert rotated.status_code == 200

    # Profile and nutrition preferences.
    updated = await client.patch(
        "/users/me",
        headers=who.headers,
        json={
            "nutrition_goal": "bulk",
            "activity_level": "active",
            "height_cm": 180,
            "goal_weight_kg": 85,
            "bio": f"{who.name} lifts",
        },
    )
    assert updated.status_code == 200, updated.text

    # A program with a day, a workout started from it (plan snapshot), a logged workout,
    # a pending-write receipt for a set, and a template-save receipt.
    program_id = await _program(client, who.headers, exercises)
    templates = (await client.get(f"/programs/{program_id}", headers=who.headers)).json()[
        "templates"
    ]
    started = await client.post(f"/templates/{templates[0]['id']}/start", headers=who.headers)
    assert started.status_code in (200, 201), started.text
    workout_id = await _log(
        client,
        who.headers,
        title="Push",
        days_ago=2,
        sets=[_set(exercises[0], 80, 5), _set(exercises[1], 60, 8, rir=1)],
    )
    receipt = await client.put(
        f"/workouts/{workout_id}/sets/requests/{uuid4()}",
        headers=who.headers,
        json=_set(exercises[0], 82.5, 4),
    )
    assert receipt.status_code in (200, 201), receipt.text
    saved = await client.put(
        f"/programs/{program_id}/templates/requests/{uuid4()}",
        headers=who.headers,
        json={
            "name": "Pull",
            "day_order": 1,
            "exercises": [{"exercise_id": exercises[2], "target_sets": 3, "target_reps_min": 6}],
        },
    )
    assert saved.status_code in (200, 201), saved.text
    # An example program added to the user's own programs (a receipt and a copied program).
    copied = await client.put(
        f"/example-programs/requests/{uuid4()}",
        headers=who.headers,
        json={"example_id": "beginner-full-body-ab", "version": 1},
    )
    assert copied.status_code == 201, copied.text

    # Readiness and body measurements.
    assert (
        await client.put("/readiness/today", headers=who.headers, json={"sleep_hours": 7.5})
    ).status_code == 200
    assert (
        await client.put("/body/measurements", headers=who.headers, json={"weight_kg": 82.4})
    ).status_code == 200

    # A coach's own, never-used invite code.
    assert (await client.post("/coaching/enable", headers=who.headers)).status_code == 200
    assert (await client.post("/coaching/invites", headers=who.headers)).status_code == 201


class TestEverythingTheAccountOwnsIsDeleted:
    async def test_a_fully_used_account_leaves_nothing_but_the_catalogue(
        self, client: AsyncClient, db: AsyncSession, exercise_ids: list[str]
    ) -> None:
        catalogue_before = {table: await _count(db, table) for table in CATALOGUE}
        who = await _signup(client, "efe")
        await _populate(client, db, who, exercise_ids)
        populated = await _row_counts(db)
        for table in (
            "users",
            "refresh_tokens",
            "workouts",
            "sets",
            "set_save_requests",
            "programs",
            "workout_templates",
            "template_exercises",
            "template_save_requests",
            "example_program_copy_requests",
            "readiness_logs",
            "body_measurements",
            "coach_invites",
        ):
            assert populated[table] > 0, f"the fixture must exercise {table}"
        snapshots = await db.execute(
            text("SELECT count(*) FROM workouts WHERE template_snapshot IS NOT NULL")
        )
        assert snapshots.scalar_one() > 0, "a plan snapshot must exist"

        assert (await _delete(client, who)).status_code == 204

        after = await _row_counts(db)
        leftovers = {t: n for t, n in after.items() if n and t not in CATALOGUE}
        assert leftovers == {}
        assert {table: after[table] for table in CATALOGUE} == catalogue_before

    async def test_no_identifier_of_the_account_remains_anywhere(
        self, client: AsyncClient, db: AsyncSession, exercise_ids: list[str]
    ) -> None:
        who = await _signup(client, "zorbaxy")
        await _populate(client, db, who, exercise_ids)
        assert await _mentions(db, who.id, who.email, "zorbaxy")

        await _delete(client, who)

        assert await _mentions(db, who.id, who.email, "zorbaxy") == {}

    async def test_a_created_exercise_stays_in_the_catalogue_without_its_creator(
        self, client: AsyncClient, db: AsyncSession
    ) -> None:
        who = await _signup(client, "efe")
        exercise_id = uuid4()
        await db.execute(
            text("INSERT INTO exercises (id, name, created_by) VALUES (:i, 'Custom Curl', :u)"),
            {"i": exercise_id, "u": UUID(who.id)},
        )
        await db.commit()

        await _delete(client, who)

        row = (
            await db.execute(
                text("SELECT created_by FROM exercises WHERE id = :i"), {"i": exercise_id}
            )
        ).first()
        assert row is not None, "the catalogue entry is not deleted"
        assert row[0] is None
        await db.execute(text("DELETE FROM exercises WHERE id = :i"), {"i": exercise_id})
        await db.commit()

    async def test_other_accounts_are_untouched(
        self, client: AsyncClient, db: AsyncSession, exercise_ids: list[str]
    ) -> None:
        bystander = await _signup(client, "intruder")
        await _populate(client, db, bystander, exercise_ids)
        before = await _row_counts(db)
        leaver = await _signup(client, "efe")
        await _populate(client, db, leaver, exercise_ids)

        await _delete(client, leaver)

        assert await _row_counts(db) == before
        assert await _signed_in(client, bystander)
        assert (await client.get("/workouts", headers=bystander.headers)).json()["total"] >= 1


# ── sessions and tokens ──────────────────────────────────────────────────


class TestSessionsAndTokensEndWithTheAccount:
    async def test_the_old_access_token_stops_working_everywhere(self, client: AsyncClient) -> None:
        who = await _signup(client, "efe")

        await _delete(client, who)

        for path in ("/users/me", "/workouts", "/programs", "/readiness/today", "/body/summary"):
            assert (await client.get(path, headers=who.headers)).status_code == 401, path

    async def test_every_session_ends_not_only_the_one_that_deleted(
        self, client: AsyncClient
    ) -> None:
        who = await _signup(client, "efe")
        tablet = (
            await client.post("/auth/login", json={"email": who.email, "password": PASSWORD})
        ).json()["tokens"]
        rotated = (
            await client.post("/auth/refresh", json={"refresh_token": who.refresh_token})
        ).json()

        await _delete(client, who)

        for token in (who.refresh_token, tablet["refresh_token"], rotated["refresh_token"]):
            response = await client.post("/auth/refresh", json={"refresh_token": token})
            assert response.status_code == 401
        assert (
            await client.get(
                "/users/me", headers={"Authorization": f"Bearer {tablet['access_token']}"}
            )
        ).status_code == 401

    async def test_signing_in_again_fails_exactly_like_an_unknown_account(
        self, client: AsyncClient
    ) -> None:
        who = await _signup(client, "efe")
        await _delete(client, who)

        gone = await client.post("/auth/login", json={"email": who.email, "password": PASSWORD})
        never = await client.post(
            "/auth/login", json={"email": "nobody@example.com", "password": PASSWORD}
        )

        assert gone.status_code == never.status_code == 401
        assert gone.json() == never.json()

    async def test_logout_with_a_deleted_accounts_token_is_a_harmless_204(
        self, client: AsyncClient, db: AsyncSession
    ) -> None:
        who = await _signup(client, "efe")
        other = await _signup(client, "intruder")
        before = await _row_counts(db)
        await _delete(client, who)

        response = await client.post("/auth/logout", json={"refresh_token": who.refresh_token})

        assert response.status_code == 204
        assert await _signed_in(client, other)
        assert (await _row_counts(db))["refresh_tokens"] == before["refresh_tokens"] - 1

    async def test_an_old_refresh_token_is_not_a_theft_signal_for_anyone_else(
        self, client: AsyncClient
    ) -> None:
        who = await _signup(client, "efe")
        other = await _signup(client, "intruder")
        await _delete(client, who)

        late = await client.post("/auth/refresh", json={"refresh_token": who.refresh_token})

        assert late.status_code == 401
        assert "already used" not in late.json()["detail"]
        assert (
            await client.post("/auth/refresh", json={"refresh_token": other.refresh_token})
        ).status_code == 200

    async def test_registering_the_same_email_later_makes_a_new_empty_account(
        self, client: AsyncClient, db: AsyncSession, exercise_ids: list[str]
    ) -> None:
        old = await _signup(client, "efe")
        await _populate(client, db, old, exercise_ids)
        await _delete(client, old)

        new = await _signup(client, "efe")

        assert new.id != old.id
        assert (await client.get("/workouts", headers=new.headers)).json()["total"] == 0
        assert (await client.get("/programs", headers=new.headers)).json() == []
        # The old credentials still do not work as the old account.
        assert (await client.get("/users/me", headers=old.headers)).status_code == 401


class TestRepeatedAndUncertainRequests:
    async def test_a_repeat_after_success_is_a_plain_401_and_changes_nothing(
        self, client: AsyncClient, db: AsyncSession
    ) -> None:
        who = await _signup(client, "efe")
        other = await _signup(client, "intruder")
        assert (await _delete(client, who)).status_code == 204
        before = await _row_counts(db)

        again = await _delete(client, who)

        assert again.status_code == 401
        assert await _row_counts(db) == before
        assert await _signed_in(client, other)

    async def test_a_repeat_says_nothing_a_stranger_could_not_get_with_a_garbage_token(
        self, client: AsyncClient
    ) -> None:
        """No probe: "already deleted" is indistinguishable from "not signed in"."""
        who = await _signup(client, "efe")
        await _delete(client, who)

        repeat = await _delete(client, who)
        garbage = await client.post(
            URL, headers={"Authorization": "Bearer nope"}, json={"password": PASSWORD}
        )

        assert repeat.status_code == garbage.status_code == 401
        assert repeat.json() == garbage.json()

    async def test_two_requests_at_once_delete_once(
        self, client: AsyncClient, db: AsyncSession
    ) -> None:
        who = await _signup(client, "efe")
        other = await _signup(client, "intruder")

        first, second = await asyncio.gather(_delete(client, who), _delete(client, who))

        assert sorted([first.status_code, second.status_code]) == [204, 401]
        assert not await _user_row(db, who.id)
        assert await _user_row(db, other.id)
        assert await _signed_in(client, other)


# ── coaching: whose record is whose ──────────────────────────────────────


@dataclass
class World:
    coach: Account
    ava: Account  # an athlete of `coach` and of `dana`
    ben: Account  # another athlete of `coach`
    dana: Account  # a second coach
    link_ava: str
    link_ben: str
    link_dana: str
    ava_workout: str  # shared, with feedback from `coach`
    ava_template_workout: str  # started from the copy `coach` sent
    ava_copy: str  # Ava's accepted copy of coach's version 1
    ava_pending: str  # coach's version 2, not yet answered
    ben_pending: str  # coach's version 1 for Ben, not yet answered
    dana_copy: str  # Ava's accepted copy of Dana's program
    coach_program: str  # coach's own active program
    lineage_ava: dict[str, Any]
    lineage_ben: dict[str, Any]


async def _world(client: AsyncClient, exercises: list[str]) -> World:
    coach = await _signup(client, "coachcora9")
    ava = await _signup(client, "avery9")
    ben = await _signup(client, "blake9")
    dana = await _signup(client, "dana9")
    for who in (coach, dana):
        assert (await client.post("/coaching/enable", headers=who.headers)).status_code == 200

    link_ava = await _connect(client, coach.headers, ava.headers)
    link_ben = await _connect(client, coach.headers, ben.headers)
    link_dana = await _connect(client, dana.headers, ava.headers)
    assert (await _share(client, ava.headers, link_ava)).status_code == 200

    coach_program = await _program(client, coach.headers, exercises, name="Coach Own")

    lineage_ava = await _ready(client, coach.headers, link_ava, exercises, name="For Ava")
    first = await _version(client, coach.headers, link_ava, lineage_ava["id"])
    accepted = await _accept_offer(client, ava.headers, first["id"])
    assert accepted.status_code == 200, accepted.text
    ava_copy = str(accepted.json()["program_id"])
    second = await _publish_edit(client, coach.headers, link_ava, lineage_ava, exercises, 5)

    lineage_ben = await _ready(client, coach.headers, link_ben, exercises, name="For Ben")
    ben_first = await _version(client, coach.headers, link_ben, lineage_ben["id"])

    dana_program = await _program(client, dana.headers, exercises, name="Dana Plan")
    dana_offer = await _offer(client, dana.headers, link_dana, dana_program)
    dana_accepted = await _accept_offer(client, ava.headers, dana_offer)
    assert dana_accepted.status_code == 200, dana_accepted.text

    ava_workout = await _log(
        client, ava.headers, title="Push", days_ago=1, sets=[_set(exercises[0], 80, 5, rir=2)]
    )
    copy_templates = (await client.get(f"/programs/{ava_copy}", headers=ava.headers)).json()[
        "templates"
    ]
    started = await client.post(f"/templates/{copy_templates[0]['id']}/start", headers=ava.headers)
    assert started.status_code in (200, 201), started.text
    ava_template_workout = str(started.json()["workout_id"])
    note = await _feedback(client, coach.headers, link_ava, ava_workout, "Good work, add a set.")
    assert note.status_code in (200, 201), note.text

    return World(
        coach=coach,
        ava=ava,
        ben=ben,
        dana=dana,
        link_ava=link_ava,
        link_ben=link_ben,
        link_dana=link_dana,
        ava_workout=ava_workout,
        ava_template_workout=ava_template_workout,
        ava_copy=ava_copy,
        ava_pending=str(second["id"]),
        ben_pending=str(ben_first["id"]),
        dana_copy=str(dana_accepted.json()["program_id"]),
        coach_program=coach_program,
        lineage_ava=lineage_ava,
        lineage_ben=lineage_ben,
    )


async def _owned(db: AsyncSession, user_id: str) -> dict[str, int]:
    """How much one account owns, counted from the database."""
    uid = {"u": UUID(user_id)}
    queries = {
        "workouts": "SELECT count(*) FROM workouts WHERE user_id = :u",
        "sets": (
            "SELECT count(*) FROM sets s JOIN workouts w ON w.id = s.workout_id "
            "WHERE w.user_id = :u"
        ),
        "snapshots": (
            "SELECT count(*) FROM workouts WHERE user_id = :u AND template_snapshot IS NOT NULL"
        ),
        "programs": "SELECT count(*) FROM programs WHERE user_id = :u",
        "templates": (
            "SELECT count(*) FROM workout_templates t JOIN programs p ON p.id = t.program_id "
            "WHERE p.user_id = :u"
        ),
        "template_exercises": (
            "SELECT count(*) FROM template_exercises e "
            "JOIN workout_templates t ON t.id = e.template_id "
            "JOIN programs p ON p.id = t.program_id WHERE p.user_id = :u"
        ),
        "links": "SELECT count(*) FROM coach_athlete_links WHERE coach_id = :u OR athlete_id = :u",
        "sessions": "SELECT count(*) FROM refresh_tokens WHERE user_id = :u",
    }
    return {
        name: int((await db.execute(text(sql), uid)).scalar_one()) for name, sql in queries.items()
    }


class TestACoachDeletesTheAccount:
    async def test_the_athletes_copies_and_workouts_survive_without_a_trace_of_the_coach(
        self, client: AsyncClient, db: AsyncSession, exercise_ids: list[str]
    ) -> None:
        w = await _world(client, exercise_ids)
        owned_before = await _owned(db, w.ava.id)
        copy_before = _shape(
            (await client.get(f"/programs/{w.ava_copy}", headers=w.ava.headers)).json()
        )
        programs_before = await _programs(client, w.ava.headers)
        snapshot_before = (
            await db.execute(
                text("SELECT template_snapshot FROM workouts WHERE id = :i"),
                {"i": UUID(w.ava_template_workout)},
            )
        ).scalar_one()
        assert snapshot_before is not None

        assert (await _delete(client, w.coach)).status_code == 204

        # The athlete's records are exactly as they were.
        assert await _owned(db, w.ava.id) == {**owned_before, "links": 1}
        assert (
            _shape((await client.get(f"/programs/{w.ava_copy}", headers=w.ava.headers)).json())
            == copy_before
        )
        assert await _programs(client, w.ava.headers) == programs_before
        assert (
            await db.execute(
                text("SELECT template_snapshot FROM workouts WHERE id = :i"),
                {"i": UUID(w.ava_template_workout)},
            )
        ).scalar_one() == snapshot_before
        assert (await client.get("/workouts", headers=w.ava.headers)).json()["total"] == 2
        # The other coach and the other athlete's connection are not affected.
        assert [
            c["person"]["username"]
            for c in (await client.get("/coaching/coaches", headers=w.ava.headers)).json()["items"]
        ] == ["dana9"]
        # Nothing anywhere names the deleted coach.
        assert await _mentions(db, w.coach.id, w.coach.email, "coachcora9") == {}

    async def test_nothing_actionable_is_left_from_the_deleted_coach(
        self, client: AsyncClient, db: AsyncSession, exercise_ids: list[str]
    ) -> None:
        w = await _world(client, exercise_ids)

        await _delete(client, w.coach)

        assert (await _accept_offer(client, w.ava.headers, w.ava_pending)).status_code == 404
        assert (await _accept_offer(client, w.ben.headers, w.ben_pending)).status_code == 404
        received = (await client.get("/coaching/program-offers", headers=w.ava.headers)).json()
        assert [offer["id"] for offer in received["items"]] == [received["items"][0]["id"]]
        assert received["items"][0]["status"] == "accepted", "only Dana's remains"
        assert (await client.get("/coaching/coaches", headers=w.ben.headers)).json()["items"] == []
        assert await _count(db, "program_offers") == 1
        assert await _count(db, "program_lineages") == 0

    async def test_feedback_the_coach_wrote_goes_with_the_coach_not_the_workout(
        self, client: AsyncClient, db: AsyncSession, exercise_ids: list[str]
    ) -> None:
        w = await _world(client, exercise_ids)
        assert await _count(db, "workout_feedback") == 1

        await _delete(client, w.coach)

        assert await _count(db, "workout_feedback") == 0
        assert (
            await client.get(f"/workouts/{w.ava_workout}", headers=w.ava.headers)
        ).status_code == 200

    async def test_the_athletes_other_coach_and_their_copy_are_untouched(
        self, client: AsyncClient, db: AsyncSession, exercise_ids: list[str]
    ) -> None:
        w = await _world(client, exercise_ids)
        dana_before = await _owned(db, w.dana.id)

        await _delete(client, w.coach)

        assert await _owned(db, w.dana.id) == dana_before
        assert (
            await client.get(f"/programs/{w.dana_copy}", headers=w.ava.headers)
        ).status_code == 200
        assert await _signed_in(client, w.dana)
        assert await _signed_in(client, w.ben)


class TestAnAthleteDeletesTheAccount:
    async def test_the_coaches_unrelated_programs_and_other_athletes_survive(
        self, client: AsyncClient, db: AsyncSession, exercise_ids: list[str]
    ) -> None:
        w = await _world(client, exercise_ids)
        coach_programs_before = len(await _programs(client, w.coach.headers))
        ben_before = await _owned(db, w.ben.id)

        assert (await _delete(client, w.ava)).status_code == 204

        coach_programs = await _programs(client, w.coach.headers)
        own = next(p for p in coach_programs if p["id"] == w.coach_program)
        assert own["is_active"] is True
        assert (
            await client.get(f"/programs/{w.coach_program}", headers=w.coach.headers)
        ).status_code == 200
        # Ben's connection, preparation and pending version are exactly as they were.
        assert await _owned(db, w.ben.id) == {**ben_before}
        athletes = (await client.get("/coaching/athletes", headers=w.coach.headers)).json()["items"]
        assert [a["person"]["username"] for a in athletes] == ["blake9"]
        assert (
            await client.get(f"/coaching/program-offers/{w.ben_pending}", headers=w.ben.headers)
        ).status_code == 200
        assert await _count(db, "program_lineages") == 1
        # What was prepared for Ava was hidden from the coach's list while it was a
        # preparation; it is now an ordinary, inactive program of the coach's. Ben's stays hidden.
        assert len(coach_programs) == coach_programs_before + 1
        draft = next(p for p in coach_programs if p["id"] == w.lineage_ava["draft_program_id"])
        assert draft["is_active"] is False
        detail = (await client.get(f"/programs/{draft['id']}", headers=w.coach.headers)).json()
        assert detail.get("prepared_for") is None

    async def test_the_coach_is_left_with_no_record_that_names_the_athlete(
        self, client: AsyncClient, db: AsyncSession, exercise_ids: list[str]
    ) -> None:
        w = await _world(client, exercise_ids)

        await _delete(client, w.ava)

        assert await _mentions(db, w.ava.id, w.ava.email, "avery9") == {}
        assert (
            await client.get(f"/coaching/athletes/{w.link_ava}", headers=w.coach.headers)
        ).status_code == 404
        # The two codes the athlete used are gone; only the one Ben used remains.
        assert await _count(db, "coach_invites") == 1

    async def test_another_coach_of_the_same_athlete_is_left_with_nothing_either(
        self, client: AsyncClient, db: AsyncSession, exercise_ids: list[str]
    ) -> None:
        w = await _world(client, exercise_ids)
        dana_programs = await _programs(client, w.dana.headers)

        await _delete(client, w.ava)

        assert (await client.get("/coaching/athletes", headers=w.dana.headers)).json()[
            "items"
        ] == []
        assert await _programs(client, w.dana.headers) == dana_programs
        assert await _count(db, "program_offers") == 1, "only Ben's pending version remains"


class TestNothingIsLeftBehindWhenEveryoneLeaves:
    async def test_deleting_every_account_empties_every_table_but_the_catalogue(
        self, client: AsyncClient, db: AsyncSession, exercise_ids: list[str]
    ) -> None:
        catalogue = {table: await _count(db, table) for table in CATALOGUE}
        w = await _world(client, exercise_ids)
        populated = await _row_counts(db)
        for table in (
            "coach_athlete_links",
            "coach_invites",
            "program_lineages",
            "program_offers",
            "workout_feedback",
            "workouts",
            "sets",
            "programs",
            "workout_templates",
            "template_exercises",
            "refresh_tokens",
        ):
            assert populated[table] > 0, table

        for who in (w.coach, w.ava, w.ben, w.dana):
            assert (await _delete(client, who)).status_code == 204

        after = await _row_counts(db)
        assert {t: n for t, n in after.items() if n and t not in CATALOGUE} == {}
        assert {t: after[t] for t in CATALOGUE} == catalogue


class TestEveryReferenceToAUserHasADecision:
    """Fails when a new table points at `users`, so the policy in deletion.py is revisited."""

    EXPECTED = {
        ("body_measurements", "user_id", "CASCADE"),
        ("coach_athlete_links", "athlete_id", "CASCADE"),
        ("coach_athlete_links", "coach_id", "CASCADE"),
        ("coach_athlete_links", "ended_by_id", "SET NULL"),
        ("coach_invites", "accepted_by_id", "SET NULL"),
        ("coach_invites", "coach_id", "CASCADE"),
        ("example_program_copy_requests", "user_id", "CASCADE"),
        ("exercises", "created_by", "SET NULL"),
        ("password_reset_challenges", "user_id", "CASCADE"),
        ("program_lineages", "coach_id", "CASCADE"),
        ("program_offers", "coach_id", "CASCADE"),
        ("programs", "user_id", "CASCADE"),
        ("readiness_logs", "user_id", "CASCADE"),
        ("refresh_tokens", "user_id", "CASCADE"),
        ("template_save_requests", "user_id", "CASCADE"),
        # Linked Google/Apple identities belong to the account and go with it.
        ("user_identities", "user_id", "CASCADE"),
        ("workouts", "user_id", "CASCADE"),
    }

    async def test_the_references_to_users_are_the_audited_ones(self, db: AsyncSession) -> None:
        rows = await db.execute(
            text(
                """
                SELECT c.conrelid::regclass::text, a.attname,
                       CASE c.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
                            WHEN 'r' THEN 'RESTRICT' WHEN 'a' THEN 'NO ACTION' ELSE 'OTHER' END
                FROM pg_constraint c
                JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
                WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass
                """
            )
        )
        assert {tuple(row) for row in rows} == self.EXPECTED


# ── failures and races ───────────────────────────────────────────────────


@asynccontextmanager
async def _users_delete_trigger(db: AsyncSession, body: str) -> AsyncIterator[None]:
    """Run `body` (plpgsql) just before a users row is deleted. Always removed again."""
    await db.execute(
        text(
            f"CREATE OR REPLACE FUNCTION test_before_user_delete() RETURNS trigger AS $$ "
            f"BEGIN {body} RETURN OLD; END $$ LANGUAGE plpgsql"
        )
    )
    await db.execute(
        text(
            "CREATE TRIGGER test_before_user_delete BEFORE DELETE ON users "
            "FOR EACH ROW EXECUTE FUNCTION test_before_user_delete()"
        )
    )
    await db.commit()
    try:
        yield
    finally:
        await db.rollback()
        await db.execute(text("DROP TRIGGER IF EXISTS test_before_user_delete ON users"))
        await db.execute(text("DROP FUNCTION IF EXISTS test_before_user_delete()"))
        await db.commit()


class _Orig(Exception):
    def __init__(self, sqlstate: str) -> None:
        super().__init__(sqlstate)
        self.sqlstate = sqlstate


def _db_error(sqlstate: str) -> DBAPIError:
    return DBAPIError("DELETE", {}, _Orig(sqlstate))


class TestFailedAndRetriedDeletion:
    async def test_a_failure_part_way_deletes_nothing(
        self, client: AsyncClient, db: AsyncSession, exercise_ids: list[str]
    ) -> None:
        w = await _world(client, exercise_ids)
        before = await _row_counts(db)

        # The connections and codes are deleted before the user row is reached; the
        # failure at the very end must take them back.
        async with _users_delete_trigger(db, "RAISE EXCEPTION 'blocked for the test';"):
            with pytest.raises(DBAPIError):
                await _delete(client, w.coach)

        assert await _row_counts(db) == before
        assert await _signed_in(client, w.coach)
        assert await _signed_in(client, w.ava)

    async def test_a_deadlock_is_retried_and_then_succeeds(
        self, client: AsyncClient, db: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        who = await _signup(client, "efe")
        real = programs_service.lock_active_program
        calls: list[int] = []

        async def flaky(session: AsyncSession, user_id: UUID) -> None:
            calls.append(1)
            if len(calls) == 1:
                raise _db_error("40P01")
            await real(session, user_id)

        monkeypatch.setattr(LOCK, flaky)

        assert (await _delete(client, who)).status_code == 204
        assert len(calls) == 2
        assert not await _user_row(db, who.id)

    async def test_a_deadlock_that_never_clears_says_nothing_was_deleted(
        self, client: AsyncClient, db: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        who = await _signup(client, "efe")

        async def always(session: AsyncSession, user_id: UUID) -> None:
            raise _db_error("40P01")

        monkeypatch.setattr(LOCK, always)

        response = await _delete(client, who)

        assert response.status_code == 503
        assert "Nothing was deleted" in response.json()["detail"]
        assert response.headers["Retry-After"] == "5"
        monkeypatch.undo()
        assert await _user_row(db, who.id)
        assert await _signed_in(client, who)

    async def test_an_unexpected_database_error_is_not_retried_and_deletes_nothing(
        self, client: AsyncClient, db: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        who = await _signup(client, "efe")
        calls: list[int] = []

        async def broken(session: AsyncSession, user_id: UUID) -> None:
            calls.append(1)
            raise _db_error("XX000")

        monkeypatch.setattr(LOCK, broken)

        with pytest.raises(DBAPIError):
            await _delete(client, who)

        monkeypatch.undo()
        assert len(calls) == 1
        assert await _user_row(db, who.id)

    async def test_a_wrong_password_never_reaches_the_database_work(
        self, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        who = await _signup(client, "efe")

        async def must_not_run(*args: Any, **kwargs: Any) -> None:
            raise AssertionError("the erase ran for a wrong password")

        monkeypatch.setattr(deletion, "_erase", must_not_run)

        assert (await _delete(client, who, "wrong")).status_code == 403


class TestRacesWithDeletion:
    async def test_a_rotation_in_progress_finishes_first_and_its_new_token_goes_too(
        self, client: AsyncClient, db: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        who = await _signup(client, "efe")
        original = auth_service._issue_token_pair

        async def slow(*args: Any, **kwargs: Any) -> Any:
            pair = await original(*args, **kwargs)
            await asyncio.sleep(0.5)  # the rotation is open: row locked, successor uncommitted
            return pair

        monkeypatch.setattr(auth_service, "_issue_token_pair", slow)

        refreshing = asyncio.create_task(
            client.post("/auth/refresh", json={"refresh_token": who.refresh_token})
        )
        await asyncio.sleep(0.15)
        deleted = await _delete(client, who)
        refreshed = await refreshing
        monkeypatch.undo()

        assert deleted.status_code == 204
        assert refreshed.status_code == 200, "the rotation was already under way"
        assert not await _user_row(db, who.id)
        assert (await _owned(db, who.id))[
            "sessions"
        ] == 0, "the successor token went with the account"
        late = await client.post(
            "/auth/refresh", json={"refresh_token": refreshed.json()["refresh_token"]}
        )
        assert late.status_code == 401

    async def test_a_refresh_arriving_during_deletion_cannot_mint_a_usable_session(
        self, client: AsyncClient, db: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        who = await _signup(client, "efe")
        real = programs_service.lock_active_program

        reached = asyncio.Event()

        async def slow(session: AsyncSession, user_id: UUID) -> None:
            await real(session, user_id)
            reached.set()
            await asyncio.sleep(0.5)  # the session locks are held, the user row is not yet

        monkeypatch.setattr(LOCK, slow)

        deleting = asyncio.create_task(_delete(client, who))
        # The password check runs in a worker first; wait for the lock stage, not a fixed time.
        await asyncio.wait_for(reached.wait(), timeout=10)
        refreshed = await client.post("/auth/refresh", json={"refresh_token": who.refresh_token})
        deleted = await deleting
        monkeypatch.undo()

        assert deleted.status_code == 204
        assert refreshed.status_code == 401
        assert (await _owned(db, who.id))["sessions"] == 0

    async def test_a_sign_in_that_commits_during_deletion_is_removed_with_the_account(
        self, client: AsyncClient, db: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        who = await _signup(client, "efe")
        real = programs_service.lock_active_program

        reached = asyncio.Event()

        async def slow(session: AsyncSession, user_id: UUID) -> None:
            await real(session, user_id)
            reached.set()
            await asyncio.sleep(0.6)

        monkeypatch.setattr(LOCK, slow)

        deleting = asyncio.create_task(_delete(client, who))
        await asyncio.wait_for(reached.wait(), timeout=10)
        login = await client.post("/auth/login", json={"email": who.email, "password": PASSWORD})
        deleted = await deleting
        monkeypatch.undo()

        assert deleted.status_code == 204
        assert login.status_code == 200, "it committed before the user row was locked"
        assert (await _owned(db, who.id))["sessions"] == 0
        minted = login.json()["tokens"]
        assert (
            await client.post("/auth/refresh", json={"refresh_token": minted["refresh_token"]})
        ).status_code == 401
        assert (
            await client.get(
                "/users/me", headers={"Authorization": f"Bearer {minted['access_token']}"}
            )
        ).status_code == 401

    async def test_a_sign_in_refused_by_the_deletion_is_a_plain_401_not_a_server_error(
        self, client: AsyncClient, db: AsyncSession
    ) -> None:
        who = await _signup(client, "efe")

        # The user row is locked and about to go for a second and a half.
        async with _users_delete_trigger(db, "PERFORM pg_sleep(1.5);"):
            deleting = asyncio.create_task(_delete(client, who))
            await asyncio.sleep(0.5)
            login = await client.post(
                "/auth/login", json={"email": who.email, "password": PASSWORD}
            )
            deleted = await deleting

        assert deleted.status_code == 204
        assert login.status_code == 401
        assert login.json() == {"detail": "Invalid email or password"}
        assert (await _owned(db, who.id))["sessions"] == 0

    async def test_a_refresh_refused_by_the_deletion_is_a_plain_401(
        self, client: AsyncClient, db: AsyncSession
    ) -> None:
        who = await _signup(client, "efe")

        async with _users_delete_trigger(db, "PERFORM pg_sleep(1.5);"):
            deleting = asyncio.create_task(_delete(client, who))
            await asyncio.sleep(0.5)
            refreshed = await client.post(
                "/auth/refresh", json={"refresh_token": who.refresh_token}
            )
            deleted = await deleting

        assert deleted.status_code == 204
        assert refreshed.status_code == 401
        assert (await _owned(db, who.id))["sessions"] == 0

    async def test_writes_racing_the_deletion_leave_no_orphan_and_no_server_error(
        self, client: AsyncClient, db: AsyncSession, exercise_ids: list[str]
    ) -> None:
        who = await _signup(client, "efe")

        async with _users_delete_trigger(db, "PERFORM pg_sleep(1.5);"):
            deleting = asyncio.create_task(_delete(client, who))
            await asyncio.sleep(0.5)
            writes = await asyncio.gather(
                client.post(
                    "/workouts",
                    headers=who.headers,
                    json={"title": "Late", "sets": [_set(exercise_ids[0], 50, 5)]},
                ),
                client.post("/programs", headers=who.headers, json={"name": "Late program"}),
                client.put("/readiness/today", headers=who.headers, json={"sleep_hours": 8}),
                client.put("/body/measurements", headers=who.headers, json={"weight_kg": 80}),
            )
            deleted = await deleting

        assert deleted.status_code == 204
        assert [response.status_code for response in writes] == [401] * 4
        assert all(
            response.json() == {"detail": "Invalid or expired access token"} for response in writes
        )
        assert {t: n for t, n in (await _row_counts(db)).items() if n and t not in CATALOGUE} == {}

    async def test_writes_that_win_the_race_are_removed_with_the_account(
        self,
        client: AsyncClient,
        db: AsyncSession,
        exercise_ids: list[str],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        who = await _signup(client, "efe")
        real = programs_service.lock_active_program

        reached = asyncio.Event()

        async def slow(session: AsyncSession, user_id: UUID) -> None:
            await real(session, user_id)
            reached.set()
            await asyncio.sleep(0.6)

        monkeypatch.setattr(LOCK, slow)

        deleting = asyncio.create_task(_delete(client, who))
        await asyncio.wait_for(reached.wait(), timeout=10)
        write = await client.post(
            "/workouts",
            headers=who.headers,
            json={"title": "Early", "sets": [_set(exercise_ids[0], 50, 5)]},
        )
        deleted = await deleting
        monkeypatch.undo()

        assert deleted.status_code == 204
        assert write.status_code == 201
        assert {t: n for t, n in (await _row_counts(db)).items() if n and t not in CATALOGUE} == {}

    async def test_an_offer_accepted_while_the_coach_is_deleted_is_all_or_nothing(
        self, client: AsyncClient, db: AsyncSession, exercise_ids: list[str]
    ) -> None:
        coach = await _signup(client, "coachcora9")
        athlete = await _signup(client, "avery9")
        assert (await client.post("/coaching/enable", headers=coach.headers)).status_code == 200
        link = await _connect(client, coach.headers, athlete.headers)
        lineage = await _ready(client, coach.headers, link, exercise_ids)
        offer = await _version(client, coach.headers, link, lineage["id"])

        accepting, deleting = await asyncio.gather(
            _accept_offer(client, athlete.headers, offer["id"]), _delete(client, coach)
        )

        assert deleting.status_code == 204
        assert accepting.status_code in (200, 404), accepting.text
        programs = await _programs(client, athlete.headers)
        assert len(programs) == (1 if accepting.status_code == 200 else 0)
        assert await _mentions(db, coach.id, coach.email, "coachcora9") == {}
        owned = await _owned(db, athlete.id)
        assert owned["links"] == 0
        assert await _signed_in(client, athlete)
