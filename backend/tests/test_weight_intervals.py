"""Weight findings need actual measurement coverage, not just a wide selector."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domains.analytics import service
from app.models import BodyMeasurement, User


async def user_with_weights(
    db: AsyncSession, samples: list[tuple[int, str]], goal: str = "bulk",
    username: str = "efe",
) -> User:
    user = await db.scalar(select(User).where(User.username == username))
    assert user is not None
    user.nutrition_goal = goal
    today = service._today_in(user.timezone)
    for days_ago, weight in samples:
        db.add(BodyMeasurement(user_id=user.id, measured_on=today - timedelta(days=days_ago),
                               weight_kg=Decimal(weight)))
    await db.commit()
    return user


@pytest.mark.parametrize("samples,reason,count,span", [
    ([], "too_few_measurements", 0, 0),
    ([(0, "80")], "too_few_measurements", 1, 0),
    ([(1, "80"), (0, "82")], "short_span", 2, 1),
    ([(13, "80"), (0, "80")], "short_span", 2, 13),
    ([(27, "80"), (8, "82")], "stale_measurements", 2, 19),
])
async def test_insufficient_coverage_has_no_directional_verdict(
    db: AsyncSession, auth_headers: dict[str, str],
    samples: list[tuple[int, str]], reason: str, count: int, span: int,
) -> None:
    user = await user_with_weights(db, samples)
    finding = await service._weight_finding(db, user, 4)
    assert finding is not None
    assert finding.code == "weight_no_data" and finding.severity == "info"
    assert finding.data["reason"] == reason
    assert finding.data["measurement_count"] == count
    assert finding.data["span_days"] == span
    assert "change_pct" not in finding.data


@pytest.mark.parametrize("goal,last,code", [
    ("bulk", "80.4", "weight_on_track"),
    ("bulk", "80.3", "weight_stalled_bulk"),
    ("bulk", "79", "weight_stalled_bulk"),
    ("cut", "79.6", "weight_on_track"),
    ("cut", "79.7", "weight_stalled_cut"),
    ("cut", "81", "weight_stalled_cut"),
])
async def test_direction_uses_unrounded_change_and_real_dates(
    db: AsyncSession, auth_headers: dict[str, str], goal: str, last: str, code: str,
) -> None:
    user = await user_with_weights(db, [(14, "80"), (0, last)], goal)
    today = service._today_in(user.timezone)
    for weeks in (4, 12):
        finding = await service._weight_finding(db, user, weeks)
        assert finding is not None and finding.code == code
        assert finding.data["first_measured_on"] == (today - timedelta(days=14)).isoformat()
        assert finding.data["last_measured_on"] == today.isoformat()
        assert finding.data["span_days"] == 14
        assert finding.data["measurement_count"] == 2
        assert finding.data["latest_age_days"] == 0


async def test_seven_day_old_measurement_is_accepted(
    db: AsyncSession, auth_headers: dict[str, str],
) -> None:
    user = await user_with_weights(db, [(21, "80"), (7, "81")])
    finding = await service._weight_finding(db, user, 4)
    assert finding is not None and finding.code == "weight_on_track"
    assert finding.data["latest_age_days"] == 7


async def test_future_outside_window_and_other_users_measurements_are_excluded(
    db: AsyncSession, auth_headers: dict[str, str], other_auth_headers: dict[str, str],
) -> None:
    user = await user_with_weights(db, [(28, "70"), (27, "80"), (0, "81"), (-1, "100")])
    await user_with_weights(db, [(26, "100"), (0, "110")], username="intruder")
    finding = await service._weight_finding(db, user, 4)
    assert finding is not None and finding.code == "weight_on_track"
    assert finding.data["measurement_count"] == 2
    assert finding.data["span_days"] == 27
    assert finding.data["change_kg"] == 1.0
    short = await service._weight_finding(db, user, 1)
    assert short is not None and short.data["reason"] == "too_few_measurements"


@pytest.mark.parametrize("goal", [None, "maintain"])
async def test_no_directional_goal_produces_no_weight_finding(
    db: AsyncSession, auth_headers: dict[str, str], goal: str | None,
) -> None:
    user = await user_with_weights(db, [(14, "80"), (0, "81")])
    user.nutrition_goal = goal
    assert await service._weight_finding(db, user, 4) is None


async def test_window_uses_users_local_day_at_utc_midnight_boundary(
    db: AsyncSession, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 9, 10, 22, tzinfo=UTC).astimezone(tz)

    monkeypatch.setattr(service, "datetime", Clock)
    user = await user_with_weights(db, [(27, "80"), (0, "81"), (-1, "100")])
    finding = await service._weight_finding(db, user, 4)
    assert finding is not None
    assert finding.data["first_measured_on"] == "2026-08-15"
    assert finding.data["last_measured_on"] == "2026-09-11"
    assert finding.data["measurement_count"] == 2
