"""A coach's feedback on a shared completed workout, read by the athlete.

Run through the real app against the real test database. Most tests are about
who must NOT be able to read or change what, what survives the end of a
connection, and writes that must not be lost, doubled or slip past a permission
change that is happening at the same moment.
"""

import asyncio
from typing import Any
from uuid import uuid4

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from tests.test_coaching import Headers, _connect, _register
from tests.test_coaching_workouts import _log, _set, _share


@pytest.fixture
async def coach(client: AsyncClient, auth_headers: Headers) -> Headers:
    assert (await client.post("/coaching/enable", headers=auth_headers)).status_code == 200
    return auth_headers


@pytest.fixture
async def athlete(other_auth_headers: Headers) -> Headers:
    return other_auth_headers


@pytest.fixture
async def link(client: AsyncClient, coach: Headers, athlete: Headers) -> str:
    link_id = await _connect(client, coach, athlete)
    assert (await _share(client, athlete, link_id)).status_code == 200
    return link_id


@pytest.fixture
async def workout(client: AsyncClient, athlete: Headers, bench_press_id: str) -> str:
    return await _log(
        client, athlete, title="Push", days_ago=1, sets=[_set(bench_press_id, 80, 5, rir=2)]
    )


def _path(link_id: str, workout_id: str) -> str:
    return f"/coaching/athletes/{link_id}/workouts/{workout_id}/feedback"


async def _get(client: AsyncClient, who: Headers, link_id: str, workout_id: str) -> Response:
    return await client.get(_path(link_id, workout_id), headers=who)


async def _create(
    client: AsyncClient,
    who: Headers,
    link_id: str,
    workout_id: str,
    body: Any,
    request_id: str | None = None,
) -> Response:
    return await client.put(
        f"{_path(link_id, workout_id)}/requests/{request_id or uuid4()}",
        headers=who,
        json={"body": body},
    )


async def _edit(
    client: AsyncClient, who: Headers, link_id: str, workout_id: str, body: Any, version: Any
) -> Response:
    return await client.patch(
        _path(link_id, workout_id), headers=who, json={"body": body, "expected_version": version}
    )


async def _delete(
    client: AsyncClient, who: Headers, link_id: str, workout_id: str, version: Any
) -> Response:
    return await client.delete(
        _path(link_id, workout_id), headers=who, params={"expected_version": version}
    )


async def _received(client: AsyncClient, athlete: Headers, workout_id: str) -> Response:
    return await client.get(f"/coaching/workouts/{workout_id}/feedback", headers=athlete)


async def _count(db: AsyncSession) -> int:
    return int((await db.execute(text("SELECT count(*) FROM workout_feedback"))).scalar_one())


class TestCoachLifecycle:
    async def test_create_read_edit_and_delete(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, workout: str
    ) -> None:
        empty = await _get(client, coach, link, workout)
        assert empty.status_code == 200
        assert empty.json() == {"feedback": None}
        assert empty.headers["cache-control"] == "no-store"

        created = await _create(client, coach, link, workout, "  Nice depth.\nKeep the pause.  ")
        assert created.status_code == 201, created.text
        feedback = created.json()
        assert feedback["body"] == "Nice depth.\nKeep the pause."
        assert feedback["version"] == 1
        assert set(feedback) == {"id", "body", "version", "created_at", "updated_at"}
        assert (await _get(client, coach, link, workout)).json()["feedback"] == feedback

        edited = await _edit(client, coach, link, workout, "Better: add a pause.", 1)
        assert edited.status_code == 200, edited.text
        assert edited.json()["version"] == 2
        assert edited.json()["created_at"] == feedback["created_at"]
        assert edited.json()["updated_at"] > feedback["updated_at"]
        assert edited.json()["id"] == feedback["id"]

        assert (await _delete(client, coach, link, workout, 2)).status_code == 204
        assert (await _get(client, coach, link, workout)).json() == {"feedback": None}
        assert (await _received(client, athlete, workout)).json() == {"items": []}

    async def test_the_athlete_reads_it_with_the_coachs_public_name_only(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, workout: str
    ) -> None:
        await _create(client, coach, link, workout, "Solid session.")

        response = await _received(client, athlete, workout)

        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        [item] = response.json()["items"]
        assert item["body"] == "Solid session."
        assert set(item) == {"id", "coach", "body", "created_at", "updated_at"}
        assert set(item["coach"]) == {"username", "first_name", "last_name"}
        assert "@example.com" not in response.text

    async def test_an_edit_shows_on_the_athletes_side(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, workout: str
    ) -> None:
        created = (await _create(client, coach, link, workout, "First.")).json()
        await _edit(client, coach, link, workout, "Second.", created["version"])

        [item] = (await _received(client, athlete, workout)).json()["items"]

        assert item["body"] == "Second."
        assert item["updated_at"] > item["created_at"]

    async def test_a_no_op_edit_does_not_count_as_a_change(
        self, client: AsyncClient, coach: Headers, link: str, workout: str
    ) -> None:
        created = (await _create(client, coach, link, workout, "Same.")).json()

        again = await _edit(client, coach, link, workout, "Same.", 1)

        assert again.status_code == 200
        assert again.json() == created

    async def test_requires_a_token(self, client: AsyncClient) -> None:
        zero = "00000000-0000-0000-0000-000000000000"
        assert (await client.get(_path(zero, zero))).status_code == 401
        assert (await client.get(f"/coaching/workouts/{zero}/feedback")).status_code == 401


class TestTextRules:
    @pytest.mark.parametrize("size", [1, 1999, 2000])
    async def test_lengths_up_to_the_limit_are_accepted(
        self, client: AsyncClient, coach: Headers, link: str, workout: str, size: int
    ) -> None:
        response = await _create(client, coach, link, workout, "a" * size)
        assert response.status_code == 201
        assert len(response.json()["body"]) == size

    async def test_longer_than_the_limit_is_refused_and_nothing_is_stored(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, link: str, workout: str
    ) -> None:
        response = await _create(client, coach, link, workout, "a" * 2001)
        assert response.status_code == 422
        assert await _count(db) == 0

    async def test_limits_count_characters_not_bytes(
        self, client: AsyncClient, coach: Headers, link: str, workout: str
    ) -> None:
        response = await _create(client, coach, link, workout, "ğ" * 2000)
        assert response.status_code == 201
        edited = await _edit(client, coach, link, workout, "💪" * 2000, 1)
        assert edited.status_code == 200
        assert (await _edit(client, coach, link, workout, "💪" * 2001, 2)).status_code == 422

    @pytest.mark.parametrize("body", ["", " ", "   \n\t  ", "  ", "\r\n\r\n"])
    async def test_blank_text_is_refused(
        self,
        client: AsyncClient,
        db: AsyncSession,
        coach: Headers,
        link: str,
        workout: str,
        body: str,
    ) -> None:
        assert (await _create(client, coach, link, workout, body)).status_code == 422
        assert await _count(db) == 0

    async def test_blank_edit_is_refused_and_the_text_stays(
        self, client: AsyncClient, coach: Headers, link: str, workout: str
    ) -> None:
        await _create(client, coach, link, workout, "Keep me.")
        assert (await _edit(client, coach, link, workout, "  \n ", 1)).status_code == 422
        assert (await _get(client, coach, link, workout)).json()["feedback"]["body"] == "Keep me."

    @pytest.mark.parametrize("body", [None, 5, ["x"], {"a": 1}, "bad\x00char"])
    async def test_only_plain_text_is_accepted(
        self, client: AsyncClient, coach: Headers, link: str, workout: str, body: Any
    ) -> None:
        assert (await _create(client, coach, link, workout, body)).status_code == 422

    @pytest.mark.parametrize("version", [0, -1, "x", None])
    async def test_a_version_is_required_and_positive(
        self, client: AsyncClient, coach: Headers, link: str, workout: str, version: Any
    ) -> None:
        await _create(client, coach, link, workout, "x")
        assert (await _edit(client, coach, link, workout, "y", version)).status_code == 422
        assert (
            await client.delete(_path(link, workout), headers=coach, params={"expected_version": 0})
        ).status_code == 422
        assert (await client.delete(_path(link, workout), headers=coach)).status_code == 422

    async def test_the_database_refuses_blank_and_overlong_text_on_its_own(
        self, db: AsyncSession, coach: Headers, link: str, workout: str
    ) -> None:
        for body in ("   ", "\n\t", "a" * 2001):
            with pytest.raises(IntegrityError):
                await db.execute(
                    text(
                        "INSERT INTO workout_feedback "
                        "(link_id, workout_id, body, create_request_id, create_hash) "
                        "VALUES (:l, :w, :b, gen_random_uuid(), 'h')"
                    ),
                    {"l": link, "w": workout, "b": body},
                )
            await db.rollback()


class TestReliableWrites:
    async def test_repeating_a_create_returns_the_same_entry_and_stores_one(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, link: str, workout: str
    ) -> None:
        request_id = str(uuid4())
        first = await _create(client, coach, link, workout, "Once.", request_id)
        second = await _create(client, coach, link, workout, "Once.", request_id)

        assert (first.status_code, second.status_code) == (201, 200)
        assert first.json() == second.json()
        assert await _count(db) == 1

    async def test_a_repeat_after_an_edit_returns_the_current_entry_not_a_new_one(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, link: str, workout: str
    ) -> None:
        request_id = str(uuid4())
        await _create(client, coach, link, workout, "Draft.", request_id)
        await _edit(client, coach, link, workout, "Edited.", 1)

        again = await _create(client, coach, link, workout, "Draft.", request_id)

        assert again.status_code == 200
        assert again.json()["body"] == "Edited."
        assert await _count(db) == 1

    async def test_a_request_id_is_not_reusable_for_other_text(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, link: str, workout: str
    ) -> None:
        request_id = str(uuid4())
        await _create(client, coach, link, workout, "Original.", request_id)

        reused = await _create(client, coach, link, workout, "Changed draft.", request_id)

        assert reused.status_code == 409
        assert (await _get(client, coach, link, workout)).json()["feedback"]["body"] == "Original."
        assert await _count(db) == 1

    async def test_a_request_id_is_not_reusable_for_another_workout(
        self,
        client: AsyncClient,
        db: AsyncSession,
        coach: Headers,
        athlete: Headers,
        link: str,
        workout: str,
        bench_press_id: str,
    ) -> None:
        other = await _log(
            client, athlete, title="Pull", days_ago=2, sets=[_set(bench_press_id, 60, 5)]
        )
        request_id = str(uuid4())
        await _create(client, coach, link, workout, "One.", request_id)

        reused = await _create(client, coach, link, other, "One.", request_id)

        assert reused.status_code == 409
        assert await _count(db) == 1

    async def test_a_second_entry_with_a_new_request_id_is_refused(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, link: str, workout: str
    ) -> None:
        await _create(client, coach, link, workout, "First device.")

        second = await _create(client, coach, link, workout, "Second device.")

        assert second.status_code == 409
        assert (await _get(client, coach, link, workout)).json()["feedback"]["body"] == (
            "First device."
        )
        assert await _count(db) == 1

    async def test_concurrent_creates_leave_exactly_one_entry(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, link: str, workout: str
    ) -> None:
        same = str(uuid4())
        results = await asyncio.gather(
            *[_create(client, coach, link, workout, "Same.", same) for _ in range(4)],
            *[_create(client, coach, link, workout, f"Other {n}.") for n in range(4)],
        )

        statuses = sorted(r.status_code for r in results)
        assert statuses.count(201) == 1
        assert set(statuses) <= {200, 201, 409}
        assert await _count(db) == 1

    async def test_an_edit_from_a_stale_version_is_refused_and_nothing_is_overwritten(
        self, client: AsyncClient, coach: Headers, link: str, workout: str
    ) -> None:
        await _create(client, coach, link, workout, "v1")
        await _edit(client, coach, link, workout, "v2 from the phone", 1)

        stale = await _edit(client, coach, link, workout, "v2 from the tablet", 1)

        assert stale.status_code == 409
        current = (await _get(client, coach, link, workout)).json()["feedback"]
        assert (current["body"], current["version"]) == ("v2 from the phone", 2)

    async def test_the_same_edit_repeated_after_a_lost_response_is_a_success(
        self, client: AsyncClient, coach: Headers, link: str, workout: str
    ) -> None:
        await _create(client, coach, link, workout, "v1")
        first = await _edit(client, coach, link, workout, "v2", 1)
        repeat = await _edit(client, coach, link, workout, "v2", 1)

        assert repeat.status_code == 200
        assert repeat.json() == first.json()
        assert repeat.json()["version"] == 2

    async def test_a_changed_draft_cannot_ride_on_an_earlier_applied_edit(
        self, client: AsyncClient, coach: Headers, link: str, workout: str
    ) -> None:
        await _create(client, coach, link, workout, "v1")
        await _edit(client, coach, link, workout, "v2", 1)

        different = await _edit(client, coach, link, workout, "v2 but reworded", 1)

        assert different.status_code == 409

    async def test_concurrent_edits_from_the_same_version_apply_exactly_once(
        self, client: AsyncClient, coach: Headers, link: str, workout: str
    ) -> None:
        await _create(client, coach, link, workout, "base")

        results = await asyncio.gather(
            *[_edit(client, coach, link, workout, f"edit {n}", 1) for n in range(5)]
        )

        assert sorted(r.status_code for r in results) == [200, 409, 409, 409, 409]
        current = (await _get(client, coach, link, workout)).json()["feedback"]
        winner = next(r for r in results if r.status_code == 200).json()
        assert current["version"] == 2
        assert current["body"] == winner["body"]

    async def test_deleting_a_stale_version_is_refused(
        self, client: AsyncClient, coach: Headers, link: str, workout: str
    ) -> None:
        await _create(client, coach, link, workout, "v1")
        await _edit(client, coach, link, workout, "v2", 1)

        assert (await _delete(client, coach, link, workout, 1)).status_code == 409
        assert (await _get(client, coach, link, workout)).json()["feedback"]["body"] == "v2"

    async def test_deleting_twice_is_a_success_and_editing_a_deleted_entry_is_a_conflict(
        self, client: AsyncClient, coach: Headers, link: str, workout: str
    ) -> None:
        await _create(client, coach, link, workout, "v1")
        assert (await _delete(client, coach, link, workout, 1)).status_code == 204
        assert (await _delete(client, coach, link, workout, 1)).status_code == 204

        edit = await _edit(client, coach, link, workout, "v2", 1)

        # Not a 404: that status is kept for losing access.
        assert edit.status_code == 409
        assert (await _get(client, coach, link, workout)).json() == {"feedback": None}

    async def test_after_a_delete_a_fresh_create_is_allowed(
        self, client: AsyncClient, coach: Headers, link: str, workout: str
    ) -> None:
        await _create(client, coach, link, workout, "first")
        await _delete(client, coach, link, workout, 1)

        again = await _create(client, coach, link, workout, "second")

        assert again.status_code == 201
        assert again.json()["version"] == 1


class TestAccessRules:
    async def _all_refused(
        self, client: AsyncClient, who: Headers, link: str, workout: str, expected: int
    ) -> None:
        responses = [
            await _get(client, who, link, workout),
            await _create(client, who, link, workout, "text"),
            await _edit(client, who, link, workout, "text", 1),
            await _delete(client, who, link, workout, 1),
        ]
        assert [r.status_code for r in responses] == [expected] * 4, [r.text for r in responses]

    async def test_an_unrelated_user_gets_nothing(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, workout: str
    ) -> None:
        await _create(client, coach, link, workout, "Private to the pair.")
        stranger = await _register(client, "stranger")
        assert (await client.post("/coaching/enable", headers=stranger)).status_code == 200

        await self._all_refused(client, stranger, link, workout, 404)

        assert (await _received(client, stranger, workout)).status_code == 404

    async def test_the_athlete_cannot_use_the_coach_path(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, workout: str
    ) -> None:
        await _create(client, coach, link, workout, "Mine.")
        await self._all_refused(client, athlete, link, workout, 404)
        assert (await _get(client, coach, link, workout)).json()["feedback"]["body"] == "Mine."

    async def test_sharing_off_stops_every_coach_operation_but_not_the_athletes_copy(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, workout: str
    ) -> None:
        await _create(client, coach, link, workout, "Written while shared.")

        await _share(client, athlete, link, False)

        await self._all_refused(client, coach, link, workout, 403)
        [item] = (await _received(client, athlete, workout)).json()["items"]
        assert item["body"] == "Written while shared."

        await _share(client, athlete, link, True)
        assert (await _get(client, coach, link, workout)).json()["feedback"]["body"] == (
            "Written while shared."
        )

    async def test_an_ended_connection_stops_every_coach_operation_but_not_the_athletes_copy(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, workout: str
    ) -> None:
        await _create(client, coach, link, workout, "Before the end.")

        assert (await client.delete(f"/coaching/links/{link}", headers=athlete)).status_code == 204

        await self._all_refused(client, coach, link, workout, 404)
        [item] = (await _received(client, athlete, workout)).json()["items"]
        assert item["body"] == "Before the end."

    async def test_the_coach_ending_it_has_the_same_effect(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, workout: str
    ) -> None:
        await _create(client, coach, link, workout, "Kept.")
        assert (await client.delete(f"/coaching/links/{link}", headers=coach)).status_code == 204

        await self._all_refused(client, coach, link, workout, 404)
        assert len((await _received(client, athlete, workout)).json()["items"]) == 1

    async def test_an_unfinished_workout_is_refused(
        self,
        client: AsyncClient,
        coach: Headers,
        athlete: Headers,
        link: str,
        bench_press_id: str,
    ) -> None:
        open_one = await _log(
            client,
            athlete,
            title="Open",
            days_ago=0,
            sets=[_set(bench_press_id, 50, 5)],
            finish=False,
        )

        await self._all_refused(client, coach, link, open_one, 404)

    async def test_an_unknown_workout_is_refused(
        self, client: AsyncClient, coach: Headers, link: str
    ) -> None:
        await self._all_refused(client, coach, link, str(uuid4()), 404)

    async def test_another_athletes_workout_cannot_be_reached_through_this_link(
        self, client: AsyncClient, coach: Headers, link: str, bench_press_id: str
    ) -> None:
        second = await _register(client, "second")
        second_link = await _connect(client, coach, second)
        await _share(client, second, second_link)
        theirs = await _log(
            client, second, title="Theirs", days_ago=1, sets=[_set(bench_press_id, 70, 5)]
        )

        await self._all_refused(client, coach, link, theirs, 404)
        assert (await _create(client, coach, second_link, theirs, "ok")).status_code == 201

    async def test_the_coachs_own_workout_cannot_be_the_target(
        self, client: AsyncClient, coach: Headers, link: str, bench_press_id: str
    ) -> None:
        own = await _log(
            client, coach, title="Coach own", days_ago=1, sets=[_set(bench_press_id, 90, 5)]
        )
        await self._all_refused(client, coach, link, own, 404)

    async def test_the_athlete_cannot_read_feedback_on_someone_elses_workout(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, workout: str
    ) -> None:
        await _create(client, coach, link, workout, "For the athlete only.")

        # The coach's own account is a third party on the athlete-side endpoint.
        assert (await _received(client, coach, workout)).status_code == 404
        assert (await _received(client, athlete, str(uuid4()))).status_code == 404


class TestSeveralCoaches:
    async def _second_coach(
        self, client: AsyncClient, athlete: Headers, workout: str
    ) -> tuple[Headers, str]:
        other = await _register(client, "coachtwo")
        assert (await client.post("/coaching/enable", headers=other)).status_code == 200
        other_link = await _connect(client, other, athlete)
        assert (await _share(client, athlete, other_link)).status_code == 200
        return other, other_link

    async def test_each_coach_sees_and_changes_only_their_own_entry(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, workout: str
    ) -> None:
        other, other_link = await self._second_coach(client, athlete, workout)
        mine = (await _create(client, coach, link, workout, "From coach one.")).json()
        assert (await _get(client, other, other_link, workout)).json() == {"feedback": None}

        theirs = (await _create(client, other, other_link, workout, "From coach two.")).json()

        assert (await _get(client, coach, link, workout)).json()["feedback"]["body"] == (
            "From coach one."
        )
        assert (await _get(client, other, other_link, workout)).json()["feedback"]["id"] == (
            theirs["id"]
        )
        # The second coach cannot touch the first one's entry, by id or by link.
        assert (await _edit(client, other, link, workout, "hijack", 1)).status_code == 404
        assert (await _delete(client, other, link, workout, 1)).status_code == 404
        assert (await _edit(client, other, other_link, workout, "mine now", 1)).status_code == 200
        assert (await _delete(client, other, other_link, workout, 2)).status_code == 204
        assert (await _get(client, coach, link, workout)).json()["feedback"] == mine

    async def test_a_coach_without_an_entry_cannot_edit_the_others(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, workout: str
    ) -> None:
        other, other_link = await self._second_coach(client, athlete, workout)
        await _create(client, coach, link, workout, "Coach one's.")

        assert (await _edit(client, other, other_link, workout, "x", 1)).status_code == 409
        assert (await _delete(client, other, other_link, workout, 1)).status_code == 204
        assert (await _get(client, coach, link, workout)).json()["feedback"]["body"] == (
            "Coach one's."
        )

    async def test_the_athlete_sees_both_with_their_own_authors_and_times(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, workout: str
    ) -> None:
        other, other_link = await self._second_coach(client, athlete, workout)
        await _create(client, coach, link, workout, "From coach one.")
        await _create(client, other, other_link, workout, "From coach two.")
        await _edit(client, coach, link, workout, "From coach one, edited.", 1)

        items = (await _received(client, athlete, workout)).json()["items"]

        assert [(i["coach"]["username"], i["body"]) for i in items] == [
            ("efe", "From coach one, edited."),
            ("coachtwo", "From coach two."),
        ]
        assert items[0]["updated_at"] > items[0]["created_at"]
        assert items[1]["updated_at"] == items[1]["created_at"]

    async def test_when_one_connection_ends_the_other_coachs_entry_is_untouched(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, workout: str
    ) -> None:
        other, other_link = await self._second_coach(client, athlete, workout)
        await _create(client, coach, link, workout, "One.")
        await _create(client, other, other_link, workout, "Two.")

        await client.delete(f"/coaching/links/{link}", headers=athlete)

        assert (await _get(client, other, other_link, workout)).json()["feedback"]["body"] == "Two."
        assert (await _get(client, coach, link, workout)).status_code == 404
        assert len((await _received(client, athlete, workout)).json()["items"]) == 2


class TestReconnection:
    async def test_a_new_connection_does_not_regain_the_old_entry(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, workout: str
    ) -> None:
        old = (await _create(client, coach, link, workout, "From the first connection.")).json()
        await client.delete(f"/coaching/links/{link}", headers=athlete)

        fresh = await _connect(client, coach, athlete)
        await _share(client, athlete, fresh)

        assert fresh != link
        assert (await _get(client, coach, fresh, workout)).json() == {"feedback": None}
        assert (await _edit(client, coach, fresh, workout, "takeover", 1)).status_code == 409
        assert (await _delete(client, coach, fresh, workout, 1)).status_code == 204
        # The old link stays closed and the old text is untouched.
        assert (await _edit(client, coach, link, workout, "takeover", 1)).status_code == 404
        [item] = (await _received(client, athlete, workout)).json()["items"]
        assert item["id"] == old["id"]
        assert item["body"] == "From the first connection."

    async def test_the_new_connection_writes_its_own_separate_entry(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, workout: str
    ) -> None:
        await _create(client, coach, link, workout, "Old.")
        await client.delete(f"/coaching/links/{link}", headers=athlete)
        fresh = await _connect(client, coach, athlete)
        await _share(client, athlete, fresh)

        created = await _create(client, coach, fresh, workout, "New.")

        assert created.status_code == 201
        items = (await _received(client, athlete, workout)).json()["items"]
        assert [i["body"] for i in items] == ["Old.", "New."]


class TestWorkoutsKeepWorking:
    async def test_the_athlete_can_still_delete_a_workout_that_has_feedback(
        self,
        client: AsyncClient,
        db: AsyncSession,
        coach: Headers,
        athlete: Headers,
        link: str,
        workout: str,
    ) -> None:
        await _create(client, coach, link, workout, "Will go with the workout.")

        deleted = await client.delete(f"/workouts/{workout}", headers=athlete)

        assert deleted.status_code == 204
        assert await _count(db) == 0
        assert (await _get(client, coach, link, workout)).status_code == 404

    async def test_the_athlete_can_still_edit_a_workout_that_has_feedback(
        self,
        client: AsyncClient,
        coach: Headers,
        athlete: Headers,
        link: str,
        workout: str,
        bench_press_id: str,
    ) -> None:
        await _create(client, coach, link, workout, "Looks good.")

        added = await client.post(
            f"/workouts/{workout}/sets",
            headers=athlete,
            json={"exercise_id": bench_press_id, "weight_kg": 82.5, "reps": 5},
        )
        renamed = await client.patch(
            f"/workouts/{workout}", headers=athlete, json={"title": "Push (edited)"}
        )

        assert added.status_code == 201
        assert renamed.status_code == 200
        assert (await client.get(f"/workouts/{workout}", headers=athlete)).status_code == 200
        assert len((await _received(client, athlete, workout)).json()["items"]) == 1

    async def test_deleting_the_athletes_account_data_cascades_cleanly(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, link: str, workout: str
    ) -> None:
        await _create(client, coach, link, workout, "Gone with the link.")
        await db.execute(text("DELETE FROM coach_athlete_links WHERE id = :i"), {"i": link})
        await db.commit()
        assert await _count(db) == 0


class TestWritesRaceWithPermissionChanges:
    """The write takes the link's row lock, the one ending it and switching sharing off take."""

    async def _blocked_write(
        self,
        db_engine: AsyncEngine,
        link: str,
        change_sql: str,
        write: Any,
    ) -> Response:
        async with db_engine.connect() as other:
            await other.execute(
                text("SELECT id FROM coach_athlete_links WHERE id = :i FOR UPDATE"), {"i": link}
            )
            task = asyncio.ensure_future(write())
            await asyncio.sleep(0.4)
            assert not task.done(), "the write must wait for the in-flight permission change"
            await other.execute(text(change_sql), {"i": link})
            await other.commit()
        return await asyncio.wait_for(task, timeout=10)

    async def test_a_create_that_waits_for_the_connection_to_end_is_refused(
        self,
        client: AsyncClient,
        db: AsyncSession,
        db_engine: AsyncEngine,
        coach: Headers,
        link: str,
        workout: str,
    ) -> None:
        response = await self._blocked_write(
            db_engine,
            link,
            "UPDATE coach_athlete_links SET ended_at = now() WHERE id = :i",
            lambda: _create(client, coach, link, workout, "Too late."),
        )

        assert response.status_code == 404
        assert await _count(db) == 0

    async def test_an_edit_that_waits_for_sharing_to_be_withdrawn_is_refused(
        self,
        client: AsyncClient,
        db: AsyncSession,
        db_engine: AsyncEngine,
        coach: Headers,
        link: str,
        workout: str,
    ) -> None:
        await _create(client, coach, link, workout, "Original.")

        response = await self._blocked_write(
            db_engine,
            link,
            "UPDATE coach_athlete_links SET shares_workouts = false WHERE id = :i",
            lambda: _edit(client, coach, link, workout, "Sneaky edit.", 1),
        )

        assert response.status_code == 403
        body = (await db.execute(text("SELECT body FROM workout_feedback"))).scalar_one()
        assert body == "Original."

    async def test_a_delete_that_waits_for_the_connection_to_end_is_refused(
        self,
        client: AsyncClient,
        db: AsyncSession,
        db_engine: AsyncEngine,
        coach: Headers,
        link: str,
        workout: str,
    ) -> None:
        await _create(client, coach, link, workout, "Stays.")

        response = await self._blocked_write(
            db_engine,
            link,
            "UPDATE coach_athlete_links SET ended_at = now() WHERE id = :i",
            lambda: _delete(client, coach, link, workout, 1),
        )

        assert response.status_code == 404
        assert await _count(db) == 1

    async def test_ending_the_connection_waits_for_a_write_that_already_passed_the_check(
        self,
        client: AsyncClient,
        db: AsyncSession,
        db_engine: AsyncEngine,
        coach: Headers,
        athlete: Headers,
        link: str,
        workout: str,
    ) -> None:
        # A write that authorised first commits first; the end follows, and from
        # then on the coach is locked out.
        outcomes = await asyncio.gather(
            _create(client, coach, link, workout, "Race."),
            client.delete(f"/coaching/links/{link}", headers=athlete),
        )
        created, ended = outcomes

        assert ended.status_code == 204
        assert created.status_code in (201, 404)
        stored = await _count(db)
        assert stored == (1 if created.status_code == 201 else 0)
        assert (await _get(client, coach, link, workout)).status_code == 404
        assert (await _create(client, coach, link, workout, "After.")).status_code == 404
