"""A coach reading a sharing athlete's earlier sessions of one exercise.

Opened from a completed workout of the athlete. The tests go through the real
app against the real test database and are mostly about who must NOT be able to
read what, and about the history being exactly the recorded sessions: same
inclusion rules as the athlete's own history, a deterministic order, and no
session skipped or repeated while paging.
"""

from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from tests.test_coaching import Headers, _connect, _register
from tests.test_coaching_workouts import NOW, _log, _set, _share

BASE = "/coaching/athletes"


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


def _url(link_id: str, workout_id: str, exercise_id: str) -> str:
    return f"{BASE}/{link_id}/workouts/{workout_id}/exercises/{exercise_id}/history"


async def _history(
    client: AsyncClient,
    coach: Headers,
    link_id: str,
    workout_id: str,
    exercise_id: str,
    **params: Any,
) -> Response:
    return await client.get(
        _url(link_id, workout_id, exercise_id), headers=coach, params=params or None
    )


async def _pages(
    client: AsyncClient, coach: Headers, link_id: str, workout_id: str, exercise_id: str, limit: int
) -> list[list[str]]:
    pages: list[list[str]] = []
    params: dict[str, Any] = {"limit": limit}
    while True:
        response = await _history(client, coach, link_id, workout_id, exercise_id, **params)
        assert response.status_code == 200, response.text
        body = response.json()
        pages.append([item["workout_id"] for item in body["items"]])
        if body["next_cursor"] is None:
            return pages
        params["cursor"] = body["next_cursor"]


async def _set_time(db: AsyncSession, workout_id: str, when: datetime) -> None:
    await db.execute(
        text("UPDATE workouts SET performed_at = :t WHERE id = :i"), {"t": when, "i": workout_id}
    )
    await db.commit()


class TestAuthorisation:
    async def test_a_sharing_coach_gets_earlier_sessions_newest_first(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, bench_press_id: str
    ) -> None:
        old = await _log(
            client, athlete, title="Old", days_ago=9, sets=[_set(bench_press_id, 60, 10, rir=3)]
        )
        newer = await _log(
            client,
            athlete,
            title="Newer",
            days_ago=5,
            sets=[_set(bench_press_id, 70, 8, rir=2), _set(bench_press_id, 70, 7, rir=1)],
        )
        anchor = await _log(
            client, athlete, title="Anchor", days_ago=1, sets=[_set(bench_press_id, 80, 5)]
        )

        response = await _history(client, coach, link, anchor, bench_press_id)

        assert response.status_code == 200, response.text
        assert response.headers["cache-control"] == "no-store"
        body = response.json()
        assert [item["workout_id"] for item in body["items"]] == [newer, old]
        assert body["next_cursor"] is None
        first = body["items"][0]
        assert first["title"] == "Newer"
        assert [(s["set_number"], s["weight_kg"], s["reps"], s["rir"]) for s in first["sets"]] == [
            (1, "70.00", 8, 2),
            (2, "70.00", 7, 1),
        ]

    async def test_only_what_the_screen_needs_is_returned(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, bench_press_id: str
    ) -> None:
        await _log(client, athlete, title="Old", days_ago=3, sets=[_set(bench_press_id, 60, 5)])
        anchor = await _log(
            client, athlete, title="Anchor", days_ago=1, sets=[_set(bench_press_id, 80, 5)]
        )

        body = (await _history(client, coach, link, anchor, bench_press_id)).json()

        assert set(body) == {"items", "next_cursor"}
        assert set(body["items"][0]) == {"workout_id", "title", "performed_at", "sets"}
        assert set(body["items"][0]["sets"][0]) == {
            "set_number",
            "weight_kg",
            "reps",
            "rir",
            "is_warmup",
        }

    async def test_requires_a_token(self, client: AsyncClient) -> None:
        zero = "00000000-0000-0000-0000-000000000000"
        response = await client.get(_url(zero, zero, zero))
        assert response.status_code == 401

    async def test_an_unrelated_coach_gets_nothing(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, bench_press_id: str
    ) -> None:
        await _log(client, athlete, title="Old", days_ago=3, sets=[_set(bench_press_id, 60, 5)])
        anchor = await _log(
            client, athlete, title="Anchor", days_ago=1, sets=[_set(bench_press_id, 80, 5)]
        )
        stranger = await _register(client, "stranger")
        assert (await client.post("/coaching/enable", headers=stranger)).status_code == 200

        response = await _history(client, stranger, link, anchor, bench_press_id)

        assert response.status_code == 404
        assert "Old" not in response.text

    async def test_the_athlete_cannot_use_the_coach_path_on_their_own_link(
        self, client: AsyncClient, athlete: Headers, link: str, bench_press_id: str
    ) -> None:
        anchor = await _log(
            client, athlete, title="Anchor", days_ago=1, sets=[_set(bench_press_id, 80, 5)]
        )

        response = await _history(client, athlete, link, anchor, bench_press_id)

        assert response.status_code == 404

    async def test_sharing_off_is_refused_and_leaks_nothing(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, bench_press_id: str
    ) -> None:
        await _log(client, athlete, title="Old", days_ago=3, sets=[_set(bench_press_id, 60, 5)])
        anchor = await _log(
            client, athlete, title="Anchor", days_ago=1, sets=[_set(bench_press_id, 80, 5)]
        )
        assert (await _history(client, coach, link, anchor, bench_press_id)).status_code == 200

        await _share(client, athlete, link, False)
        response = await _history(client, coach, link, anchor, bench_press_id)

        assert response.status_code == 403
        assert "Old" not in response.text

    async def test_a_cursor_taken_before_sharing_was_withdrawn_opens_nothing(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, bench_press_id: str
    ) -> None:
        for days in (6, 5, 4):
            await _log(
                client, athlete, title=f"D{days}", days_ago=days, sets=[_set(bench_press_id, 60, 5)]
            )
        anchor = await _log(
            client, athlete, title="Anchor", days_ago=1, sets=[_set(bench_press_id, 80, 5)]
        )
        first = (await _history(client, coach, link, anchor, bench_press_id, limit=1)).json()
        assert first["next_cursor"]

        await _share(client, athlete, link, False)
        response = await _history(
            client, coach, link, anchor, bench_press_id, limit=1, cursor=first["next_cursor"]
        )

        assert response.status_code == 403

    async def test_an_ended_connection_is_not_found(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, bench_press_id: str
    ) -> None:
        anchor = await _log(
            client, athlete, title="Anchor", days_ago=1, sets=[_set(bench_press_id, 80, 5)]
        )
        assert (await client.delete(f"/coaching/links/{link}", headers=athlete)).status_code == 204

        response = await _history(client, coach, link, anchor, bench_press_id)

        assert response.status_code == 404

    async def test_sharing_is_per_connection(
        self, client: AsyncClient, coach: Headers, athlete: Headers, bench_press_id: str
    ) -> None:
        # Never switched on for this link.
        link_id = await _connect(client, coach, athlete)
        anchor = await _log(
            client, athlete, title="Anchor", days_ago=1, sets=[_set(bench_press_id, 80, 5)]
        )

        assert (await _history(client, coach, link_id, anchor, bench_press_id)).status_code == 403


class TestAnchorAndSubstitution:
    async def test_another_athletes_workout_cannot_be_the_anchor(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, bench_press_id: str
    ) -> None:
        # The coach's own account is a third party here: its workout id must not resolve.
        mine = await _log(
            client, coach, title="Coach own", days_ago=1, sets=[_set(bench_press_id, 100, 5)]
        )
        await _log(client, athlete, title="Old", days_ago=3, sets=[_set(bench_press_id, 60, 5)])

        response = await _history(client, coach, link, mine, bench_press_id)

        assert response.status_code == 404
        assert "Coach own" not in response.text

    async def test_a_second_athletes_workout_cannot_be_read_through_the_first_link(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, bench_press_id: str
    ) -> None:
        second = await _register(client, "second")
        second_link = await _connect(client, coach, second)
        assert (await _share(client, second, second_link)).status_code == 200
        theirs = await _log(
            client, second, title="Second anchor", days_ago=1, sets=[_set(bench_press_id, 90, 5)]
        )
        await _log(
            client, second, title="Second old", days_ago=4, sets=[_set(bench_press_id, 50, 5)]
        )

        wrong = await _history(client, coach, link, theirs, bench_press_id)
        right = await _history(client, coach, second_link, theirs, bench_press_id)

        assert wrong.status_code == 404
        assert "Second" not in wrong.text
        assert [i["title"] for i in right.json()["items"]] == ["Second old"]

    async def test_an_unfinished_anchor_is_refused(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, bench_press_id: str
    ) -> None:
        await _log(client, athlete, title="Old", days_ago=3, sets=[_set(bench_press_id, 60, 5)])
        open_one = await _log(
            client,
            athlete,
            title="Open",
            days_ago=1,
            sets=[_set(bench_press_id, 80, 5)],
            finish=False,
        )

        response = await _history(client, coach, link, open_one, bench_press_id)

        assert response.status_code == 404
        assert "Old" not in response.text

    async def test_an_unknown_anchor_is_refused(
        self, client: AsyncClient, coach: Headers, link: str, bench_press_id: str
    ) -> None:
        response = await _history(client, coach, link, str(uuid4()), bench_press_id)
        assert response.status_code == 404

    async def test_an_exercise_that_is_not_in_the_anchor_is_refused(
        self,
        client: AsyncClient,
        coach: Headers,
        athlete: Headers,
        link: str,
        bench_press_id: str,
        squat_id: str,
    ) -> None:
        await _log(client, athlete, title="Old", days_ago=3, sets=[_set(squat_id, 100, 5)])
        anchor = await _log(
            client, athlete, title="Anchor", days_ago=1, sets=[_set(bench_press_id, 80, 5)]
        )

        response = await _history(client, coach, link, anchor, squat_id)

        assert response.status_code == 404
        assert "Old" not in response.text

    async def test_an_unknown_exercise_is_refused(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, bench_press_id: str
    ) -> None:
        anchor = await _log(
            client, athlete, title="Anchor", days_ago=1, sets=[_set(bench_press_id, 80, 5)]
        )
        assert (await _history(client, coach, link, anchor, str(uuid4()))).status_code == 404

    async def test_a_warm_up_only_exercise_in_the_anchor_still_opens_its_history(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, bench_press_id: str
    ) -> None:
        old = await _log(
            client, athlete, title="Old", days_ago=3, sets=[_set(bench_press_id, 60, 5)]
        )
        anchor = await _log(
            client,
            athlete,
            title="Anchor",
            days_ago=1,
            sets=[_set(bench_press_id, 20, 10, is_warmup=True)],
        )

        response = await _history(client, coach, link, anchor, bench_press_id)

        assert [i["workout_id"] for i in response.json()["items"]] == [old]

    async def test_a_cursor_from_another_context_is_rejected(
        self,
        client: AsyncClient,
        coach: Headers,
        athlete: Headers,
        link: str,
        bench_press_id: str,
        squat_id: str,
    ) -> None:
        for days in (8, 7, 6):
            await _log(
                client,
                athlete,
                title=f"D{days}",
                days_ago=days,
                sets=[_set(bench_press_id, 60, 5), _set(squat_id, 90, 5)],
            )
        anchor = await _log(
            client,
            athlete,
            title="Anchor",
            days_ago=3,
            sets=[_set(bench_press_id, 80, 5), _set(squat_id, 120, 5)],
        )
        other_anchor = await _log(
            client,
            athlete,
            title="Other anchor",
            days_ago=1,
            sets=[_set(bench_press_id, 85, 5), _set(squat_id, 125, 5)],
        )
        cursor = (await _history(client, coach, link, anchor, bench_press_id, limit=1)).json()[
            "next_cursor"
        ]
        assert cursor

        other_exercise = await _history(client, coach, link, anchor, squat_id, cursor=cursor)
        other_workout = await _history(
            client, coach, link, other_anchor, bench_press_id, cursor=cursor
        )
        same = await _history(client, coach, link, anchor, bench_press_id, cursor=cursor)

        assert other_exercise.status_code == 422
        assert other_workout.status_code == 422
        assert same.status_code == 200

    async def test_a_cursor_from_another_connection_is_rejected(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, bench_press_id: str
    ) -> None:
        for days in (8, 7):
            await _log(
                client, athlete, title=f"D{days}", days_ago=days, sets=[_set(bench_press_id, 60, 5)]
            )
        anchor = await _log(
            client, athlete, title="Anchor", days_ago=1, sets=[_set(bench_press_id, 80, 5)]
        )
        cursor = (await _history(client, coach, link, anchor, bench_press_id, limit=1)).json()[
            "next_cursor"
        ]
        # The athlete reconnects: a new link id, same people.
        assert (await client.delete(f"/coaching/links/{link}", headers=athlete)).status_code == 204
        fresh = await _connect(client, coach, athlete)
        assert (await _share(client, athlete, fresh)).status_code == 200

        response = await _history(client, coach, fresh, anchor, bench_press_id, cursor=cursor)

        assert response.status_code == 422

    @pytest.mark.parametrize("cursor", ["", "not-base64!!", "e30=", "bm90LWpzb24="])
    async def test_garbage_cursors_are_422(
        self,
        client: AsyncClient,
        coach: Headers,
        athlete: Headers,
        link: str,
        bench_press_id: str,
        cursor: str,
    ) -> None:
        anchor = await _log(
            client, athlete, title="Anchor", days_ago=1, sets=[_set(bench_press_id, 80, 5)]
        )
        params: dict[str, Any] = {"cursor": cursor} if cursor else {"cursor": ""}
        response = await _history(client, coach, link, anchor, bench_press_id, **params)
        assert response.status_code == 422

    @pytest.mark.parametrize("limit", [0, 51, -1])
    async def test_the_page_size_is_bounded(
        self,
        client: AsyncClient,
        coach: Headers,
        athlete: Headers,
        link: str,
        bench_press_id: str,
        limit: int,
    ) -> None:
        anchor = await _log(
            client, athlete, title="Anchor", days_ago=1, sets=[_set(bench_press_id, 80, 5)]
        )
        response = await _history(client, coach, link, anchor, bench_press_id, limit=limit)
        assert response.status_code == 422


class TestSemantics:
    async def test_the_anchor_later_sessions_and_other_athletes_are_excluded(
        self,
        client: AsyncClient,
        coach: Headers,
        athlete: Headers,
        link: str,
        bench_press_id: str,
    ) -> None:
        second = await _register(client, "second")
        await _log(
            client, second, title="Not theirs", days_ago=6, sets=[_set(bench_press_id, 55, 5)]
        )
        before = await _log(
            client, athlete, title="Before", days_ago=6, sets=[_set(bench_press_id, 60, 5)]
        )
        anchor = await _log(
            client, athlete, title="Anchor", days_ago=4, sets=[_set(bench_press_id, 70, 5)]
        )
        await _log(client, athlete, title="Later", days_ago=2, sets=[_set(bench_press_id, 80, 5)])

        body = (await _history(client, coach, link, anchor, bench_press_id)).json()

        assert [i["workout_id"] for i in body["items"]] == [before]

    async def test_a_session_at_the_anchors_exact_start_is_excluded_like_the_athletes_own_history(
        self,
        client: AsyncClient,
        db: AsyncSession,
        coach: Headers,
        athlete: Headers,
        link: str,
        bench_press_id: str,
    ) -> None:
        twin = await _log(
            client, athlete, title="Twin", days_ago=2, sets=[_set(bench_press_id, 60, 5)]
        )
        anchor = await _log(
            client, athlete, title="Anchor", days_ago=2, sets=[_set(bench_press_id, 70, 5)]
        )
        same = NOW - timedelta(days=2)
        await _set_time(db, twin, same)
        await _set_time(db, anchor, same)

        coach_view = (await _history(client, coach, link, anchor, bench_press_id)).json()
        own_view = (
            await client.get(
                f"/workouts/{anchor}/exercises/{bench_press_id}/history", headers=athlete
            )
        ).json()

        assert coach_view["items"] == [] == own_view["items"]

    async def test_unfinished_sessions_warm_ups_and_zero_reps_do_not_count(
        self,
        client: AsyncClient,
        db: AsyncSession,
        coach: Headers,
        athlete: Headers,
        link: str,
        bench_press_id: str,
        squat_id: str,
    ) -> None:
        unfinished = await _log(
            client, athlete, title="Unfinished", days_ago=8, sets=[_set(bench_press_id, 60, 5)]
        )

        await _log(
            client,
            athlete,
            title="Warm-ups only",
            days_ago=7,
            sets=[_set(bench_press_id, 20, 10, is_warmup=True)],
        )
        await _log(
            client, athlete, title="Zero reps", days_ago=6, sets=[_set(bench_press_id, 60, 0)]
        )
        await _log(
            client, athlete, title="Other exercise", days_ago=5, sets=[_set(squat_id, 100, 5)]
        )
        mixed = await _log(
            client,
            athlete,
            title="Mixed",
            days_ago=4,
            sets=[
                _set(bench_press_id, 20, 10, is_warmup=True),
                _set(bench_press_id, 60, 5),
                _set(bench_press_id, 60, 0),
                _set(squat_id, 100, 5),
            ],
        )
        anchor = await _log(
            client, athlete, title="Anchor", days_ago=1, sets=[_set(bench_press_id, 70, 5)]
        )

        # Reopened last: creating a workout closes any session still open.
        await db.execute(
            text("UPDATE workouts SET finished_at = NULL WHERE id = :i"), {"i": unfinished}
        )
        await db.commit()

        body = (await _history(client, coach, link, anchor, bench_press_id)).json()

        assert [i["workout_id"] for i in body["items"]] == [mixed]
        sets = body["items"][0]["sets"]
        assert [(s["weight_kg"], s["reps"], s["is_warmup"]) for s in sets] == [("60.00", 5, False)]

    async def test_exercise_ids_with_the_same_name_are_not_merged(
        self,
        client: AsyncClient,
        db: AsyncSession,
        coach: Headers,
        athlete: Headers,
        link: str,
        bench_press_id: str,
    ) -> None:
        name = (await client.get(f"/exercises/{bench_press_id}", headers=coach)).json()["name"]
        twin_id = (
            await db.execute(
                text("INSERT INTO exercises (name) VALUES (:n) RETURNING id::text"), {"n": name}
            )
        ).scalar_one()
        await db.commit()
        try:
            genuine = await _log(
                client, athlete, title="Genuine", days_ago=6, sets=[_set(bench_press_id, 60, 5)]
            )
            await _log(client, athlete, title="Twin", days_ago=5, sets=[_set(twin_id, 99, 5)])
            anchor = await _log(
                client, athlete, title="Anchor", days_ago=1, sets=[_set(bench_press_id, 70, 5)]
            )
            twin_anchor = await _log(
                client, athlete, title="Twin anchor", days_ago=0, sets=[_set(twin_id, 99, 5)]
            )

            real = (await _history(client, coach, link, anchor, bench_press_id)).json()
            other = (await _history(client, coach, link, twin_anchor, twin_id)).json()

            assert [i["workout_id"] for i in real["items"]] == [genuine]
            assert [i["title"] for i in other["items"]] == ["Twin"]
        finally:
            # The cleanup between tests removes users, not catalogue rows: take
            # this test's extra exercise (and the sets that use it) away again.
            await db.execute(text("DELETE FROM sets WHERE exercise_id = :i"), {"i": twin_id})
            await db.execute(text("DELETE FROM exercises WHERE id = :i"), {"i": twin_id})
            await db.commit()

    async def test_separate_sessions_with_identical_sets_stay_separate(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, bench_press_id: str
    ) -> None:
        same = [_set(bench_press_id, 60, 5, rir=2)]
        first = await _log(client, athlete, title="Push", days_ago=3, sets=same)
        second = await _log(client, athlete, title="Push", days_ago=2, sets=same)
        anchor = await _log(
            client, athlete, title="Anchor", days_ago=1, sets=[_set(bench_press_id, 70, 5)]
        )

        body = (await _history(client, coach, link, anchor, bench_press_id)).json()

        assert [i["workout_id"] for i in body["items"]] == [second, first]
        assert body["items"][0]["sets"] == body["items"][1]["sets"]

    async def test_zero_kilograms_and_rir_zero_versus_unrecorded_are_kept(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, bench_press_id: str
    ) -> None:
        await _log(
            client,
            athlete,
            title="Odd",
            days_ago=3,
            sets=[
                _set(bench_press_id, 0, 12, rir=0),
                _set(bench_press_id, 0, 10),
                _set(bench_press_id, 22.5, 8, rir=1),
            ],
        )
        anchor = await _log(
            client, athlete, title="Anchor", days_ago=1, sets=[_set(bench_press_id, 70, 5)]
        )

        sets = (await _history(client, coach, link, anchor, bench_press_id)).json()["items"][0][
            "sets"
        ]

        assert [(s["weight_kg"], s["reps"], s["rir"]) for s in sets] == [
            ("0.00", 12, 0),
            ("0.00", 10, None),
            ("22.50", 8, 1),
        ]

    async def test_an_empty_history_is_an_empty_page(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, bench_press_id: str
    ) -> None:
        anchor = await _log(
            client, athlete, title="Anchor", days_ago=1, sets=[_set(bench_press_id, 70, 5)]
        )

        response = await _history(client, coach, link, anchor, bench_press_id)

        assert response.status_code == 200
        assert response.json() == {"items": [], "next_cursor": None}

    async def test_the_athletes_own_history_is_unchanged_by_the_shared_query(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, bench_press_id: str
    ) -> None:
        old = await _log(
            client, athlete, title="Old", days_ago=3, sets=[_set(bench_press_id, 60, 5)]
        )
        anchor = await _log(
            client, athlete, title="Anchor", days_ago=1, sets=[_set(bench_press_id, 70, 5)]
        )

        own = (
            await client.get(
                f"/workouts/{anchor}/exercises/{bench_press_id}/history", headers=athlete
            )
        ).json()
        theirs = (await _history(client, coach, link, anchor, bench_press_id)).json()

        assert (
            [i["workout_id"] for i in own["items"]]
            == [old]
            == [i["workout_id"] for i in theirs["items"]]
        )
        # The coach's route never opens the athlete's own endpoint to anyone else.
        denied = await client.get(
            f"/workouts/{anchor}/exercises/{bench_press_id}/history", headers=coach
        )
        assert denied.status_code == 404


class TestPaging:
    async def test_identical_timestamps_page_deterministically_without_skips_or_repeats(
        self,
        client: AsyncClient,
        db: AsyncSession,
        coach: Headers,
        athlete: Headers,
        link: str,
        bench_press_id: str,
    ) -> None:
        tied = [
            await _log(
                client, athlete, title=f"Tie {n}", days_ago=5, sets=[_set(bench_press_id, 60, 5)]
            )
            for n in range(5)
        ]
        later = await _log(
            client, athlete, title="Later", days_ago=4, sets=[_set(bench_press_id, 62, 5)]
        )
        for workout in tied:
            await _set_time(db, workout, NOW - timedelta(days=5))
        anchor = await _log(
            client, athlete, title="Anchor", days_ago=1, sets=[_set(bench_press_id, 70, 5)]
        )

        one_by_one = await _pages(client, coach, link, anchor, bench_press_id, 1)
        by_two = await _pages(client, coach, link, anchor, bench_press_id, 2)
        everything = await _pages(client, coach, link, anchor, bench_press_id, 50)

        expected = [later, *sorted(tied, reverse=True)]
        assert [i for page in one_by_one for i in page] == expected
        assert [i for page in by_two for i in page] == expected
        assert everything == [expected]
        assert [len(page) for page in by_two] == [2, 2, 2]

    async def test_a_session_added_or_removed_between_pages_does_not_shift_the_rest(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str, bench_press_id: str
    ) -> None:
        logged = [
            await _log(
                client, athlete, title=f"D{d}", days_ago=d, sets=[_set(bench_press_id, 60, 5)]
            )
            for d in (9, 8, 7, 6, 5)
        ]
        anchor = await _log(
            client, athlete, title="Anchor", days_ago=1, sets=[_set(bench_press_id, 70, 5)]
        )
        first = (await _history(client, coach, link, anchor, bench_press_id, limit=2)).json()
        assert [i["workout_id"] for i in first["items"]] == [logged[4], logged[3]]

        # Newer than the cursor: deleted; and a brand new, newer one appears.
        assert (await client.delete(f"/workouts/{logged[4]}", headers=athlete)).status_code == 204
        await _log(client, athlete, title="Fresh", days_ago=2, sets=[_set(bench_press_id, 61, 5)])
        second = (
            await _history(
                client, coach, link, anchor, bench_press_id, limit=2, cursor=first["next_cursor"]
            )
        ).json()

        assert [i["workout_id"] for i in second["items"]] == [logged[2], logged[1]]

    async def test_more_than_fifty_sessions_page_to_the_end(
        self,
        client: AsyncClient,
        db: AsyncSession,
        coach: Headers,
        athlete: Headers,
        link: str,
        bench_press_id: str,
    ) -> None:
        logged = [
            await _log(
                client, athlete, title=f"S{n}", days_ago=1 + n, sets=[_set(bench_press_id, 60, 5)]
            )
            for n in range(1, 13)
        ]
        anchor = await _log(
            client, athlete, title="Anchor", days_ago=0, sets=[_set(bench_press_id, 70, 5)]
        )

        pages = await _pages(client, coach, link, anchor, bench_press_id, 5)

        assert [len(page) for page in pages] == [5, 5, 2]
        assert [i for page in pages for i in page] == logged

    async def test_statement_count_does_not_grow_with_sessions_or_sets(
        self,
        client: AsyncClient,
        db_engine: AsyncEngine,
        coach: Headers,
        athlete: Headers,
        link: str,
        bench_press_id: str,
    ) -> None:
        for n in range(6):
            await _log(
                client,
                athlete,
                title=f"S{n}",
                days_ago=2 + n,
                sets=[_set(bench_press_id, 60 + k, 5) for k in range(n + 1)],
            )
        anchor = await _log(
            client, athlete, title="Anchor", days_ago=1, sets=[_set(bench_press_id, 70, 5)]
        )
        statements: list[str] = []

        def record(conn: Any, cursor: Any, statement: str, *rest: Any) -> None:
            statements.append(statement)

        event.listen(db_engine.sync_engine, "before_cursor_execute", record)
        try:
            counts = []
            for limit in (1, 6):
                statements.clear()
                body = (
                    await _history(client, coach, link, anchor, bench_press_id, limit=limit)
                ).json()
                assert len(body["items"]) == limit
                counts.append(len(statements))
        finally:
            event.remove(db_engine.sync_engine, "before_cursor_execute", record)

        assert counts[0] == counts[1]
        # Authentication, link, anchor, membership, sessions, sets.
        assert counts[0] <= 7
