"""Tests for coach mode, invites and coach-athlete links.

Everything runs against the real test database. The point of most of these is
authorisation: who may create, read, accept and end what.
"""

import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_token
from app.domains.coaching.ratelimit import invite_code_limiter
from app.models import CoachAthleteLink, CoachInvite

Headers = dict[str, str]


@pytest.fixture(autouse=True)
def _fresh_limiter() -> None:
    """The limiter lives in process memory; keep tests independent."""
    invite_code_limiter.reset()


async def _register(client: AsyncClient, username: str) -> Headers:
    response = await client.post(
        "/auth/register",
        json={
            "email": f"{username}@example.com",
            "username": username,
            "password": "supersecret123",
            "first_name": username.capitalize(),
        },
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['tokens']['access_token']}"}


@pytest.fixture
async def coach(client: AsyncClient, auth_headers: Headers) -> Headers:
    """`efe`, with coach tools on."""
    response = await client.post("/coaching/enable", headers=auth_headers)
    assert response.status_code == 200, response.text
    return auth_headers


@pytest.fixture
async def athlete(other_auth_headers: Headers) -> Headers:
    return other_auth_headers


async def _invite(client: AsyncClient, headers: Headers) -> str:
    response = await client.post("/coaching/invites", headers=headers)
    assert response.status_code == 201, response.text
    return str(response.json()["code"])


async def _accept(client: AsyncClient, headers: Headers, code: str):  # type: ignore[no-untyped-def]
    return await client.post("/coaching/invites/accept", headers=headers, json={"code": code})


async def _preview(client: AsyncClient, headers: Headers, code: str):  # type: ignore[no-untyped-def]
    return await client.post("/coaching/invites/preview", headers=headers, json={"code": code})


async def _connect(client: AsyncClient, coach: Headers, athlete: Headers) -> str:
    response = await _accept(client, athlete, await _invite(client, coach))
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


class TestCoachMode:
    async def test_off_by_default_and_visible_on_the_profile(
        self, client: AsyncClient, auth_headers: Headers
    ) -> None:
        response = await client.get("/users/me", headers=auth_headers)
        assert response.json()["coach_enabled"] is False

    async def test_enabling_is_idempotent_and_returns_the_profile(
        self, client: AsyncClient, auth_headers: Headers
    ) -> None:
        first = await client.post("/coaching/enable", headers=auth_headers)
        second = await client.post("/coaching/enable", headers=auth_headers)

        assert first.status_code == second.status_code == 200
        assert first.json()["coach_enabled"] is True
        assert second.json()["username"] == "efe"

    async def test_it_cannot_be_set_through_the_profile_patch(
        self, client: AsyncClient, auth_headers: Headers
    ) -> None:
        response = await client.patch(
            "/users/me", headers=auth_headers, json={"coach_enabled": True, "bio": "hi"}
        )

        assert response.status_code == 200
        assert response.json()["coach_enabled"] is False

    async def test_personal_training_keeps_working_afterwards(
        self, client: AsyncClient, coach: Headers
    ) -> None:
        workout = await client.post("/workouts", headers=coach, json={"title": "Push"})
        program = await client.post("/programs", headers=coach, json={"name": "PPL"})

        assert workout.status_code == 201, workout.text
        assert program.status_code == 201, program.text
        assert (await client.get("/workouts", headers=coach)).status_code == 200
        assert (await client.get("/users/me", headers=coach)).json()["coach_enabled"] is True

    async def test_enabling_gives_no_access_to_other_users(
        self, client: AsyncClient, coach: Headers, athlete: Headers
    ) -> None:
        theirs = await client.post("/workouts", headers=athlete, json={"title": "Private"})
        assert theirs.status_code == 201

        listed = await client.get("/workouts", headers=coach)
        fetched = await client.get(f"/workouts/{theirs.json()['id']}", headers=coach)

        assert listed.json()["items"] == []
        assert fetched.status_code == 404

    async def test_coach_actions_need_coach_mode(
        self, client: AsyncClient, auth_headers: Headers
    ) -> None:
        assert (await client.post("/coaching/invites", headers=auth_headers)).status_code == 403
        assert (await client.get("/coaching/athletes", headers=auth_headers)).status_code == 403


class TestAuthentication:
    @pytest.mark.parametrize(
        ("method", "path"),
        [
            ("POST", "/coaching/enable"),
            ("POST", "/coaching/invites"),
            ("POST", "/coaching/invites/preview"),
            ("POST", "/coaching/invites/accept"),
            ("GET", "/coaching/athletes"),
            ("GET", "/coaching/coaches"),
            ("DELETE", "/coaching/links/00000000-0000-0000-0000-000000000000"),
        ],
    )
    async def test_every_endpoint_requires_a_token(
        self, client: AsyncClient, method: str, path: str
    ) -> None:
        body = {"code": "x"} if method == "POST" else None
        response = await client.request(method, path, json=body)
        assert response.status_code == 401


class TestCreateInvite:
    async def test_returns_a_readable_code_that_is_shown_once(
        self, client: AsyncClient, coach: Headers, db: AsyncSession
    ) -> None:
        response = await client.post("/coaching/invites", headers=coach)

        assert response.status_code == 201
        assert response.headers["cache-control"] == "no-store"
        body = response.json()
        code = body["code"]
        assert len(code.replace("-", "")) == 12
        assert code.count("-") == 2
        expires = datetime.fromisoformat(body["expires_at"])
        assert timedelta(hours=47) < expires - datetime.now(UTC) <= timedelta(hours=48)

        # Only the hash is stored: the code itself appears nowhere in the table.
        stored = (await db.execute(select(CoachInvite))).scalars().one()
        assert stored.code_hash == hash_token(code.replace("-", ""))
        dump = await db.scalar(text("SELECT string_agg(t::text, ' ') FROM coach_invites t"))
        assert code.replace("-", "") not in (dump or "")

    async def test_codes_are_distinct(self, client: AsyncClient, coach: Headers) -> None:
        codes = {await _invite(client, coach) for _ in range(5)}
        assert len(codes) == 5

    async def test_only_the_newest_ten_stay_open(
        self, client: AsyncClient, coach: Headers, athlete: Headers
    ) -> None:
        first = await _invite(client, coach)
        for _ in range(10):
            await _invite(client, coach)

        retired = await _accept(client, athlete, first)
        assert retired.status_code == 410


class TestPreviewAndAccept:
    async def test_preview_names_the_coach_without_connecting(
        self, client: AsyncClient, coach: Headers, athlete: Headers, db: AsyncSession
    ) -> None:
        code = await _invite(client, coach)

        preview = await _preview(client, athlete, code)

        assert preview.status_code == 200, preview.text
        assert preview.json()["coach"] == {
            "username": "efe",
            "first_name": "Efe",
            "last_name": None,
        }
        assert "email" not in str(preview.json())
        assert await db.scalar(select(func.count()).select_from(CoachAthleteLink)) == 0
        assert (await client.get("/coaching/coaches", headers=athlete)).json()["items"] == []

    async def test_code_is_forgiving_about_case_and_separators(
        self, client: AsyncClient, coach: Headers, athlete: Headers
    ) -> None:
        code = await _invite(client, coach)
        typed = " " + code.lower().replace("-", " ") + " "

        response = await _accept(client, athlete, typed)

        assert response.status_code == 201, response.text

    async def test_both_sides_see_the_link_with_no_extra_personal_data(
        self, client: AsyncClient, coach: Headers, athlete: Headers
    ) -> None:
        link_id = await _connect(client, coach, athlete)

        mine = (await client.get("/coaching/athletes", headers=coach)).json()["items"]
        theirs = (await client.get("/coaching/coaches", headers=athlete)).json()["items"]

        assert [item["id"] for item in mine] == [link_id]
        assert mine[0]["person"] == {"username": "intruder", "first_name": None, "last_name": None}
        assert set(mine[0]) == {"id", "person", "connected_at"}
        assert [item["id"] for item in theirs] == [link_id]
        assert theirs[0]["person"]["username"] == "efe"
        assert "email" not in str(mine) + str(theirs)

    async def test_a_connected_coach_still_sees_none_of_the_athletes_training_data(
        self, client: AsyncClient, coach: Headers, athlete: Headers
    ) -> None:
        workout = (await client.post("/workouts", headers=athlete, json={"title": "Legs"})).json()
        program = (await client.post("/programs", headers=athlete, json={"name": "PPL"})).json()
        weigh_in = await client.put(
            "/body/measurements", headers=athlete, json={"weight_kg": "81.5"}
        )
        assert weigh_in.status_code == 200, weigh_in.text
        await _connect(client, coach, athlete)

        workout_id, program_id = workout["id"], program["id"]
        assert (await client.get(f"/workouts/{workout_id}", headers=coach)).status_code == 404
        assert (await client.get(f"/programs/{program_id}", headers=coach)).status_code == 404
        assert (await client.get("/workouts", headers=coach)).json()["items"] == []
        assert (await client.get("/programs", headers=coach)).json() == []
        assert (await client.get("/body/measurements", headers=coach)).json()["items"] == []
        # Nor can the coach change or delete them.
        rename = await client.patch(
            f"/workouts/{workout_id}", headers=coach, json={"title": "Mine now"}
        )
        assert rename.status_code == 404
        assert (await client.delete(f"/programs/{program_id}", headers=coach)).status_code == 404
        still = await client.get(f"/workouts/{workout_id}", headers=athlete)
        assert still.json()["title"] == "Legs"

    async def test_a_coach_can_have_several_athletes(
        self, client: AsyncClient, coach: Headers, athlete: Headers
    ) -> None:
        third = await _register(client, "third")
        await _connect(client, coach, athlete)
        await _connect(client, coach, third)

        items = (await client.get("/coaching/athletes", headers=coach)).json()["items"]

        assert {item["person"]["username"] for item in items} == {"intruder", "third"}

    async def test_cannot_connect_to_yourself(self, client: AsyncClient, coach: Headers) -> None:
        code = await _invite(client, coach)

        accept = await _accept(client, coach, code)
        preview = await _preview(client, coach, code)

        assert accept.status_code == preview.status_code == 422
        assert (await client.get("/coaching/athletes", headers=coach)).json()["items"] == []

    async def test_unknown_and_malformed_codes_are_not_valid(
        self, client: AsyncClient, athlete: Headers
    ) -> None:
        for code in ("AAAA-BBBB-CCCC", "short", "!!!", "0000-0000-0000"):
            response = await _accept(client, athlete, code)
            assert response.status_code == 404, code
            assert response.json()["detail"] == "This invite code is not valid."

    async def test_an_expired_code_is_refused_and_says_so(
        self, client: AsyncClient, coach: Headers, athlete: Headers, db: AsyncSession
    ) -> None:
        code = await _invite(client, coach)
        await db.execute(text("UPDATE coach_invites SET expires_at = now() - interval '1 minute'"))
        await db.commit()

        accept = await _accept(client, athlete, code)
        preview = await _preview(client, athlete, code)

        assert accept.status_code == preview.status_code == 410
        assert accept.json()["detail"] == "This invite code has expired."
        assert (await client.get("/coaching/coaches", headers=athlete)).json()["items"] == []

    async def test_a_used_code_cannot_be_used_by_someone_else(
        self, client: AsyncClient, coach: Headers, athlete: Headers
    ) -> None:
        third = await _register(client, "third")
        code = await _invite(client, coach)
        assert (await _accept(client, athlete, code)).status_code == 201

        accept = await _accept(client, third, code)
        preview = await _preview(client, third, code)

        assert accept.status_code == preview.status_code == 409
        assert accept.json()["detail"] == "This invite code has already been used."
        assert (await client.get("/coaching/coaches", headers=third)).json()["items"] == []

    async def test_repeating_an_accept_returns_the_same_link(
        self, client: AsyncClient, coach: Headers, athlete: Headers, db: AsyncSession
    ) -> None:
        """A lost response must be safely retryable by the same athlete."""
        code = await _invite(client, coach)

        first = await _accept(client, athlete, code)
        again = await _accept(client, athlete, code)

        assert (first.status_code, again.status_code) == (201, 200)
        assert first.json()["id"] == again.json()["id"]
        assert await db.scalar(select(func.count()).select_from(CoachAthleteLink)) == 1

    async def test_a_second_invite_from_a_connected_coach_is_refused_and_not_spent(
        self, client: AsyncClient, coach: Headers, athlete: Headers
    ) -> None:
        third = await _register(client, "third")
        await _connect(client, coach, athlete)
        second_code = await _invite(client, coach)

        refused = await _accept(client, athlete, second_code)
        later = await _accept(client, third, second_code)

        assert refused.status_code == 409
        assert refused.json()["detail"] == "You are already connected to this coach."
        assert later.status_code == 201  # the code was still usable
        assert len((await client.get("/coaching/coaches", headers=athlete)).json()["items"]) == 1

    async def test_two_athletes_racing_for_one_code_get_exactly_one_link(
        self, client: AsyncClient, coach: Headers, athlete: Headers, db: AsyncSession
    ) -> None:
        third = await _register(client, "third")
        code = await _invite(client, coach)

        results = await asyncio.gather(_accept(client, athlete, code), _accept(client, third, code))

        assert sorted(r.status_code for r in results) == [201, 409]
        assert await db.scalar(select(func.count()).select_from(CoachAthleteLink)) == 1

    async def test_one_athlete_double_submitting_ends_with_a_single_link(
        self, client: AsyncClient, coach: Headers, athlete: Headers, db: AsyncSession
    ) -> None:
        code = await _invite(client, coach)

        results = await asyncio.gather(*[_accept(client, athlete, code) for _ in range(4)])

        assert all(r.status_code in (200, 201) for r in results), [r.text for r in results]
        assert len({r.json()["id"] for r in results}) == 1
        assert await db.scalar(select(func.count()).select_from(CoachAthleteLink)) == 1

    async def test_two_invites_from_one_coach_racing_for_one_athlete(
        self, client: AsyncClient, coach: Headers, athlete: Headers, db: AsyncSession
    ) -> None:
        """The partial unique index is the backstop for 'one active link per pair'."""
        first, second = await _invite(client, coach), await _invite(client, coach)

        results = await asyncio.gather(
            _accept(client, athlete, first), _accept(client, athlete, second)
        )

        assert sorted(r.status_code for r in results) == [201, 409]
        assert await db.scalar(select(func.count()).select_from(CoachAthleteLink)) == 1
        # The refused code was not spent.
        unspent = await db.scalar(
            select(func.count()).select_from(CoachInvite).where(CoachInvite.accepted_at.is_(None))
        )
        assert unspent == 1


class TestEndingALink:
    @pytest.mark.parametrize("who", ["coach", "athlete"])
    async def test_either_side_can_end_it(
        self, client: AsyncClient, coach: Headers, athlete: Headers, who: str
    ) -> None:
        link_id = await _connect(client, coach, athlete)

        response = await client.delete(
            f"/coaching/links/{link_id}", headers=coach if who == "coach" else athlete
        )

        assert response.status_code == 204
        assert (await client.get("/coaching/athletes", headers=coach)).json()["items"] == []
        assert (await client.get("/coaching/coaches", headers=athlete)).json()["items"] == []

    async def test_ending_twice_is_fine(
        self, client: AsyncClient, coach: Headers, athlete: Headers
    ) -> None:
        link_id = await _connect(client, coach, athlete)
        first = await client.delete(f"/coaching/links/{link_id}", headers=athlete)
        second = await client.delete(f"/coaching/links/{link_id}", headers=athlete)
        assert (first.status_code, second.status_code) == (204, 204)

    async def test_accounts_and_their_data_survive(
        self, client: AsyncClient, coach: Headers, athlete: Headers
    ) -> None:
        workout = await client.post("/workouts", headers=athlete, json={"title": "Legs"})
        program = await client.post("/programs", headers=coach, json={"name": "PPL"})
        link_id = await _connect(client, coach, athlete)

        await client.delete(f"/coaching/links/{link_id}", headers=coach)

        assert (await client.get("/users/me", headers=athlete)).status_code == 200
        assert (await client.get("/users/me", headers=coach)).status_code == 200
        kept_workout = await client.get(f"/workouts/{workout.json()['id']}", headers=athlete)
        kept_program = await client.get(f"/programs/{program.json()['id']}", headers=coach)
        assert kept_workout.status_code == kept_program.status_code == 200

    async def test_the_old_code_cannot_bring_it_back(
        self, client: AsyncClient, coach: Headers, athlete: Headers
    ) -> None:
        code = await _invite(client, coach)
        link_id = str((await _accept(client, athlete, code)).json()["id"])
        await client.delete(f"/coaching/links/{link_id}", headers=athlete)

        replay = await _accept(client, athlete, code)

        assert replay.status_code == 409
        assert (await client.get("/coaching/coaches", headers=athlete)).json()["items"] == []

    async def test_reconnecting_takes_a_new_invite_and_a_new_link(
        self, client: AsyncClient, coach: Headers, athlete: Headers, db: AsyncSession
    ) -> None:
        old_id = await _connect(client, coach, athlete)
        await client.delete(f"/coaching/links/{old_id}", headers=coach)

        new_id = await _connect(client, coach, athlete)

        assert new_id != old_id
        assert await db.scalar(select(func.count()).select_from(CoachAthleteLink)) == 2

    async def test_a_stranger_cannot_see_or_end_someone_elses_link(
        self, client: AsyncClient, coach: Headers, athlete: Headers
    ) -> None:
        third = await _register(client, "third")
        await client.post("/coaching/enable", headers=third)
        link_id = await _connect(client, coach, athlete)

        attempt = await client.delete(f"/coaching/links/{link_id}", headers=third)

        assert attempt.status_code == 404
        assert (await client.get("/coaching/athletes", headers=third)).json()["items"] == []
        assert (await client.get("/coaching/coaches", headers=third)).json()["items"] == []
        assert len((await client.get("/coaching/athletes", headers=coach)).json()["items"]) == 1

    async def test_an_unknown_link_is_a_404(self, client: AsyncClient, athlete: Headers) -> None:
        response = await client.delete(
            "/coaching/links/00000000-0000-0000-0000-000000000000", headers=athlete
        )
        assert response.status_code == 404


class TestGuessingIsThrottled:
    async def test_ten_wrong_codes_lock_the_account_out_of_code_lookups(
        self, client: AsyncClient, coach: Headers, athlete: Headers
    ) -> None:
        good = await _invite(client, coach)
        for _ in range(10):
            assert (await _accept(client, athlete, "AAAA-AAAA-AAAA")).status_code == 404

        wrong = await _accept(client, athlete, "AAAA-AAAA-AAAA")
        right = await _accept(client, athlete, good)
        preview = await _preview(client, athlete, good)

        assert wrong.status_code == right.status_code == preview.status_code == 429

    async def test_a_burst_of_parallel_guesses_cannot_overshoot_the_limit(
        self, client: AsyncClient, athlete: Headers
    ) -> None:
        # Regression: attempts used to be counted only after the lookup, so a
        # parallel burst all passed the check first (11 of 30 got through live).
        responses = await asyncio.gather(
            *(_preview(client, athlete, "AAAA-AAAA-AAAA") for _ in range(40))
        )

        statuses = sorted(response.status_code for response in responses)

        assert statuses == [404] * 10 + [429] * 30

    async def test_valid_lookups_never_use_up_the_allowance(
        self, client: AsyncClient, coach: Headers, athlete: Headers
    ) -> None:
        code = await _invite(client, coach)

        for _ in range(15):
            assert (await _preview(client, athlete, code)).status_code == 200

    async def test_other_accounts_are_not_affected(
        self, client: AsyncClient, coach: Headers, athlete: Headers
    ) -> None:
        third = await _register(client, "third")
        for _ in range(10):
            await _accept(client, athlete, "AAAA-AAAA-AAAA")

        response = await _accept(client, third, await _invite(client, coach))

        assert response.status_code == 201

    async def test_expired_and_used_codes_do_not_count_as_guesses(
        self, client: AsyncClient, coach: Headers, athlete: Headers, db: AsyncSession
    ) -> None:
        code = await _invite(client, coach)
        await db.execute(text("UPDATE coach_invites SET expires_at = now() - interval '1 minute'"))
        await db.commit()
        for _ in range(12):
            assert (await _accept(client, athlete, code)).status_code == 410


class TestDatabaseConstraints:
    """The rules above also hold below the API, in case a code path misses one."""

    async def _two_users_and_invites(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, athlete: Headers
    ) -> tuple[str, str, list[str]]:
        await _invite(client, coach)
        await _invite(client, coach)
        invites = await db.execute(text("SELECT id::text FROM coach_invites ORDER BY created_at"))
        users = await db.execute(text("SELECT id::text FROM users ORDER BY username"))
        efe, intruder = users.scalars().all()  # 'efe' sorts before 'intruder'
        return efe, intruder, list(invites.scalars())

    async def test_a_second_active_link_for_a_pair_is_rejected_but_an_ended_one_is_not(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, athlete: Headers
    ) -> None:
        efe, intruder, invites = await self._two_users_and_invites(client, db, coach, athlete)
        insert = text(
            "INSERT INTO coach_athlete_links (coach_id, athlete_id, invite_id, ended_at) "
            "VALUES (:c, :a, :i, :e)"
        )
        await db.execute(insert, {"c": efe, "a": intruder, "i": invites[0], "e": None})
        await db.commit()

        with pytest.raises(IntegrityError):
            await db.execute(insert, {"c": efe, "a": intruder, "i": invites[1], "e": None})
        await db.rollback()

        # Ended rows do not count, so history can hold several.
        await db.execute(insert, {"c": efe, "a": intruder, "i": invites[1], "e": datetime.now(UTC)})
        await db.commit()

    async def test_a_link_to_yourself_and_a_reused_invite_are_rejected(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, athlete: Headers
    ) -> None:
        efe, intruder, invites = await self._two_users_and_invites(client, db, coach, athlete)
        insert = text(
            "INSERT INTO coach_athlete_links (coach_id, athlete_id, invite_id) VALUES (:c, :a, :i)"
        )

        with pytest.raises(IntegrityError):
            await db.execute(insert, {"c": efe, "a": efe, "i": invites[0]})
        await db.rollback()

        await db.execute(insert, {"c": efe, "a": intruder, "i": invites[0]})
        await db.execute(text("UPDATE coach_athlete_links SET ended_at = now()"))
        await db.commit()
        with pytest.raises(IntegrityError):
            await db.execute(insert, {"c": efe, "a": intruder, "i": invites[0]})
        await db.rollback()
