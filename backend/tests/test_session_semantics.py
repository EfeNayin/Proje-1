"""Recorded work defines participation; closure source defines duration reliability."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Exercise, Set, User, Workout


async def log_session(
    db: AsyncSession, *, days_ago: int, reps: int | None, warmup: bool = False,
    finished: bool = False, set_count: int = 1, username: str = "efe",
) -> Workout:
    user = await db.scalar(select(User).where(User.username == username))
    exercise = await db.scalar(select(Exercise).where(Exercise.name == "Barbell Bench Press"))
    assert user is not None and exercise is not None
    performed_at = datetime.now(UTC) - timedelta(days=days_ago)
    workout = Workout(user_id=user.id, performed_at=performed_at,
                      finished_at=performed_at if finished else None)
    db.add(workout)
    await db.flush()
    if reps is not None:
        for number in range(set_count):
            db.add(Set(workout_id=workout.id, exercise_id=exercise.id, set_number=number + 1,
                       weight_kg=Decimal("0"), reps=reps, is_warmup=warmup))
    await db.commit()
    return workout


@pytest.mark.parametrize("reps,warmup", [(None, False), (0, False), (8, True)])
@pytest.mark.parametrize("finished", [False, True])
async def test_empty_warmup_and_zero_rep_history_does_not_unlock_diagnosis(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str],
    reps: int | None, warmup: bool, finished: bool,
) -> None:
    await log_session(db, days_ago=30, reps=reps, warmup=warmup, finished=finished)
    response = await client.get("/analytics/diagnosis", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["has_enough_data"] is False


@pytest.mark.parametrize("finished", [False, True])
async def test_work_counts_once_even_with_many_sets_and_without_finishing(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str], finished: bool,
) -> None:
    await log_session(db, days_ago=40, reps=8)
    await log_session(db, days_ago=14, reps=8)
    await log_session(db, days_ago=7, reps=8, set_count=4, finished=finished)
    await log_session(db, days_ago=0, reps=8, finished=finished, set_count=4)
    # Twelve invalid records used to generate a false consistency celebration.
    for _ in range(4):
        await log_session(db, days_ago=7, reps=None, finished=True)
        await log_session(db, days_ago=7, reps=8, warmup=True)
        await log_session(db, days_ago=7, reps=0)
    response = await client.get("/analytics/diagnosis", headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["has_enough_data"] is True
    finding = next(f for f in body["findings"] if f["code"] == "training_infrequent")
    assert finding["data"]["avg_per_week"] == 0.5  # Two real sessions across four completed weeks.
    assert not any(f["code"] == "training_consistent" for f in body["findings"])
    volume = (await client.get("/analytics/weekly-volume?weeks=1", headers=auth_headers)).json()
    chest = next(m for m in volume["weeks"][0]["muscles"] if m["name"] == "chest")
    assert chest["direct_sets"] == 4


async def test_other_users_work_cannot_make_an_empty_session_count(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str],
    other_auth_headers: dict[str, str],
) -> None:
    await log_session(db, days_ago=40, reps=8)
    await log_session(db, days_ago=14, reps=8)
    await log_session(db, days_ago=7, reps=8, set_count=4)
    await log_session(db, days_ago=7, reps=None)
    await log_session(db, days_ago=7, reps=8, username="intruder")
    body = (await client.get("/analytics/diagnosis", headers=auth_headers)).json()
    finding = next(f for f in body["findings"] if f["code"] == "training_infrequent")
    assert finding["data"]["avg_per_week"] == 0.5


async def test_explicit_finish_records_source_and_preserves_it_on_retry(
    client: AsyncClient, auth_headers: dict[str, str],
) -> None:
    workout = (await client.post("/workouts", headers=auth_headers, json={})).json()
    assert workout["finished_automatically"] is None
    first = (await client.post(f"/workouts/{workout['id']}/finish", headers=auth_headers)).json()
    second = (await client.post(f"/workouts/{workout['id']}/finish", headers=auth_headers)).json()
    assert first["finished_automatically"] is False
    assert second["finished_automatically"] is False
    assert first["finished_at"] == second["finished_at"]


async def test_auto_closure_is_identified_in_detail_and_history_and_not_reclassified(
    client: AsyncClient, auth_headers: dict[str, str],
) -> None:
    old = (await client.post("/workouts", headers=auth_headers, json={})).json()
    await client.post("/workouts", headers=auth_headers, json={})
    detail = (await client.get(f"/workouts/{old['id']}", headers=auth_headers)).json()
    assert detail["finished_automatically"] is True
    history = (await client.get("/workouts", headers=auth_headers)).json()
    old_summary = next(w for w in history["items"] if w["id"] == old["id"])
    assert old_summary["finished_automatically"] is True
    retried = (await client.post(f"/workouts/{old['id']}/finish", headers=auth_headers)).json()
    assert retried["finished_automatically"] is True
    assert retried["finished_at"] == detail["finished_at"]


async def test_legacy_finished_session_keeps_unknown_source(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str],
) -> None:
    old = await log_session(db, days_ago=30, reps=8, finished=True)
    detail = (await client.post(f"/workouts/{old.id}/finish", headers=auth_headers)).json()
    assert detail["finished_automatically"] is None
