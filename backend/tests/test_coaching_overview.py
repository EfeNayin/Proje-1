"""The coach's roster activity overview.

Mostly about two things: who must NOT get numbers (unrelated coaches, athletes
who are not sharing, ended links) and that the numbers are the established
definitions over ONE shared window. Workouts are inserted with SQL so every
boundary instant is exact; the request's `as_of` pins the window.
"""

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from tests.test_coaching import Headers, _connect, _register
from tests.test_coaching_workouts import _share

# A recent, whole-second instant already in the past: valid for `as_of`.
END = (datetime.now(UTC) - timedelta(minutes=5)).replace(microsecond=0)
START = END - timedelta(days=28)
AS_OF = {"as_of": END.isoformat()}


@pytest.fixture
async def coach(client: AsyncClient, auth_headers: Headers) -> Headers:
    assert (await client.post("/coaching/enable", headers=auth_headers)).status_code == 200
    return auth_headers


@pytest.fixture
async def athlete(other_auth_headers: Headers) -> Headers:
    return other_auth_headers


@pytest.fixture
async def link(client: AsyncClient, coach: Headers, athlete: Headers) -> str:
    return await _connect(client, coach, athlete)


@pytest.fixture
async def exercise(db: AsyncSession, bench_press_id: str) -> UUID:
    return UUID(bench_press_id)


async def _user_id(db: AsyncSession, username: str) -> UUID:
    return (
        await db.execute(text("SELECT id FROM users WHERE username = :u"), {"u": username})
    ).scalar_one()


async def _add_workout(
    db: AsyncSession,
    user_id: UUID,
    exercise_id: UUID,
    performed_at: datetime,
    *,
    title: str = "Session",
    finished: bool = True,
    sets: list[tuple[float, int, bool]] | None = None,
) -> UUID:
    """(weight_kg, reps, is_warmup) per set."""
    workout_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO workouts (id, user_id, title, performed_at, finished_at) "
            "VALUES (:id, :u, :t, :p, :f)"
        ),
        {
            "id": workout_id,
            "u": user_id,
            "t": title,
            "p": performed_at,
            "f": performed_at + timedelta(minutes=50) if finished else None,
        },
    )
    for number, (weight, reps, warmup) in enumerate(sets or [], start=1):
        await db.execute(
            text(
                "INSERT INTO sets "
                "(workout_id, exercise_id, set_number, weight_kg, reps, is_warmup) "
                "VALUES (:w, :e, :n, :kg, :r, :wu)"
            ),
            {"w": workout_id, "e": exercise_id, "n": number, "kg": weight, "r": reps, "wu": warmup},
        )
    await db.commit()
    return workout_id


async def _overview(
    client: AsyncClient, headers: Headers, query: dict[str, Any] | None = None
) -> Any:
    return await client.get("/coaching/athletes/overview", headers=headers, params=query or AS_OF)


def _by_id(body: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {item["id"]: item for item in body["items"]}


class TestAccess:
    async def test_requires_authentication(self, client: AsyncClient) -> None:
        assert (await client.get("/coaching/athletes/overview")).status_code == 401

    async def test_needs_coach_tools(self, client: AsyncClient, athlete: Headers) -> None:
        assert (await _overview(client, athlete)).status_code == 403

    async def test_an_unrelated_coach_gets_an_empty_roster(
        self,
        client: AsyncClient,
        db: AsyncSession,
        exercise: UUID,
        coach: Headers,
        athlete: Headers,
        link: str,
    ) -> None:
        await _share(client, athlete, link)
        await _add_workout(db, await _user_id(db, "intruder"), exercise, END - timedelta(days=1))
        stranger = await _register(client, "stranger")
        await client.post("/coaching/enable", headers=stranger)

        response = await _overview(client, stranger)

        assert response.status_code == 200
        assert response.json()["items"] == []
        assert response.json()["total"] == 0

    async def test_an_athlete_cannot_use_it_on_themselves_or_see_their_coach(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str
    ) -> None:
        await client.post("/coaching/enable", headers=athlete)

        body = (await _overview(client, athlete)).json()

        # Coach tools on, but nobody is *their* athlete: the roster is empty.
        assert body["items"] == []

    async def test_response_has_only_the_needed_fields(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str
    ) -> None:
        await _share(client, athlete, link)

        body = (await _overview(client, coach)).json()

        assert set(body) == {"items", "total", "limit", "offset", "window"}
        assert set(body["items"][0]) == {
            "id",
            "person",
            "connected_at",
            "shares_workouts",
            "activity",
        }
        assert set(body["items"][0]["activity"]) == {
            "latest_workout",
            "workouts_in_window",
            "working_sets_in_window",
        }
        assert (await _overview(client, coach)).headers["cache-control"] == "no-store"


class TestSharingStates:
    async def test_not_sharing_is_unavailable_not_zero_even_with_workouts(
        self,
        client: AsyncClient,
        db: AsyncSession,
        exercise: UUID,
        coach: Headers,
        athlete: Headers,
        link: str,
    ) -> None:
        await _add_workout(
            db,
            await _user_id(db, "intruder"),
            exercise,
            END - timedelta(days=1),
            title="Secret",
            sets=[(100, 5, False)],
        )

        response = await _overview(client, coach)

        item = response.json()["items"][0]
        assert item["shares_workouts"] is False
        assert item["activity"] is None
        assert "Secret" not in response.text

    async def test_sharing_with_no_completed_workouts_is_zero_and_no_latest(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str
    ) -> None:
        await _share(client, athlete, link)

        item = (await _overview(client, coach)).json()["items"][0]

        assert item["activity"] == {
            "latest_workout": None,
            "workouts_in_window": 0,
            "working_sets_in_window": 0,
        }

    async def test_mixed_permissions_on_one_page(
        self,
        client: AsyncClient,
        db: AsyncSession,
        exercise: UUID,
        coach: Headers,
        athlete: Headers,
        link: str,
    ) -> None:
        second = await _register(client, "second")
        second_link = await _connect(client, coach, second)
        third = await _register(client, "third")
        third_link = await _connect(client, coach, third)
        await _share(client, athlete, link)
        await _share(client, third, third_link)
        for username, kilos in (("intruder", 80), ("second", 90), ("third", 70)):
            await _add_workout(
                db,
                await _user_id(db, username),
                exercise,
                END - timedelta(days=2),
                title=f"{username} day",
                sets=[(kilos, 8, False), (kilos, 8, False)],
            )

        items = _by_id((await _overview(client, coach)).json())

        assert items[link]["activity"]["working_sets_in_window"] == 2
        assert items[second_link]["activity"] is None
        assert items[third_link]["activity"]["latest_workout"]["title"] == "third day"
        assert [i["shares_workouts"] for i in items.values()].count(False) == 1


class TestDefinitions:
    async def test_counts_workouts_and_working_sets_only(
        self,
        client: AsyncClient,
        db: AsyncSession,
        exercise: UUID,
        coach: Headers,
        athlete: Headers,
        link: str,
    ) -> None:
        await _share(client, athlete, link)
        user = await _user_id(db, "intruder")
        await _add_workout(
            db,
            user,
            exercise,
            END - timedelta(days=3),
            sets=[
                (20, 12, True),  # warm-up: not a working set
                (100, 5, False),
                (0, 10, False),  # 0 kg is a real set
                (60, 0, False),  # zero-rep placeholder: not work done
                (100, 5, False),
            ],
        )
        await _add_workout(db, user, exercise, END - timedelta(days=1), sets=[(50, 10, False)])
        # In progress: not completed, so not counted, with or without sets.
        await _add_workout(
            db, user, exercise, END - timedelta(hours=1), finished=False, sets=[(90, 6, False)]
        )

        activity = (await _overview(client, coach)).json()["items"][0]["activity"]

        assert activity["workouts_in_window"] == 2
        assert activity["working_sets_in_window"] == 4

    async def test_a_workout_with_no_sets_still_counts_as_a_workout(
        self,
        client: AsyncClient,
        db: AsyncSession,
        exercise: UUID,
        coach: Headers,
        athlete: Headers,
        link: str,
    ) -> None:
        await _share(client, athlete, link)
        await _add_workout(db, await _user_id(db, "intruder"), exercise, END - timedelta(days=1))

        activity = (await _overview(client, coach)).json()["items"][0]["activity"]

        assert activity["workouts_in_window"] == 1
        assert activity["working_sets_in_window"] == 0

    async def test_a_replayed_set_save_is_not_counted_twice(
        self,
        client: AsyncClient,
        db: AsyncSession,
        exercise: UUID,
        coach: Headers,
        athlete: Headers,
        link: str,
    ) -> None:
        await _share(client, athlete, link)
        created = await client.post(
            "/workouts",
            headers=athlete,
            json={"title": "Live", "performed_at": (END - timedelta(hours=2)).isoformat()},
        )
        workout_id = created.json()["id"]
        request_id = uuid4()
        body = {"exercise_id": str(exercise), "weight_kg": 80, "reps": 8}
        for _ in range(2):
            saved = await client.put(
                f"/workouts/{workout_id}/sets/requests/{request_id}", headers=athlete, json=body
            )
            assert saved.status_code in (200, 201), saved.text
        await client.post(f"/workouts/{workout_id}/finish", headers=athlete)

        activity = (await _overview(client, coach)).json()["items"][0]["activity"]

        assert activity["working_sets_in_window"] == 1


class TestWindow:
    async def test_window_is_returned_half_open_and_28_days(
        self, client: AsyncClient, coach: Headers
    ) -> None:
        window = (await _overview(client, coach)).json()["window"]

        assert datetime.fromisoformat(window["end"]) == END
        assert datetime.fromisoformat(window["start"]) == START
        assert window["days"] == 28

    async def test_boundaries_start_inclusive_end_exclusive(
        self,
        client: AsyncClient,
        db: AsyncSession,
        exercise: UUID,
        coach: Headers,
        athlete: Headers,
        link: str,
    ) -> None:
        await _share(client, athlete, link)
        user = await _user_id(db, "intruder")
        micro = timedelta(microseconds=1)
        for when, title in (
            (START - micro, "just before"),
            (START, "at start"),
            (END - micro, "just before end"),
            (END, "at end"),
        ):
            await _add_workout(db, user, exercise, when, title=title, sets=[(10, 10, False)])

        activity = (await _overview(client, coach)).json()["items"][0]["activity"]

        assert activity["workouts_in_window"] == 2
        assert activity["working_sets_in_window"] == 2
        # Latest is bounded by the same end: the workout AT end is not reported.
        assert activity["latest_workout"]["title"] == "just before end"

    async def test_latest_workout_is_all_time_even_outside_the_window(
        self,
        client: AsyncClient,
        db: AsyncSession,
        exercise: UUID,
        coach: Headers,
        athlete: Headers,
        link: str,
    ) -> None:
        await _share(client, athlete, link)
        old = END - timedelta(days=90)
        await _add_workout(
            db, await _user_id(db, "intruder"), exercise, old, title="Old", sets=[(10, 5, False)]
        )

        activity = (await _overview(client, coach)).json()["items"][0]["activity"]

        assert activity["workouts_in_window"] == 0
        assert activity["working_sets_in_window"] == 0
        assert activity["latest_workout"]["title"] == "Old"
        assert datetime.fromisoformat(activity["latest_workout"]["performed_at"]) == old

    async def test_latest_ignores_unfinished_and_breaks_ties_deterministically(
        self,
        client: AsyncClient,
        db: AsyncSession,
        exercise: UUID,
        coach: Headers,
        athlete: Headers,
        link: str,
    ) -> None:
        await _share(client, athlete, link)
        user = await _user_id(db, "intruder")
        await _add_workout(db, user, exercise, END - timedelta(days=5), title="Done")
        await _add_workout(
            db, user, exercise, END - timedelta(days=1), title="Open", finished=False
        )

        first = (await _overview(client, coach)).json()["items"][0]["activity"]
        second = (await _overview(client, coach)).json()["items"][0]["activity"]

        assert first["latest_workout"]["title"] == "Done"
        assert first == second

    @pytest.mark.parametrize(
        "as_of",
        [
            lambda: (datetime.now(UTC) + timedelta(minutes=5)).isoformat(),
            lambda: (datetime.now(UTC) - timedelta(hours=25)).isoformat(),
            lambda: (datetime.now(UTC) - timedelta(minutes=5)).replace(tzinfo=None).isoformat(),
            lambda: "not-a-date",
        ],
        ids=["future", "too old", "no time zone", "garbage"],
    )
    async def test_as_of_must_be_a_recent_past_instant(
        self, client: AsyncClient, coach: Headers, as_of: Any
    ) -> None:
        response = await _overview(client, coach, {"as_of": as_of()})

        assert response.status_code == 422

    async def test_without_as_of_the_window_ends_now(
        self, client: AsyncClient, coach: Headers
    ) -> None:
        before = datetime.now(UTC)
        window = (await client.get("/coaching/athletes/overview", headers=coach)).json()["window"]

        end = datetime.fromisoformat(window["end"])
        assert before <= end <= datetime.now(UTC)
        assert end - datetime.fromisoformat(window["start"]) == timedelta(days=28)


class TestNoCrossAthleteMixing:
    async def test_each_athlete_gets_only_their_own_numbers(
        self,
        client: AsyncClient,
        db: AsyncSession,
        exercise: UUID,
        coach: Headers,
        athlete: Headers,
        link: str,
    ) -> None:
        other = await _register(client, "other")
        other_link = await _connect(client, coach, other)
        await _share(client, athlete, link)
        await _share(client, other, other_link)
        a = await _user_id(db, "intruder")
        b = await _user_id(db, "other")
        for day in (1, 2, 3):
            await _add_workout(
                db, a, exercise, END - timedelta(days=day), title="A", sets=[(50, 10, False)] * 3
            )
        await _add_workout(
            db, b, exercise, END - timedelta(days=4), title="B", sets=[(60, 6, False)] * 5
        )

        items = _by_id((await _overview(client, coach)).json())

        assert items[link]["activity"]["workouts_in_window"] == 3
        assert items[link]["activity"]["working_sets_in_window"] == 9
        assert items[other_link]["activity"]["workouts_in_window"] == 1
        assert items[other_link]["activity"]["working_sets_in_window"] == 5
        assert items[link]["activity"]["latest_workout"]["title"] == "A"
        assert items[other_link]["activity"]["latest_workout"]["title"] == "B"

    async def test_another_coachs_athlete_data_is_not_mixed_in(
        self,
        client: AsyncClient,
        db: AsyncSession,
        exercise: UUID,
        coach: Headers,
        athlete: Headers,
        link: str,
    ) -> None:
        # The same athlete also coached by someone else, sharing with them only.
        await _share(client, athlete, link, enabled=False)
        rival = await _register(client, "rival")
        await client.post("/coaching/enable", headers=rival)
        rival_link = await _connect(client, rival, athlete)
        await _share(client, athlete, rival_link)
        await _add_workout(db, await _user_id(db, "intruder"), exercise, END - timedelta(days=1))

        mine = (await _overview(client, coach)).json()["items"][0]
        theirs = (await _overview(client, rival)).json()["items"][0]

        assert mine["activity"] is None
        assert theirs["activity"]["workouts_in_window"] == 1


class TestPagination:
    async def _roster(
        self, client: AsyncClient, db: AsyncSession, exercise: UUID, coach: Headers, count: int
    ) -> list[str]:
        ids = []
        for index in range(count):
            person = await _register(client, f"ath{index}")
            link_id = await _connect(client, coach, person)
            await _share(client, person, link_id)
            await _add_workout(
                db,
                await _user_id(db, f"ath{index}"),
                exercise,
                END - timedelta(days=index + 1),
                sets=[(10, 10, False)] * (index + 1),
            )
            ids.append(link_id)
        return ids

    async def test_pages_are_stable_complete_and_in_roster_order(
        self, client: AsyncClient, db: AsyncSession, exercise: UUID, coach: Headers
    ) -> None:
        await self._roster(client, db, exercise, coach, 5)
        roster = await client.get("/coaching/athletes", headers=coach)
        plain = [i["id"] for i in roster.json()["items"]]

        seen: list[str] = []
        windows = set()
        for offset in (0, 2, 4):
            body = (
                await _overview(client, coach, {**AS_OF, "limit": 2, "offset": offset})
            ).json()
            assert body["total"] == 5
            seen += [i["id"] for i in body["items"]]
            windows.add((body["window"]["start"], body["window"]["end"]))

        assert seen == plain
        assert len(set(seen)) == 5
        assert len(windows) == 1

    async def test_offset_past_the_end_is_empty_with_the_true_total(
        self, client: AsyncClient, db: AsyncSession, exercise: UUID, coach: Headers
    ) -> None:
        await self._roster(client, db, exercise, coach, 2)

        body = (await _overview(client, coach, {**AS_OF, "offset": 10})).json()

        assert body["items"] == []
        assert body["total"] == 2

    @pytest.mark.parametrize("query", [{"limit": 0}, {"limit": 51}, {"offset": -1}])
    async def test_bounds_are_validated(
        self, client: AsyncClient, coach: Headers, query: dict[str, int]
    ) -> None:
        assert (await _overview(client, coach, {**AS_OF, **query})).status_code == 422

    async def test_statement_count_does_not_grow_with_the_page(
        self,
        client: AsyncClient,
        db: AsyncSession,
        db_engine: AsyncEngine,
        exercise: UUID,
        coach: Headers,
    ) -> None:
        await self._roster(client, db, exercise, coach, 6)
        statements: list[str] = []

        def record(conn: Any, cursor: Any, statement: str, *rest: Any) -> None:
            statements.append(statement)

        event.listen(db_engine.sync_engine, "before_cursor_execute", record)
        try:
            counts = []
            for limit in (1, 6):
                statements.clear()
                body = (await _overview(client, coach, {**AS_OF, "limit": limit})).json()
                assert len(body["items"]) == limit
                counts.append(len(statements))
        finally:
            event.remove(db_engine.sync_engine, "before_cursor_execute", record)

        assert counts[0] == counts[1]
        # Authentication + the count + the page; nothing per athlete.
        assert counts[0] <= 4


class TestPermissionChanges:
    async def test_turning_sharing_off_drops_the_numbers_on_the_next_request(
        self,
        client: AsyncClient,
        db: AsyncSession,
        exercise: UUID,
        coach: Headers,
        athlete: Headers,
        link: str,
    ) -> None:
        await _share(client, athlete, link)
        await _add_workout(db, await _user_id(db, "intruder"), exercise, END - timedelta(days=1))
        assert (await _overview(client, coach)).json()["items"][0]["activity"] is not None

        await _share(client, athlete, link, enabled=False)

        item = (await _overview(client, coach)).json()["items"][0]
        assert item["shares_workouts"] is False
        assert item["activity"] is None

    async def test_an_ended_link_disappears_from_the_overview(
        self,
        client: AsyncClient,
        db: AsyncSession,
        exercise: UUID,
        coach: Headers,
        athlete: Headers,
        link: str,
    ) -> None:
        await _share(client, athlete, link)
        await _add_workout(db, await _user_id(db, "intruder"), exercise, END - timedelta(days=1))

        assert (await client.delete(f"/coaching/links/{link}", headers=athlete)).status_code == 204

        body = (await _overview(client, coach)).json()
        assert body["items"] == []
        assert body["total"] == 0
