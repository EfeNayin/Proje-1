"""A coach reading a connected athlete's completed workouts.

The athlete's per-link switch is the only way in. These tests go through the
real app against the real test database with up to four accounts, and are
mostly about who must NOT be able to read what.
"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tests.test_coaching import Headers, _connect, _register

NOW = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)


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


async def _share(client: AsyncClient, athlete: Headers, link_id: str, enabled: bool = True):  # type: ignore[no-untyped-def]
    return await client.put(
        f"/coaching/links/{link_id}/workout-sharing", headers=athlete, json={"enabled": enabled}
    )


async def _log(
    client: AsyncClient,
    headers: Headers,
    *,
    title: str,
    days_ago: int,
    sets: list[dict[str, object]] | None = None,
    finish: bool = True,
) -> str:
    created = await client.post(
        "/workouts",
        headers=headers,
        json={
            "title": title,
            "performed_at": (NOW - timedelta(days=days_ago)).isoformat(),
            "sets": sets or [],
        },
    )
    assert created.status_code == 201, created.text
    workout_id = str(created.json()["id"])
    if finish:
        assert (
            await client.post(f"/workouts/{workout_id}/finish", headers=headers)
        ).status_code == 200
    return workout_id


def _set(exercise_id: str, weight: float, reps: int, **extra: object) -> dict[str, object]:
    return {"exercise_id": exercise_id, "weight_kg": weight, "reps": reps, **extra}


async def _workouts(client: AsyncClient, coach: Headers, link_id: str, query: str = "") -> Response:
    return await client.get(f"/coaching/athletes/{link_id}/workouts{query}", headers=coach)


async def _detail(client: AsyncClient, coach: Headers, link_id: str, workout_id: str) -> Response:
    return await client.get(f"/coaching/athletes/{link_id}/workouts/{workout_id}", headers=coach)


class TestConsentDefaultsToOff:
    async def test_a_new_link_shares_nothing_and_both_sides_can_see_that(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str
    ) -> None:
        mine = (await client.get("/coaching/athletes", headers=coach)).json()["items"]
        theirs = (await client.get("/coaching/coaches", headers=athlete)).json()["items"]

        assert [item["shares_workouts"] for item in mine + theirs] == [False, False]

    async def test_a_link_written_without_the_column_is_off(
        self, client: AsyncClient, coach: Headers, athlete: Headers, db: AsyncSession
    ) -> None:
        # What the migration relies on for links that already exist: a row that
        # never mentions the column gets the server default, which is off.
        await client.post("/coaching/invites", headers=coach)
        invite = (await db.execute(text("SELECT id::text FROM coach_invites"))).scalar_one()
        users = (await db.execute(text("SELECT id::text FROM users ORDER BY username"))).scalars()
        efe, intruder = users.all()
        await db.execute(
            text(
                "INSERT INTO coach_athlete_links (coach_id, athlete_id, invite_id) "
                "VALUES (:c, :a, :i)"
            ),
            {"c": efe, "a": intruder, "i": invite},
        )
        await db.commit()

        listed = (await client.get("/coaching/athletes", headers=coach)).json()["items"]

        assert [item["shares_workouts"] for item in listed] == [False]

    async def test_without_the_switch_the_coach_gets_neither_list_nor_detail(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, bench_press_id: str
    ) -> None:
        workout = await _log(
            client, athlete, title="Push", days_ago=1, sets=[_set(bench_press_id, 80, 5)]
        )

        listing = await _workouts(client, coach, link)
        detail = await _detail(client, coach, link, workout)

        assert listing.status_code == detail.status_code == 403
        assert "Push" not in listing.text + detail.text

    async def test_the_coach_cannot_switch_it_on_and_nobody_else_can_either(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str
    ) -> None:
        stranger = await _register(client, "stranger")

        by_coach = await _share(client, coach, link)
        by_stranger = await _share(client, stranger, link)

        assert by_coach.status_code == 403
        assert by_stranger.status_code == 404
        listed = (await client.get("/coaching/athletes", headers=coach)).json()["items"]
        assert listed[0]["shares_workouts"] is False

    async def test_the_switch_needs_a_real_boolean(
        self, client: AsyncClient, athlete: Headers, link: str
    ) -> None:
        response = await client.put(
            f"/coaching/links/{link}/workout-sharing", headers=athlete, json={}
        )

        assert response.status_code == 422

    async def test_switching_is_idempotent_and_visible_to_both_sides(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str
    ) -> None:
        first = await _share(client, athlete, link)
        again = await _share(client, athlete, link)

        assert first.status_code == again.status_code == 200
        assert first.json()["shares_workouts"] is True
        assert first.json()["person"]["username"] == "efe"  # the athlete's view: their coach
        mine = (await client.get("/coaching/athletes", headers=coach)).json()["items"]
        theirs = (await client.get("/coaching/coaches", headers=athlete)).json()["items"]
        assert [item["shares_workouts"] for item in mine + theirs] == [True, True]

    async def test_a_new_link_after_an_ended_one_starts_off_again(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str
    ) -> None:
        await _share(client, athlete, link)
        await client.delete(f"/coaching/links/{link}", headers=coach)

        again = await _connect(client, coach, athlete)

        listed = (await client.get("/coaching/athletes", headers=coach)).json()["items"]
        assert listed[0]["id"] == again
        assert listed[0]["shares_workouts"] is False
        assert (await _workouts(client, coach, again)).status_code == 403


class TestWhatTheCoachSees:
    async def test_completed_workouts_newest_first_and_nothing_in_progress(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, bench_press_id: str
    ) -> None:
        await _share(client, athlete, link)
        old = await _log(
            client, athlete, title="Old", days_ago=5, sets=[_set(bench_press_id, 60, 8)]
        )
        new = await _log(
            client, athlete, title="New", days_ago=1, sets=[_set(bench_press_id, 70, 8)]
        )
        await _log(client, athlete, title="Still going", days_ago=0, finish=False)

        response = await _workouts(client, coach, link)

        body = response.json()
        assert response.status_code == 200
        assert [item["id"] for item in body["items"]] == [new, old]
        assert body["total"] == 2

    async def test_the_list_carries_only_what_the_screen_draws(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, bench_press_id: str
    ) -> None:
        await _share(client, athlete, link)
        await client.post(
            "/workouts",
            headers=athlete,
            json={"title": "Secret notes", "notes": "my private note", "sets": []},
        )
        await _log(client, athlete, title="Chest", days_ago=1, sets=[_set(bench_press_id, 80, 5)])

        item = (await _workouts(client, coach, link)).json()["items"][0]

        assert set(item) == {
            "id", "title", "performed_at", "finished_at", "finished_automatically", "total_sets",
        }  # fmt: skip
        assert "private note" not in (await _workouts(client, coach, link)).text

    async def test_an_empty_history_is_an_empty_list_not_an_error(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str
    ) -> None:
        await _share(client, athlete, link)

        response = await _workouts(client, coach, link)

        assert response.status_code == 200
        assert response.json()["items"] == []
        assert response.json()["total"] == 0

    async def test_paging_walks_the_whole_history_without_repeats(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str
    ) -> None:
        await _share(client, athlete, link)
        ids = [await _log(client, athlete, title=f"W{n}", days_ago=n) for n in range(1, 6)]

        pages = [
            (await _workouts(client, coach, link, f"?limit=2&offset={offset}")).json()
            for offset in (0, 2, 4)
        ]

        assert [len(page["items"]) for page in pages] == [2, 2, 1]
        assert {page["total"] for page in pages} == {5}
        assert [item["id"] for page in pages for item in page["items"]] == ids

    async def test_page_size_is_bounded(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str
    ) -> None:
        await _share(client, athlete, link)

        assert (await _workouts(client, coach, link, "?limit=51")).status_code == 422
        assert (await _workouts(client, coach, link, "?offset=-1")).status_code == 422

    async def test_detail_groups_sets_by_exercise_with_zero_kg_and_rir_zero_kept(
        self,
        client: AsyncClient,
        coach: Headers,
        athlete: Headers,
        link: str,
        bench_press_id: str,
        squat_id: str,
    ) -> None:
        await _share(client, athlete, link)
        workout = await _log(
            client,
            athlete,
            title="Mixed",
            days_ago=1,
            sets=[
                _set(bench_press_id, 40, 10, is_warmup=True),
                _set(bench_press_id, 0, 12, rir=0),
                _set(squat_id, 100, 5),
                _set(bench_press_id, 82.5, 6, rir=2),
            ],
        )

        response = await _detail(client, coach, link, workout)

        body = response.json()
        assert response.status_code == 200
        assert [exercise["exercise_id"] for exercise in body["exercises"]] == [
            bench_press_id,
            squat_id,
        ]
        bench, squat = body["exercises"]
        shown = [
            (s["set_number"], s["weight_kg"], s["reps"], s["rir"], s["is_warmup"])
            for s in bench["sets"]
        ]
        assert shown == [
            (1, "40.00", 10, None, True),
            (2, "0.00", 12, 0, False),
            (3, "82.50", 6, 2, False),
        ]  # fmt: skip
        assert squat["sets"][0]["rir"] is None
        assert body["total_sets"] == 3  # working sets only, as in the athlete's own list
        assert set(body) == {
            "id", "title", "performed_at", "finished_at", "finished_automatically", "total_sets",
            "exercises",
        }  # fmt: skip

    async def test_duration_meaning_is_passed_through_untouched(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, db: AsyncSession
    ) -> None:
        await _share(client, athlete, link)
        explicit = await _log(client, athlete, title="Pressed finish", days_ago=3)
        auto = await _log(client, athlete, title="Auto", days_ago=2, finish=False)
        await _log(client, athlete, title="Next", days_ago=1)  # starting it closes "Auto"
        legacy = await _log(client, athlete, title="Legacy", days_ago=0)
        await db.execute(
            text("UPDATE workouts SET finished_automatically = NULL WHERE id = :id"), {"id": legacy}
        )
        await db.commit()

        items = {
            item["id"]: item["finished_automatically"]
            for item in (await _workouts(client, coach, link)).json()["items"]
        }

        assert items[explicit] is False
        assert items[auto] is True
        assert items[legacy] is None

    async def test_an_unfinished_workout_has_no_detail_for_the_coach(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str
    ) -> None:
        await _share(client, athlete, link)
        running = await _log(client, athlete, title="Running", days_ago=0, finish=False)

        assert (await _detail(client, coach, link, running)).status_code == 404

    async def test_nothing_the_coach_does_here_changes_the_athletes_records(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, bench_press_id: str
    ) -> None:
        await _share(client, athlete, link)
        workout = await _log(
            client, athlete, title="Mine", days_ago=1, sets=[_set(bench_press_id, 80, 5)]
        )
        url = f"/coaching/athletes/{link}/workouts/{workout}"

        for method in ("put", "patch", "delete", "post"):
            assert (await client.request(method.upper(), url, headers=coach)).status_code == 405

        own = await client.get(f"/workouts/{workout}", headers=athlete)
        assert own.json()["title"] == "Mine"
        assert len(own.json()["sets"]) == 1


class TestWhoCanAsk:
    async def test_every_endpoint_needs_a_token(self, client: AsyncClient, link: str) -> None:
        paths = [
            ("GET", f"/coaching/athletes/{link}/workouts"),
            ("GET", f"/coaching/athletes/{link}/workouts/{uuid4()}"),
            ("PUT", f"/coaching/links/{link}/workout-sharing"),
        ]
        for method, path in paths:
            assert (await client.request(method, path)).status_code == 401

    async def test_a_user_with_no_connection_gets_nothing(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, bench_press_id: str
    ) -> None:
        await _share(client, athlete, link)
        workout = await _log(
            client, athlete, title="Private", days_ago=1, sets=[_set(bench_press_id, 80, 5)]
        )
        stranger = await _register(client, "stranger")
        await client.post("/coaching/enable", headers=stranger)

        listing = await _workouts(client, stranger, link)
        detail = await _detail(client, stranger, link, workout)

        assert listing.status_code == detail.status_code == 404
        assert "Private" not in listing.text + detail.text

    async def test_the_athlete_cannot_use_the_coach_endpoints_on_their_own_link(
        self, client: AsyncClient, athlete: Headers, link: str
    ) -> None:
        assert (await _workouts(client, athlete, link)).status_code == 404

    async def test_a_link_id_that_does_not_exist_is_a_404(
        self, client: AsyncClient, coach: Headers
    ) -> None:
        assert (await _workouts(client, coach, str(uuid4()))).status_code == 404

    async def test_another_athletes_workout_id_does_not_resolve_through_my_athletes_link(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, bench_press_id: str
    ) -> None:
        # The coach is linked to two athletes, both sharing. A workout of the
        # second must not be readable through the first one's link.
        second = await _register(client, "second")
        second_link = await _connect(client, coach, second)
        await _share(client, athlete, link)
        await _share(client, second, second_link)
        theirs = await _log(
            client, second, title="Second's", days_ago=1, sets=[_set(bench_press_id, 90, 3)]
        )
        mine = await _log(
            client, athlete, title="First's", days_ago=1, sets=[_set(bench_press_id, 80, 5)]
        )

        crossed = await _detail(client, coach, link, theirs)
        proper = await _detail(client, coach, link, mine)

        assert crossed.status_code == 404
        assert proper.status_code == 200
        assert "Second's" not in (await _workouts(client, coach, link)).text

    async def test_the_coachs_own_workouts_are_not_reachable_through_an_athletes_link(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str
    ) -> None:
        await _share(client, athlete, link)
        own = await _log(client, coach, title="Coach's own", days_ago=1)

        assert (await _detail(client, coach, link, own)).status_code == 404
        assert "Coach's own" not in (await _workouts(client, coach, link)).text

    async def test_sharing_with_one_coach_does_not_open_another_coachs_link(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, bench_press_id: str
    ) -> None:
        other_coach = await _register(client, "othercoach")
        await client.post("/coaching/enable", headers=other_coach)
        other_link = await _connect(client, other_coach, athlete)
        await _share(client, athlete, link)
        await _log(client, athlete, title="Shared", days_ago=1, sets=[_set(bench_press_id, 80, 5)])

        assert (await _workouts(client, coach, link)).status_code == 200
        assert (await _workouts(client, other_coach, other_link)).status_code == 403
        # ...and the first coach cannot borrow the second coach's link id.
        assert (await _workouts(client, coach, other_link)).status_code == 404


class TestAccessEndsImmediately:
    async def test_turning_sharing_off_closes_it_and_turning_it_on_again_reopens_it(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, bench_press_id: str
    ) -> None:
        workout = await _log(
            client, athlete, title="W", days_ago=1, sets=[_set(bench_press_id, 80, 5)]
        )
        await _share(client, athlete, link)
        assert (await _detail(client, coach, link, workout)).status_code == 200

        await _share(client, athlete, link, enabled=False)

        assert (await _workouts(client, coach, link)).status_code == 403
        assert (await _detail(client, coach, link, workout)).status_code == 403
        await _share(client, athlete, link)
        assert (await _detail(client, coach, link, workout)).status_code == 200

    async def test_ending_the_link_closes_it_from_either_side(
        self, client: AsyncClient, coach: Headers, athlete: Headers, bench_press_id: str
    ) -> None:
        for ender in ("coach", "athlete"):
            link_id = await _connect(client, coach, athlete)
            workout = await _log(
                client, athlete, title=ender, days_ago=1, sets=[_set(bench_press_id, 80, 5)]
            )
            await _share(client, athlete, link_id)
            assert (await _detail(client, coach, link_id, workout)).status_code == 200

            await client.delete(
                f"/coaching/links/{link_id}", headers=coach if ender == "coach" else athlete
            )

            assert (await _workouts(client, coach, link_id)).status_code == 404
            assert (await _detail(client, coach, link_id, workout)).status_code == 404
            assert (await _share(client, athlete, link_id)).status_code == 404

    async def test_ending_a_link_keeps_the_athletes_workouts(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, bench_press_id: str
    ) -> None:
        workout = await _log(
            client, athlete, title="Kept", days_ago=1, sets=[_set(bench_press_id, 80, 5)]
        )
        await _share(client, athlete, link)

        await client.delete(f"/coaching/links/{link}", headers=athlete)

        kept = await client.get(f"/workouts/{workout}", headers=athlete)
        assert kept.status_code == 200
        assert kept.json()["title"] == "Kept"

    async def test_the_athlete_still_logs_and_edits_their_own_workouts_while_shared(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, bench_press_id: str
    ) -> None:
        await _share(client, athlete, link)
        workout = await _log(client, athlete, title="Live", days_ago=0, finish=False)

        added = await client.post(
            f"/workouts/{workout}/sets", headers=athlete, json=_set(bench_press_id, 100, 3, rir=1)
        )
        fixed = await client.patch(
            f"/workouts/{workout}/sets/{added.json()['sets'][0]['id']}",
            headers=athlete,
            json={"reps": 4},
        )
        renamed = await client.patch(
            f"/workouts/{workout}", headers=athlete, json={"title": "Edited"}
        )

        assert added.status_code == 201 or added.status_code == 200
        assert fixed.status_code == 200
        assert renamed.json()["title"] == "Edited"
