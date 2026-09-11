"""Tests for GET /analytics/diagnosis — the "why am I not growing" screen.

Two layers, for two different reasons:

- TestVolumeCandidates exercises `_volume_candidates` directly, with
  synthetic MuscleGroup/aggregate data instead of going through the API.
  Synthetic inputs isolate ranking rules from catalogue coverage and the
  top-three budget: a trained-but-light muscle is below_mev, never untrained.

- The rest goes through the real API and a real Postgres database, matching
  every other test in this suite, and covers what only the full stack can
  prove: the timezone-aware window, ownership isolation, and the
  has_enough_data gate.
"""

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domains.analytics.service import _volume_candidates, _WeekMuscleAggregates
from app.models import BodyMeasurement, Exercise, MuscleGroup, ReadinessLog, Set, User, Workout

_ISTANBUL = ZoneInfo("Europe/Istanbul")


def _muscle(
    id_: int,
    name: str,
    name_tr: str,
    region: str,
    mev: int | None = None,
    mav: int | None = None,
    mrv: int | None = None,
) -> MuscleGroup:
    return MuscleGroup(id=id_, name=name, name_tr=name_tr, region=region, mev=mev, mav=mav, mrv=mrv)


class TestVolumeCandidates:
    def test_a_lightly_trained_muscle_is_below_mev_not_untrained(self) -> None:
        """3 sets/week against an MEV of 8 — worked, but not enough."""
        chest = _muscle(1, "chest", "Göğüs", "upper", mev=8, mav=14, mrv=22)
        current_week = date(2026, 8, 31)
        by_week: _WeekMuscleAggregates = {
            current_week: {1: (3, 3, 5.0, Decimal("300"))},
            current_week - timedelta(weeks=1): {1: (3, 3, 5.0, Decimal("300"))},
            current_week - timedelta(weeks=2): {1: (3, 3, 5.0, Decimal("300"))},
            current_week - timedelta(weeks=3): {1: (3, 3, 5.0, Decimal("300"))},
        }

        candidates = _volume_candidates([chest], by_week, current_week, weeks=4)

        assert len(candidates) == 1
        finding = candidates[0].finding
        assert finding.code == "volume_below_mev"
        assert finding.data == {
            "muscle": "chest",
            "muscle_tr": "Göğüs",
            "avg_sets": 3.0,
            "mev": 8,
            "weeks_below": 4,
            "weeks_total": 4,
        }

    def test_a_never_touched_muscle_is_untrained_not_below_mev(self) -> None:
        """Zero sets needs a different message than 'a few sets short'."""
        chest = _muscle(1, "chest", "Göğüs", "upper", mev=8, mav=14, mrv=22)

        candidates = _volume_candidates(
            [chest], by_week={}, current_week=date(2026, 8, 31), weeks=4
        )

        assert len(candidates) == 1
        finding = candidates[0].finding
        assert finding.code == "muscles_untrained"
        assert finding.data["region"] == "upper"
        assert finding.data["muscles"] == ["Göğüs"]

    def test_untrained_muscles_are_grouped_into_one_finding_per_region(self) -> None:
        """4 untrained lower-body muscles -> 1 finding, not 4."""
        lower = [
            _muscle(1, "quads", "Ön Bacak", "lower", mev=8, mav=14, mrv=22),
            _muscle(2, "hamstrings", "Arka Bacak", "lower", mev=6, mav=12, mrv=20),
            _muscle(3, "glutes", "Kalça", "lower", mev=4, mav=10, mrv=16),
            _muscle(4, "calves", "Baldır", "lower", mev=8, mav=14, mrv=22),
        ]

        candidates = _volume_candidates(lower, by_week={}, current_week=date(2026, 8, 31), weeks=4)

        assert len(candidates) == 1
        finding = candidates[0].finding
        assert finding.code == "muscles_untrained"
        assert finding.data["region"] == "lower"
        assert finding.data["count"] == 4
        assert set(finding.data["muscles"]) == {"Ön Bacak", "Arka Bacak", "Kalça", "Baldır"}

    def test_overtrained_muscle_is_above_mrv(self) -> None:
        chest = _muscle(1, "chest", "Göğüs", "upper", mev=8, mav=14, mrv=22)
        current_week = date(2026, 8, 31)
        by_week: _WeekMuscleAggregates = {
            current_week - timedelta(weeks=i): {1: (25, 25, 5.0, Decimal("0"))} for i in range(4)
        }

        candidates = _volume_candidates([chest], by_week, current_week, weeks=4)

        assert len(candidates) == 1
        finding = candidates[0].finding
        assert finding.code == "volume_above_mrv"
        assert finding.data["avg_sets"] == 25.0
        assert finding.data["mrv"] == 22

    def test_combined_budget_of_three_ranks_by_how_far_off_the_range(self) -> None:
        """4 qualifying candidates go in; only the 3 most critical survive.

        A fully-untrained region (score 1.0) always outranks a muscle that
        was at least touched (score < 1.0), because "never trained" is a
        stronger signal than "a little under MEV".
        """
        groups = [
            _muscle(1, "chest", "Göğüs", "upper", mev=8, mav=14, mrv=22),
            _muscle(2, "quads", "Ön Bacak", "lower", mev=8, mav=14, mrv=22),
            _muscle(3, "hamstrings", "Arka Bacak", "lower", mev=6, mav=12, mrv=20),
            _muscle(4, "abs", "Karın", "core", mev=6, mav=14, mrv=25),
        ]
        current_week = date(2026, 8, 31)
        # Only chest has any direct work; quads, hamstrings and abs are all
        # untrained but land in two different regions (lower, core).
        by_week: _WeekMuscleAggregates = {
            current_week - timedelta(weeks=i): {1: (1, 1, 5.0, Decimal("0"))} for i in range(4)
        }

        candidates = _volume_candidates(groups, by_week, current_week, weeks=4)
        assert len(candidates) == 3  # lower, core, chest — nothing dropped yet

        ranked = sorted(candidates, key=lambda c: c.score, reverse=True)[:3]
        codes = [c.finding.code for c in ranked]
        assert codes.count("muscles_untrained") == 2
        assert "volume_below_mev" in codes


async def _training_history(db: AsyncSession, user: User) -> None:
    await _log_chest_sets(db, user, sets_per_week=1, weeks=4)


async def _log_chest_sets(
    db: AsyncSession, user: User, sets_per_week: int, weeks: int
) -> None:
    exercise = await db.scalar(select(Exercise).where(Exercise.name == "Barbell Bench Press"))
    assert exercise is not None
    now = datetime.now(_ISTANBUL)
    for week in range(weeks):
        workout = Workout(user_id=user.id, performed_at=now - timedelta(weeks=week))
        db.add(workout)
        await db.flush()
        db.add_all(
            [
                Set(
                    workout_id=workout.id,
                    exercise_id=exercise.id,
                    set_number=i + 1,
                    weight_kg=Decimal("100"),
                    reps=8,
                )
                for i in range(sets_per_week)
            ]
        )
    await db.commit()


async def _add_readiness_log(
    db: AsyncSession, user: User, days_ago: int, sleep_hours: str
) -> None:
    log_date = datetime.now(_ISTANBUL).date() - timedelta(days=days_ago)
    db.add(ReadinessLog(user_id=user.id, log_date=log_date, sleep_hours=Decimal(sleep_hours)))
    await db.commit()


async def _add_measurement(
    db: AsyncSession, user: User, days_ago: int, weight_kg: str
) -> None:
    measured_on = datetime.now(_ISTANBUL).date() - timedelta(days=days_ago)
    db.add(BodyMeasurement(user_id=user.id, measured_on=measured_on, weight_kg=Decimal(weight_kg)))
    await db.commit()


async def _get_user(db: AsyncSession, username: str = "efe") -> User:
    user = await db.scalar(select(User).where(User.username == username))
    assert user is not None
    return user


def _findings_by_code(body: dict[str, Any], code: str) -> list[dict[str, Any]]:
    return [f for f in body["findings"] if f["code"] == code]


class TestShape:
    async def test_requires_authentication(self, client: AsyncClient) -> None:
        response = await client.get("/analytics/diagnosis")
        assert response.status_code == 401

    async def test_new_user_has_not_enough_data_and_does_not_crash(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.get("/analytics/diagnosis", headers=auth_headers)

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["has_enough_data"] is False
        assert body["findings"] == []
        assert body["period_weeks"] == 4

    async def test_reports_the_requested_period(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.get("/analytics/diagnosis?weeks=8", headers=auth_headers)
        assert response.json()["period_weeks"] == 8

    async def test_rejects_an_absurd_range(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.get("/analytics/diagnosis?weeks=500", headers=auth_headers)
        assert response.status_code == 422


class TestUntrainedRegionsAndBudget:
    async def test_untouched_legs_produce_one_region_finding_capped_at_three_total(
        self, client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """Legs are never touched; the "lower" region finding must show up,
        and — because this user leaves several other muscles
        untrained too — this also proves the 3-finding cap on
        the volume/region side actually engages rather than just happening
        to stay under it.
        """
        user = await _get_user(db)
        # 1 set/week of chest work for 4 weeks: enough history, legs untouched.
        await _log_chest_sets(db, user, sets_per_week=1, weeks=4)

        response = await client.get("/analytics/diagnosis", headers=auth_headers)

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["has_enough_data"] is True

        volume_codes = {"volume_below_mev", "volume_above_mrv", "muscles_untrained"}
        volume_findings = [f for f in body["findings"] if f["code"] in volume_codes]
        assert len(volume_findings) == 3

        legs = next(f for f in volume_findings if f["data"].get("region") == "lower")
        assert legs["code"] == "muscles_untrained"
        assert legs["data"]["count"] == 4
        assert set(legs["data"]["muscles"]) == {"Ön Bacak", "Arka Bacak", "Kalça", "Baldır"}


class TestReadiness:
    async def test_low_average_sleep_produces_sleep_low(
        self, client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        user = await _get_user(db)
        await _training_history(db, user)
        for days_ago in (1, 3, 5, 7):
            await _add_readiness_log(db, user, days_ago, sleep_hours="6.5")

        body = (await client.get("/analytics/diagnosis", headers=auth_headers)).json()

        finding = _findings_by_code(body, "sleep_low")
        assert len(finding) == 1
        assert finding[0]["severity"] == "warning"
        assert finding[0]["data"] == {
            "avg_hours": 6.5,
            "nights_under_7": 4,
            "nights_total": 4,
        }

    async def test_very_low_average_sleep_is_critical(
        self, client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        user = await _get_user(db)
        await _training_history(db, user)
        for days_ago in (1, 3, 5, 7):
            await _add_readiness_log(db, user, days_ago, sleep_hours="4.0")

        body = (await client.get("/analytics/diagnosis", headers=auth_headers)).json()

        finding = _findings_by_code(body, "sleep_very_low")
        assert len(finding) == 1
        assert finding[0]["severity"] == "critical"

    async def test_fewer_than_three_nights_is_reported_as_no_data(
        self, client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        user = await _get_user(db)
        await _training_history(db, user)
        await _add_readiness_log(db, user, days_ago=1, sleep_hours="5.0")

        body = (await client.get("/analytics/diagnosis", headers=auth_headers)).json()

        finding = _findings_by_code(body, "readiness_no_data")
        assert len(finding) == 1
        assert finding[0]["severity"] == "info"
        assert finding[0]["data"]["nights_total"] == 1
        # Not enough data to call it low, even though 5.0 < 7.
        assert _findings_by_code(body, "sleep_low") == []


class TestWeightTrend:
    async def test_flat_weight_on_a_bulk_goal_is_stalled(
        self, client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        user = await _get_user(db)
        await _training_history(db, user)
        await client.patch("/users/me", headers=auth_headers, json={"nutrition_goal": "bulk"})
        await _add_measurement(db, user, days_ago=25, weight_kg="80.0")
        await _add_measurement(db, user, days_ago=0, weight_kg="80.0")

        body = (await client.get("/analytics/diagnosis", headers=auth_headers)).json()

        finding = _findings_by_code(body, "weight_stalled_bulk")
        assert len(finding) == 1
        assert finding[0]["severity"] == "warning"
        assert finding[0]["data"] == {
            "goal": "bulk",
            "change_kg": 0.0,
            "change_pct": 0.0,
            "weeks": 4,
            "measurement_count": 2,
            "first_measured_on": (datetime.now(_ISTANBUL).date() - timedelta(days=25)).isoformat(),
            "last_measured_on": datetime.now(_ISTANBUL).date().isoformat(),
            "span_days": 25,
            "required_span_days": 14,
            "latest_age_days": 0,
        }

    async def test_rising_weight_on_a_bulk_goal_is_on_track(
        self, client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        user = await _get_user(db)
        await _training_history(db, user)
        await client.patch("/users/me", headers=auth_headers, json={"nutrition_goal": "bulk"})
        await _add_measurement(db, user, days_ago=25, weight_kg="80.0")
        await _add_measurement(db, user, days_ago=0, weight_kg="81.5")

        body = (await client.get("/analytics/diagnosis", headers=auth_headers)).json()

        assert _findings_by_code(body, "weight_stalled_bulk") == []
        finding = _findings_by_code(body, "weight_on_track")
        assert len(finding) == 1
        assert finding[0]["severity"] == "good"

    async def test_without_a_stated_goal_no_weight_finding_is_made(
        self, client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        user = await _get_user(db)
        await _training_history(db, user)
        await _add_measurement(db, user, days_ago=25, weight_kg="80.0")
        await _add_measurement(db, user, days_ago=0, weight_kg="80.0")

        body = (await client.get("/analytics/diagnosis", headers=auth_headers)).json()

        weight_codes = {
            "weight_stalled_bulk",
            "weight_stalled_cut",
            "weight_on_track",
            "weight_no_data",
        }
        assert [f for f in body["findings"] if f["code"] in weight_codes] == []


class TestIsolation:
    async def test_another_users_history_does_not_count_toward_has_enough_data(
        self,
        client: AsyncClient,
        db: AsyncSession,
        auth_headers: dict[str, str],
        other_auth_headers: dict[str, str],
    ) -> None:
        other_user = await _get_user(db, username="intruder")
        await _log_chest_sets(db, other_user, sets_per_week=10, weeks=4)

        body = (await client.get("/analytics/diagnosis", headers=auth_headers)).json()

        assert body["has_enough_data"] is False
        assert body["findings"] == []
