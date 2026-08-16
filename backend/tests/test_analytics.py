"""Tests for GET /analytics/weekly-volume.

This endpoint is the product's differentiator, and its failure mode is quiet:
the numbers stay plausible while being wrong. The tests therefore pin the two
rules that are easy to lose — weeks are cut in the user's timezone, and only
direct work counts toward the landmarks.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

from httpx import AsyncClient


def _monday_of_this_week() -> str:
    """Matches what the endpoint uses for the current week (UTC+3 default)."""
    from zoneinfo import ZoneInfo

    now = datetime.now(ZoneInfo("Europe/Istanbul"))
    return (now - timedelta(days=now.weekday())).date().isoformat()


async def _log(
    client: AsyncClient,
    headers: dict[str, str],
    sets: list[dict[str, Any]],
    performed_at: str | None = None,
) -> None:
    payload: dict[str, Any] = {"sets": sets}
    if performed_at:
        payload["performed_at"] = performed_at
    response = await client.post("/workouts", headers=headers, json=payload)
    assert response.status_code == 201, response.text


def _muscle(body: dict[str, Any], name: str, week_index: int = 0) -> dict[str, Any]:
    week = body["weeks"][week_index]
    return next(m for m in week["muscles"] if m["name"] == name)


class TestShape:
    async def test_returns_the_requested_number_of_weeks(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        body = (
            await client.get("/analytics/weekly-volume?weeks=6", headers=auth_headers)
        ).json()

        assert len(body["weeks"]) == 6

    async def test_lists_every_muscle_even_with_no_training(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """A muscle at zero is the most actionable row on the screen, so it
        cannot be omitted just because there is no data for it."""
        body = (await client.get("/analytics/weekly-volume", headers=auth_headers)).json()

        assert len(body["weeks"][0]["muscles"]) == 17
        assert all(m["direct_sets"] == 0 for m in body["weeks"][0]["muscles"])
        assert all(m["status"] == "untrained" for m in body["weeks"][0]["muscles"])

    async def test_weeks_are_newest_first(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        body = (
            await client.get("/analytics/weekly-volume?weeks=3", headers=auth_headers)
        ).json()

        starts = [w["week_start"] for w in body["weeks"]]
        assert starts == sorted(starts, reverse=True)
        assert starts[0] == _monday_of_this_week()

    async def test_reports_the_users_timezone(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """The client renders week labels, so it needs to know which zone the
        boundaries were computed in."""
        body = (await client.get("/analytics/weekly-volume", headers=auth_headers)).json()
        assert body["timezone"] == "Europe/Istanbul"

    async def test_rejects_an_absurd_range(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.get(
            "/analytics/weekly-volume?weeks=500", headers=auth_headers
        )
        assert response.status_code == 422

    async def test_requires_authentication(self, client: AsyncClient) -> None:
        response = await client.get("/analytics/weekly-volume")
        assert response.status_code == 401


class TestDirectVsIndirect:
    async def test_bench_counts_for_chest_but_not_triceps(
        self, client: AsyncClient, auth_headers: dict[str, str], bench_press_id: str
    ) -> None:
        """The rule the whole feature rests on: landmarks are defined for
        direct work, and the indirect stimulus is already priced into them."""
        await _log(
            client,
            auth_headers,
            [{"exercise_id": bench_press_id, "weight_kg": 100, "reps": 8}] * 3,
        )

        body = (await client.get("/analytics/weekly-volume", headers=auth_headers)).json()

        chest = _muscle(body, "chest")
        triceps = _muscle(body, "triceps")

        assert chest["direct_sets"] == 3
        assert triceps["direct_sets"] == 0
        # The assistance is still visible, just not counted as volume.
        assert triceps["involved_sets"] == 3

    async def test_isolation_work_counts_directly(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        pushdown = (
            await client.get("/exercises?q=pushdown", headers=auth_headers)
        ).json()["items"][0]["id"]

        await _log(
            client, auth_headers, [{"exercise_id": pushdown, "weight_kg": 30, "reps": 12}] * 4
        )

        body = (await client.get("/analytics/weekly-volume", headers=auth_headers)).json()
        assert _muscle(body, "triceps")["direct_sets"] == 4

    async def test_an_exercise_can_be_direct_for_two_muscles(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """RDL trains hamstrings and glutes directly; both should count."""
        rdl = (await client.get("/exercises?q=romanian", headers=auth_headers)).json()[
            "items"
        ][0]["id"]

        await _log(client, auth_headers, [{"exercise_id": rdl, "weight_kg": 120, "reps": 8}] * 3)

        body = (await client.get("/analytics/weekly-volume", headers=auth_headers)).json()
        assert _muscle(body, "hamstrings")["direct_sets"] == 3
        assert _muscle(body, "glutes")["direct_sets"] == 3

    async def test_warmups_are_excluded(
        self, client: AsyncClient, auth_headers: dict[str, str], bench_press_id: str
    ) -> None:
        await _log(
            client,
            auth_headers,
            [
                {"exercise_id": bench_press_id, "weight_kg": 60, "reps": 12, "is_warmup": True},
                {"exercise_id": bench_press_id, "weight_kg": 100, "reps": 8},
            ],
        )

        body = (await client.get("/analytics/weekly-volume", headers=auth_headers)).json()
        assert _muscle(body, "chest")["direct_sets"] == 1


class TestStatus:
    async def test_below_mev(
        self, client: AsyncClient, auth_headers: dict[str, str], bench_press_id: str
    ) -> None:
        # Chest MEV is 8.
        await _log(
            client,
            auth_headers,
            [{"exercise_id": bench_press_id, "weight_kg": 100, "reps": 8}] * 5,
        )

        body = (await client.get("/analytics/weekly-volume", headers=auth_headers)).json()
        chest = _muscle(body, "chest")

        assert chest["direct_sets"] == 5
        assert chest["status"] == "below_mev"
        assert (chest["mev"], chest["mav"], chest["mrv"]) == (8, 14, 22)

    async def test_optimal_between_mev_and_mav(
        self, client: AsyncClient, auth_headers: dict[str, str], bench_press_id: str
    ) -> None:
        await _log(
            client,
            auth_headers,
            [{"exercise_id": bench_press_id, "weight_kg": 100, "reps": 8}] * 10,
        )

        assert (
            _muscle(
                (await client.get("/analytics/weekly-volume", headers=auth_headers)).json(),
                "chest",
            )["status"]
            == "optimal"
        )

    async def test_high_between_mav_and_mrv(
        self, client: AsyncClient, auth_headers: dict[str, str], bench_press_id: str
    ) -> None:
        await _log(
            client,
            auth_headers,
            [{"exercise_id": bench_press_id, "weight_kg": 100, "reps": 8}] * 18,
        )

        assert (
            _muscle(
                (await client.get("/analytics/weekly-volume", headers=auth_headers)).json(),
                "chest",
            )["status"]
            == "high"
        )

    async def test_above_mrv(
        self, client: AsyncClient, auth_headers: dict[str, str], bench_press_id: str
    ) -> None:
        await _log(
            client,
            auth_headers,
            [{"exercise_id": bench_press_id, "weight_kg": 100, "reps": 8}] * 25,
        )

        assert (
            _muscle(
                (await client.get("/analytics/weekly-volume", headers=auth_headers)).json(),
                "chest",
            )["status"]
            == "above_mrv"
        )


class TestEffectivenessAndVolume:
    async def test_averages_effectiveness_over_direct_sets(
        self, client: AsyncClient, auth_headers: dict[str, str], bench_press_id: str
    ) -> None:
        """Answers "is the chest work any good", not just "how much of it"."""
        cable_fly = (await client.get("/exercises?q=cable fly", headers=auth_headers)).json()[
            "items"
        ][0]["id"]

        # Bench is 5 for chest, cable fly is 4.
        await _log(
            client,
            auth_headers,
            [
                {"exercise_id": bench_press_id, "weight_kg": 100, "reps": 8},
                {"exercise_id": cable_fly, "weight_kg": 30, "reps": 12},
            ],
        )

        chest = _muscle(
            (await client.get("/analytics/weekly-volume", headers=auth_headers)).json(), "chest"
        )
        assert chest["avg_effectiveness"] == 4.5

    async def test_effectiveness_is_null_without_direct_work(
        self, client: AsyncClient, auth_headers: dict[str, str], bench_press_id: str
    ) -> None:
        await _log(
            client, auth_headers, [{"exercise_id": bench_press_id, "weight_kg": 100, "reps": 8}]
        )

        body = (await client.get("/analytics/weekly-volume", headers=auth_headers)).json()
        # Triceps were involved but never trained directly.
        assert _muscle(body, "triceps")["avg_effectiveness"] is None

    async def test_tonnage_comes_from_direct_sets_only(
        self, client: AsyncClient, auth_headers: dict[str, str], bench_press_id: str
    ) -> None:
        await _log(
            client,
            auth_headers,
            [{"exercise_id": bench_press_id, "weight_kg": 100, "reps": 8}] * 2,
        )

        body = (await client.get("/analytics/weekly-volume", headers=auth_headers)).json()

        assert _muscle(body, "chest")["volume_kg"] == "1600.00"
        assert _muscle(body, "triceps")["volume_kg"] == "0.00"


class TestWeekBoundaries:
    async def test_a_session_lands_in_its_local_week(
        self, client: AsyncClient, auth_headers: dict[str, str], bench_press_id: str
    ) -> None:
        """01:00 Monday in Istanbul is 22:00 Sunday UTC. Cutting weeks in UTC
        would credit it to the previous week."""
        now = datetime.now(UTC)
        # Somewhere safely inside the current week, in local terms.
        await _log(
            client,
            auth_headers,
            [{"exercise_id": bench_press_id, "weight_kg": 100, "reps": 8}],
            performed_at=now.isoformat(),
        )

        body = (
            await client.get("/analytics/weekly-volume?weeks=2", headers=auth_headers)
        ).json()

        assert _muscle(body, "chest", week_index=0)["direct_sets"] == 1
        assert _muscle(body, "chest", week_index=1)["direct_sets"] == 0

    async def test_older_sessions_fall_outside_the_window(
        self, client: AsyncClient, auth_headers: dict[str, str], bench_press_id: str
    ) -> None:
        long_ago = (datetime.now(UTC) - timedelta(weeks=10)).isoformat()
        await _log(
            client,
            auth_headers,
            [{"exercise_id": bench_press_id, "weight_kg": 100, "reps": 8}],
            performed_at=long_ago,
        )

        body = (
            await client.get("/analytics/weekly-volume?weeks=4", headers=auth_headers)
        ).json()

        assert all(
            _muscle(body, "chest", week_index=i)["direct_sets"] == 0 for i in range(4)
        )

    async def test_sessions_are_grouped_into_separate_weeks(
        self, client: AsyncClient, auth_headers: dict[str, str], bench_press_id: str
    ) -> None:
        now = datetime.now(UTC)
        await _log(
            client,
            auth_headers,
            [{"exercise_id": bench_press_id, "weight_kg": 100, "reps": 8}] * 2,
            performed_at=now.isoformat(),
        )
        await _log(
            client,
            auth_headers,
            [{"exercise_id": bench_press_id, "weight_kg": 100, "reps": 8}] * 3,
            performed_at=(now - timedelta(weeks=1)).isoformat(),
        )

        body = (
            await client.get("/analytics/weekly-volume?weeks=3", headers=auth_headers)
        ).json()

        assert _muscle(body, "chest", week_index=0)["direct_sets"] == 2
        assert _muscle(body, "chest", week_index=1)["direct_sets"] == 3


class TestIsolation:
    async def test_another_users_training_is_not_counted(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        other_auth_headers: dict[str, str],
        bench_press_id: str,
    ) -> None:
        await _log(
            client,
            other_auth_headers,
            [{"exercise_id": bench_press_id, "weight_kg": 100, "reps": 8}] * 5,
        )

        body = (await client.get("/analytics/weekly-volume", headers=auth_headers)).json()

        assert _muscle(body, "chest")["direct_sets"] == 0