"""Sleep findings describe sampled nights and reject stale or future records."""

from datetime import timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domains.analytics import service
from app.models import ReadinessLog, User


async def seed(
    db: AsyncSession, samples: list[tuple[int, str | None]], username: str = "efe",
) -> User:
    user = await db.scalar(select(User).where(User.username == username))
    assert user is not None
    today = service._today_in(user.timezone)
    for days, hours in samples:
        db.add(ReadinessLog(user_id=user.id, log_date=today - timedelta(days=days),
                            sleep_hours=Decimal(hours) if hours is not None else None))
    await db.commit()
    return user


@pytest.mark.parametrize("days,reason", [([], "too_few_nights"), ([0, 1], "too_few_nights"),
                                         ([8, 9, 10], "stale_records")])
async def test_insufficient_and_stale_sleep_do_not_produce_low_sleep_verdict(
    db: AsyncSession, auth_headers: dict[str, str], days: list[int], reason: str,
) -> None:
    user = await seed(db, [(day, "4") for day in days])
    finding = await service._readiness_finding(db, user, 4)
    assert finding is not None and finding.code == "readiness_no_data"
    assert finding.data["reason"] == reason
    assert finding.data["nights_total"] == len(days)
    assert "avg_hours" not in finding.data


@pytest.mark.parametrize("hours,code", [("5.9", "sleep_very_low"), ("6", "sleep_low"),
                                       ("6.9", "sleep_low"), ("7", None)])
async def test_sample_average_preserves_thresholds_and_reports_coverage(
    db: AsyncSession, auth_headers: dict[str, str], hours: str, code: str | None,
) -> None:
    user = await seed(db, [(0, hours), (1, hours), (2, hours)])
    for weeks in (4, 12):
        finding = await service._readiness_finding(db, user, weeks)
        if code is None:
            assert finding is None
        else:
            assert finding is not None and finding.code == code
            assert finding.data["avg_hours"] == float(hours)
            assert finding.data["nights_total"] == 3
            assert finding.data["days_total"] == weeks * 7


async def test_null_future_outside_window_and_other_users_records_are_excluded(
    db: AsyncSession, auth_headers: dict[str, str], other_auth_headers: dict[str, str],
) -> None:
    user = await seed(db, [(28, "1"), (27, "6"), (7, "6"), (0, "6"), (-1, "1"), (1, None)])
    await seed(db, [(2, "1"), (3, "1")], "intruder")
    finding = await service._readiness_finding(db, user, 4)
    assert finding is not None and finding.code == "sleep_low"
    assert finding.data["avg_hours"] == 6
    assert finding.data["nights_total"] == 3
    assert finding.data["latest_age_days"] == 0
    assert finding.data["last_logged_on"] == service._today_in(user.timezone).isoformat()


async def test_seven_day_recency_boundary_is_accepted(
    db: AsyncSession, auth_headers: dict[str, str],
) -> None:
    user = await seed(db, [(7, "6"), (8, "6"), (9, "6")])
    finding = await service._readiness_finding(db, user, 4)
    assert finding is not None and finding.code == "sleep_low"
    assert finding.data["latest_age_days"] == 7
