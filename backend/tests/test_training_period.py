"""Completed local weeks, observed history and recorded-work coverage."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domains.analytics import service
from app.models import Exercise, Set, User, Workout

MONDAY = datetime(2026, 9, 6, 21, tzinfo=UTC)  # September 7, 00:00 Istanbul.


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return (MONDAY + timedelta(days=2, hours=12)).astimezone(tz)

    monkeypatch.setattr(service, "datetime", Clock)


async def record(
    db: AsyncSession, week: int, *, sets: int = 1, reps: int = 8,
    warmup: bool = False, username: str = "efe", moment: datetime | None = None,
) -> None:
    user = await db.scalar(select(User).where(User.username == username))
    exercise = await db.scalar(select(Exercise).where(Exercise.name == "Barbell Bench Press"))
    assert user is not None and exercise is not None
    workout = Workout(user_id=user.id,
                      performed_at=moment or MONDAY + timedelta(weeks=week, days=1))
    db.add(workout)
    await db.flush()
    db.add_all([Set(workout_id=workout.id, exercise_id=exercise.id,
                    set_number=n + 1, weight_kg=Decimal("0"), reps=reps, is_warmup=warmup)
                for n in range(sets)])
    await db.commit()


@pytest.mark.parametrize("pattern", ["old", "current", "one_week", "warmup", "zero", "empty"])
async def test_old_history_and_invalid_or_single_week_work_cannot_unlock_period(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str], pattern: str,
) -> None:
    await record(db, -10)
    if pattern == "current":
        await record(db, 0)
    elif pattern == "one_week":
        for _ in range(5):
            await record(db, -1)
    elif pattern in ("warmup", "zero", "empty"):
        await record(db, -2)
        await record(db, -1, warmup=pattern == "warmup",
                     reps=0 if pattern == "zero" else 8, sets=0 if pattern == "empty" else 1)
    body = (await client.get("/analytics/diagnosis", headers=auth_headers)).json()
    assert body["has_enough_data"] is False
    assert body["findings"] == []
    assert body["training_coverage"]["weeks_with_work"] < 2


async def test_short_history_uses_two_full_weeks_and_ignores_partial_first_and_current(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str],
) -> None:
    await record(db, -3, sets=100)
    await record(db, -2, sets=50)
    await record(db, -1, sets=50)
    await record(db, 0, sets=100)
    await record(db, 1, sets=100)
    await record(db, 0, sets=100, moment=MONDAY + timedelta(days=3))
    body = (await client.get("/analytics/diagnosis?weeks=12", headers=auth_headers)).json()
    assert body["has_enough_data"] is True
    assert body["period_weeks"] == 12
    assert body["training_coverage"] == {
        "period_start": "2026-08-24", "period_end": "2026-09-06",
        "completed_weeks": 2, "weeks_with_work": 2, "sessions": 2,
        "required_weeks_with_work": 2,
    }
    chest = next(f for f in body["findings"] if f["code"] == "volume_above_mrv")
    assert chest["data"]["avg_sets"] == 50
    assert chest["data"]["weeks_total"] == 2
    frequency = next(f for f in body["findings"] if f["code"] == "training_infrequent")
    assert frequency["data"]["avg_per_week"] == 1
    # The live weekly screen still includes the ongoing week's real work.
    volume = (await client.get("/analytics/weekly-volume?weeks=1", headers=auth_headers)).json()
    chest_volume = next(m for m in volume["weeks"][0]["muscles"] if m["name"] == "chest")
    assert chest_volume["direct_sets"] == 100


async def test_missing_weeks_remain_in_denominator_and_old_work_stays_outside_window(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str],
) -> None:
    await record(db, -10)
    await record(db, -5)
    await record(db, -4)
    await record(db, -1)
    body = (await client.get("/analytics/diagnosis?weeks=4", headers=auth_headers)).json()
    coverage = body["training_coverage"]
    assert coverage["completed_weeks"] == 4
    assert coverage["sessions"] == coverage["weeks_with_work"] == 2
    finding = next(f for f in body["findings"] if f["code"] == "training_infrequent")
    assert finding["data"]["avg_per_week"] == 0.5


async def test_week_boundary_is_local_and_end_is_exclusive(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str],
) -> None:
    await record(db, -10)
    await record(db, -2)
    await record(db, -1, moment=MONDAY - timedelta(seconds=1))
    await record(db, 0, moment=MONDAY)
    body = (await client.get("/analytics/diagnosis", headers=auth_headers)).json()
    assert body["training_coverage"]["sessions"] == 2
    assert body["training_coverage"]["period_end"] == "2026-09-06"


async def test_other_users_work_does_not_complete_a_missing_week(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str],
    other_auth_headers: dict[str, str],
) -> None:
    await record(db, -10)
    await record(db, -2)
    await record(db, -1, username="intruder")
    body = (await client.get("/analytics/diagnosis", headers=auth_headers)).json()
    assert body["has_enough_data"] is False
    assert body["training_coverage"]["weeks_with_work"] == 1


async def test_one_week_selection_reports_insufficient_coverage(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str],
) -> None:
    await record(db, -10)
    await record(db, -2)
    await record(db, -1)
    body = (await client.get("/analytics/diagnosis?weeks=1", headers=auth_headers)).json()
    assert body["has_enough_data"] is False
    assert body["training_coverage"]["completed_weeks"] == 1


async def test_first_recorded_week_is_not_treated_as_a_full_observation_week(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str],
) -> None:
    await record(db, -2)
    await record(db, -1)
    body = (await client.get("/analytics/diagnosis", headers=auth_headers)).json()
    assert body["has_enough_data"] is False
    assert body["training_coverage"]["completed_weeks"] == 1
