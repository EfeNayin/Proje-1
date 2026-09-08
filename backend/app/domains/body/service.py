"""Body measurement business logic.

Mirrors app.domains.readiness.service: measured_on is the user's own local
calendar day, computed server-side from users.timezone and never accepted
from the client, for the same reason weekly volume cuts its week boundary
that way — a weigh-in at 00:30 in Istanbul must not land on yesterday just
because the server thinks in UTC. Every query also filters on user_id, so
one account can never read, overwrite, or delete another's measurements.
"""

from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.domains.body.schemas import (
    BodyMeasurementHistoryResponse,
    BodyMeasurementQuery,
    BodyMeasurementRead,
    BodyMeasurementUpsert,
    BodySummary,
)
from app.models import BodyMeasurement, User


def _today_in(timezone: str) -> date:
    """The user's current local calendar day. Mirrors readiness._today_in."""
    return datetime.now(ZoneInfo(timezone)).date()


async def upsert_today(
    db: AsyncSession, user: User, payload: BodyMeasurementUpsert
) -> BodyMeasurementRead:
    """Create or update today's weigh-in.

    A second submission on the same day updates the existing row rather than
    adding another one — UNIQUE(user_id, measured_on) is the arbiter for the
    ON CONFLICT clause below.
    """
    measured_on = _today_in(user.timezone)

    values = payload.model_dump()
    stmt = (
        pg_insert(BodyMeasurement)
        .values(user_id=user.id, measured_on=measured_on, **values)
        .on_conflict_do_update(
            index_elements=[BodyMeasurement.user_id, BodyMeasurement.measured_on],
            set_=values,
        )
        .returning(BodyMeasurement)
    )

    row = (await db.execute(stmt)).scalar_one()
    await db.commit()
    return BodyMeasurementRead.model_validate(row)


async def list_history(
    db: AsyncSession, user: User, query: BodyMeasurementQuery
) -> BodyMeasurementHistoryResponse:
    """The user's most recent measurements, newest first."""
    rows = (
        await db.scalars(
            select(BodyMeasurement)
            .where(BodyMeasurement.user_id == user.id)
            .order_by(BodyMeasurement.measured_on.desc())
            .limit(query.limit)
        )
    ).all()

    return BodyMeasurementHistoryResponse(
        items=[BodyMeasurementRead.model_validate(r) for r in rows]
    )


async def delete_measurement(db: AsyncSession, user: User, measurement_id: int) -> None:
    """Remove a wrongly-entered weigh-in.

    A measurement owned by someone else reports 404 rather than 403: telling
    the caller "this exists but is not yours" would leak which ids are real.
    """
    row = await db.scalar(
        select(BodyMeasurement).where(
            BodyMeasurement.id == measurement_id, BodyMeasurement.user_id == user.id
        )
    )
    if row is None:
        raise NotFoundError("Measurement not found")

    await db.delete(row)
    await db.commit()


async def get_summary(db: AsyncSession, user: User) -> BodySummary:
    """Current weight, last weigh-in date, and the change since the first
    ever recorded measurement. All None when there is no history yet."""
    first = await db.scalar(
        select(BodyMeasurement)
        .where(BodyMeasurement.user_id == user.id)
        .order_by(BodyMeasurement.measured_on.asc())
        .limit(1)
    )
    if first is None:
        return BodySummary(
            current_weight_kg=None,
            last_measured_on=None,
            first_weight_kg=None,
            first_measured_on=None,
            change_kg=None,
        )

    last = await db.scalar(
        select(BodyMeasurement)
        .where(BodyMeasurement.user_id == user.id)
        .order_by(BodyMeasurement.measured_on.desc())
        .limit(1)
    )
    assert last is not None  # at least `first` itself exists

    return BodySummary(
        current_weight_kg=last.weight_kg,
        last_measured_on=last.measured_on,
        first_weight_kg=first.weight_kg,
        first_measured_on=first.measured_on,
        change_kg=last.weight_kg - first.weight_kg,
    )
