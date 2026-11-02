"""Per-domain coverage of the diagnosis: what each part of the assessment rests on.

Training, sleep and weight are judged on their own records and their own windows. These
tests pin the five distinct states (sufficient, insufficient, stale, missing,
not_applicable), that a domain with enough records is assessed even when another has
none, and that the reported dates are the dates of records actually found, in the user's
own timezone.
"""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domains.analytics import service
from app.models import BodyMeasurement, Exercise, ReadinessLog, Set, User, Workout

MONDAY = datetime(2026, 9, 6, 21, tzinfo=UTC)  # Monday, September 7, 00:00 in Istanbul.
NOW = MONDAY + timedelta(days=2, hours=12)  # Wednesday, September 9, 12:00 in Istanbul.
TODAY = "2026-09-09"


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):  # type: ignore[no-untyped-def]
            return NOW.astimezone(tz)

    monkeypatch.setattr(service, "datetime", Clock)


async def _user(db: AsyncSession, username: str = "efe") -> User:
    user = await db.scalar(select(User).where(User.username == username))
    assert user is not None
    return user


async def train(
    db: AsyncSession, week: int, *, day: int = 1, sets: int = 1, reps: int = 8,
    warmup: bool = False, weight: str = "0", username: str = "efe",
    moment: datetime | None = None,
) -> None:
    user = await _user(db, username)
    exercise = await db.scalar(select(Exercise).where(Exercise.name == "Barbell Bench Press"))
    assert exercise is not None
    performed_at = moment or MONDAY + timedelta(weeks=week, days=day)
    workout = Workout(user_id=user.id, performed_at=performed_at)
    db.add(workout)
    await db.flush()
    db.add_all([Set(workout_id=workout.id, exercise_id=exercise.id, set_number=n + 1,
                    weight_kg=Decimal(weight), reps=reps, is_warmup=warmup)
                for n in range(sets)])
    await db.commit()


async def sleep(
    db: AsyncSession, ages: list[int], hours: str | None = "7", username: str = "efe"
) -> None:
    user = await _user(db, username)
    today = service._today_in(user.timezone)
    db.add_all([ReadinessLog(user_id=user.id, log_date=today - timedelta(days=age),
                             sleep_hours=Decimal(hours) if hours is not None else None)
                for age in ages])
    await db.commit()


async def weigh(
    db: AsyncSession, samples: list[tuple[int, str]], goal: str | None = "bulk",
    username: str = "efe",
) -> None:
    user = await _user(db, username)
    user.nutrition_goal = goal
    today = service._today_in(user.timezone)
    db.add_all([BodyMeasurement(user_id=user.id, measured_on=today - timedelta(days=age),
                                weight_kg=Decimal(weight)) for age, weight in samples])
    await db.commit()


async def diagnose(client: AsyncClient, headers: dict[str, str], weeks: int = 4) -> dict[str, Any]:
    response = await client.get(f"/analytics/diagnosis?weeks={weeks}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()  # type: ignore[no-any-return]


def codes(body: dict[str, Any]) -> list[str]:
    return [finding["code"] for finding in body["findings"]]


# ── a new user: every domain is explicit about what is missing ──────────────────────

async def test_new_user_every_domain_says_what_is_missing_not_what_happened(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    body = await diagnose(client, auth_headers)

    assert body["today"] == TODAY and body["timezone"] == "Europe/Istanbul"
    assert body["domains"]["training"] == {
        "state": "missing", "reason": "no_working_sets", "period_start": None,
        "period_end": None, "record_count": 0, "first_recorded_on": None,
        "last_recorded_on": None, "latest_age_days": None,
    }
    assert body["domains"]["sleep"]["state"] == "missing"
    assert body["domains"]["sleep"]["reason"] == "no_sleep_records"
    assert body["domains"]["sleep"]["record_count"] == 0
    assert body["domains"]["weight"]["state"] == "not_applicable"
    assert body["domains"]["weight"]["reason"] == "no_goal"
    assert body["has_enough_data"] is False
    # No record is not a verdict: nothing about training, sleep quantity or weight direction.
    assert codes(body) == ["readiness_no_data"]


# ── training states ─────────────────────────────────────────────────────────────

async def test_only_the_unfinished_current_week_is_insufficient_not_missing(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
) -> None:
    await train(db, 0)
    domain = (await diagnose(client, auth_headers))["domains"]["training"]
    assert domain["state"] == "insufficient" and domain["reason"] == "no_completed_week"
    assert domain["period_start"] is None and domain["period_end"] is None


async def test_old_records_outside_the_window_leave_the_period_missing(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
) -> None:
    await train(db, -10)
    domain = (await diagnose(client, auth_headers))["domains"]["training"]
    assert domain["state"] == "missing" and domain["reason"] == "no_working_sets"
    assert domain["record_count"] == 0


@pytest.mark.parametrize("kind", ["warmup", "zero_reps"])
async def test_warmups_and_zero_rep_rows_do_not_count_as_training(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str], kind: str
) -> None:
    await train(db, -10)
    await train(db, -2, warmup=kind == "warmup", reps=0 if kind == "zero_reps" else 8)
    await train(db, -1, warmup=kind == "warmup", reps=0 if kind == "zero_reps" else 8)
    domain = (await diagnose(client, auth_headers))["domains"]["training"]
    assert domain["state"] == "missing" and domain["record_count"] == 0


async def test_one_week_with_work_is_insufficient(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
) -> None:
    await train(db, -10)
    for _ in range(4):
        await train(db, -1)
    body = await diagnose(client, auth_headers)
    domain = body["domains"]["training"]
    assert domain["state"] == "insufficient" and domain["reason"] == "too_few_weeks_with_work"
    assert domain["record_count"] == 4
    assert body["has_enough_data"] is False
    assert not {"volume_below_mev", "volume_above_mrv", "muscles_untrained",
                "training_infrequent", "training_consistent"} & set(codes(body))


async def test_sufficient_training_reports_the_dates_of_the_recorded_sessions(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
) -> None:
    await train(db, -10)
    await train(db, -2, day=2)   # Wednesday, August 26.
    await train(db, -1, day=4)   # Friday, September 4.
    body = await diagnose(client, auth_headers)
    domain = body["domains"]["training"]
    assert domain["state"] == "sufficient" and domain["reason"] is None
    assert domain["first_recorded_on"] == "2026-08-26"
    assert domain["last_recorded_on"] == "2026-09-04"
    assert domain["record_count"] == 2
    assert (domain["period_start"], domain["period_end"]) == (
        body["training_coverage"]["period_start"], body["training_coverage"]["period_end"])
    assert body["has_enough_data"] is True


async def test_zero_kilogram_working_sets_count_as_training(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
) -> None:
    await train(db, -10)
    await train(db, -2, weight="0")
    await train(db, -1, weight="0")
    domain = (await diagnose(client, auth_headers))["domains"]["training"]
    assert domain["state"] == "sufficient"


async def test_a_session_just_after_local_midnight_belongs_to_the_local_week(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
) -> None:
    """Monday 01:00 in Istanbul is still Sunday 22:00 UTC: it must open the new week,
    not close the previous one, so it is outside the completed weeks ending Sunday."""
    await train(db, -10)
    await train(db, -2)
    await train(db, -1)
    await train(db, 0, moment=datetime(2026, 9, 6, 22, tzinfo=UTC))  # Mon Sep 7 01:00 local.
    domain = (await diagnose(client, auth_headers))["domains"]["training"]
    assert domain["record_count"] == 2
    assert domain["last_recorded_on"] == "2026-09-01"
    assert domain["period_end"] == "2026-09-06"


# ── sleep states ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("ages,state,reason", [
    ([], "missing", "no_sleep_records"),
    ([0, 1], "insufficient", "too_few_nights"),
    ([8, 9, 10], "stale", "stale_records"),
    ([7, 8, 9], "sufficient", None),
    ([0, 1, 2], "sufficient", None),
])
async def test_sleep_states(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str],
    ages: list[int], state: str, reason: str | None,
) -> None:
    await sleep(db, ages)
    domain = (await diagnose(client, auth_headers))["domains"]["sleep"]
    assert domain["state"] == state and domain["reason"] == reason
    assert domain["record_count"] == len(ages)
    assert domain["period_end"] == TODAY
    assert domain["period_start"] == "2026-08-13"
    if ages:
        assert domain["latest_age_days"] == min(ages)
        today = date(2026, 9, 9)
        assert domain["last_recorded_on"] == (today - timedelta(days=min(ages))).isoformat()
        assert domain["first_recorded_on"] == (today - timedelta(days=max(ages))).isoformat()


async def test_missing_sleep_records_are_never_zero_hours(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
) -> None:
    await sleep(db, [0, 1, 2], hours=None)   # Check-ins that left sleep blank.
    body = await diagnose(client, auth_headers)
    assert body["domains"]["sleep"]["state"] == "missing"
    assert "sleep_low" not in codes(body) and "sleep_very_low" not in codes(body)


async def test_zero_hours_recorded_is_a_recorded_value(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
) -> None:
    await sleep(db, [0, 1, 2], hours="0")
    body = await diagnose(client, auth_headers)
    assert body["domains"]["sleep"]["state"] == "sufficient"
    assert "sleep_very_low" in codes(body)


async def test_sleep_window_follows_the_selected_period(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
) -> None:
    await sleep(db, [40, 41, 42])
    four = (await diagnose(client, auth_headers, 4))["domains"]["sleep"]
    twelve = (await diagnose(client, auth_headers, 12))["domains"]["sleep"]
    assert four["state"] == "missing" and four["period_start"] == "2026-08-13"
    assert twelve["state"] == "stale" and twelve["period_start"] == "2026-06-18"


# ── weight states and goal applicability ─────────────────────────────────────────

@pytest.mark.parametrize("goal,reason", [(None, "no_goal"), ("maintain", "goal_maintain")])
async def test_without_a_directional_goal_weight_is_not_applicable_but_records_are_reported(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str],
    goal: str | None, reason: str,
) -> None:
    await weigh(db, [(20, "80"), (0, "83")], goal=goal)
    body = await diagnose(client, auth_headers)
    domain = body["domains"]["weight"]
    assert domain["state"] == "not_applicable" and domain["reason"] == reason
    assert domain["record_count"] == 2
    assert domain["first_recorded_on"] == "2026-08-20" and domain["last_recorded_on"] == TODAY
    assert not {"weight_no_data", "weight_on_track", "weight_stalled_bulk",
                "weight_stalled_cut"} & set(codes(body))


@pytest.mark.parametrize("samples,state,reason", [
    ([], "missing", "no_measurements"),
    ([(0, "80")], "insufficient", "too_few_measurements"),
    ([(5, "80"), (0, "80")], "insufficient", "short_span"),
    ([(27, "80"), (8, "82")], "stale", "stale_measurements"),
    ([(20, "80"), (0, "82")], "sufficient", None),
    ([(21, "80"), (7, "82")], "sufficient", None),
])
async def test_weight_states_with_a_goal(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str],
    samples: list[tuple[int, str]], state: str, reason: str | None,
) -> None:
    await weigh(db, samples)
    domain = (await diagnose(client, auth_headers))["domains"]["weight"]
    assert domain["state"] == state and domain["reason"] == reason
    assert domain["record_count"] == len(samples)


# ── independence: a sufficient domain is assessed although another is empty ────────

async def test_sleep_findings_are_returned_while_training_is_insufficient(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
) -> None:
    await sleep(db, [0, 1, 2], hours="5")
    body = await diagnose(client, auth_headers)
    assert body["has_enough_data"] is False
    assert body["domains"]["training"]["state"] == "missing"
    assert body["domains"]["sleep"]["state"] == "sufficient"
    assert codes(body) == ["sleep_very_low"]


async def test_weight_findings_are_returned_while_training_and_sleep_are_empty(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
) -> None:
    await weigh(db, [(20, "80"), (0, "80")], goal="bulk")
    body = await diagnose(client, auth_headers)
    assert codes(body) == ["readiness_no_data", "weight_stalled_bulk"]
    assert body["domains"]["weight"]["state"] == "sufficient"
    assert body["domains"]["sleep"]["state"] == "missing"


async def test_training_findings_do_not_depend_on_sleep_or_weight_records(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
) -> None:
    await train(db, -10)
    await train(db, -2)
    await train(db, -1)
    body = await diagnose(client, auth_headers)
    assert body["domains"]["training"]["state"] == "sufficient"
    assert body["domains"]["sleep"]["state"] == "missing"
    assert "training_infrequent" in codes(body) and "readiness_no_data" in codes(body)


async def test_the_domains_use_their_own_windows(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
) -> None:
    await train(db, -10)
    await train(db, -2)
    await train(db, -1)
    await sleep(db, [0, 1, 2])
    domains = (await diagnose(client, auth_headers))["domains"]
    # Training ends with the last completed local week (Sunday); sleep runs through today.
    assert domains["training"]["period_end"] == "2026-09-06"
    assert domains["sleep"]["period_end"] == TODAY


async def test_another_users_records_never_count_toward_any_domain(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str],
    other_auth_headers: dict[str, str],
) -> None:
    await train(db, -10, username="intruder")
    await train(db, -2, username="intruder")
    await train(db, -1, username="intruder")
    await sleep(db, [0, 1, 2], username="intruder")
    await weigh(db, [(20, "80"), (0, "82")], username="intruder")
    domains = (await diagnose(client, auth_headers))["domains"]
    assert domains["training"]["record_count"] == 0
    assert domains["sleep"]["record_count"] == 0
    assert domains["weight"]["record_count"] == 0


async def test_the_selected_period_is_echoed_and_changes_the_windows(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
) -> None:
    await train(db, -10)
    # The first recorded week is partial and excluded, so 12 weeks starts after it.
    for weeks, start in ((4, "2026-08-10"), (8, "2026-07-13"), (12, "2026-07-06")):
        body = await diagnose(client, auth_headers, weeks)
        assert body["period_weeks"] == weeks
        assert body["domains"]["training"]["period_start"] == start


async def test_weight_findings_make_no_muscle_or_cause_claims(
    client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
) -> None:
    await weigh(db, [(20, "80"), (0, "83")], goal="bulk")
    finding = next(f for f in (await diagnose(client, auth_headers))["findings"]
                   if f["code"].startswith("weight_"))
    text = " ".join(map(str, finding["data"].keys()))
    assert not {"muscle", "lean", "cause", "growth"} & set(text.split())
