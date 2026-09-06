"""Daily readiness log business logic.

Diagnostic companion to weekly volume analytics: volume answers "did you
train enough", this answers "could you recover". Two decisions carry over
directly from weekly volume:

1. log_date is the user's own local calendar day, computed server-side from
   users.timezone and never accepted from the client — the same reasoning as
   the week boundary: a check-in at 00:30 in Istanbul must not land on
   yesterday just because the server thinks in UTC.

2. Every query filters on user_id, so one account can never read or
   overwrite another's log.
"""

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ValidationAppError
from app.domains.readiness.schemas import (
    ReadinessHistoryQuery,
    ReadinessHistoryResponse,
    ReadinessLogRead,
    ReadinessUpsert,
)
from app.models import MuscleGroup, ReadinessLog, User


def _today_in(timezone: str) -> date:
    """The user's current local calendar day.

    Mirrors `_week_start_in` in the analytics service: `datetime.now(zone)`
    returns the current instant already expressed in that zone, so no
    separate UTC-to-local conversion is needed.
    """
    return datetime.now(ZoneInfo(timezone)).date()


async def _assert_soreness_keys_known(db: AsyncSession, soreness: dict[str, int] | None) -> None:
    """Reject muscle names that do not exist in the catalogue.

    Value range (1-5) is already checked by the schema; this only checks the
    keys, which the schema cannot validate without a database query.
    """
    if not soreness:
        return

    known = set((await db.scalars(select(MuscleGroup.name))).all())
    unknown = set(soreness) - known
    if unknown:
        raise ValidationAppError(
            "Unknown muscle group(s) in soreness: " + ", ".join(sorted(unknown))
        )


def _empty_log(log_date: date) -> ReadinessLogRead:
    """The shape returned when nothing has been submitted for `log_date` yet."""
    return ReadinessLogRead(
        id=None,
        log_date=log_date,
        sleep_hours=None,
        sleep_quality=None,
        energy=None,
        mood=None,
        soreness=None,
        notes=None,
    )


async def get_today(db: AsyncSession, user: User) -> ReadinessLogRead:
    """Today's log, or an empty shell if the user has not answered yet."""
    log_date = _today_in(user.timezone)
    row = await db.scalar(
        select(ReadinessLog).where(
            ReadinessLog.user_id == user.id, ReadinessLog.log_date == log_date
        )
    )
    return ReadinessLogRead.model_validate(row) if row is not None else _empty_log(log_date)


async def upsert_today(db: AsyncSession, user: User, payload: ReadinessUpsert) -> ReadinessLogRead:
    """Create or update today's log.

    A second submission on the same day updates the existing row rather than
    adding another one — the UNIQUE(user_id, log_date) constraint is the
    arbiter for the ON CONFLICT clause below.
    """
    await _assert_soreness_keys_known(db, payload.soreness)
    log_date = _today_in(user.timezone)

    values = payload.model_dump()
    stmt = (
        pg_insert(ReadinessLog)
        .values(user_id=user.id, log_date=log_date, **values)
        .on_conflict_do_update(
            index_elements=[ReadinessLog.user_id, ReadinessLog.log_date],
            set_=values,
        )
        .returning(ReadinessLog)
    )

    row = (await db.execute(stmt)).scalar_one()
    await db.commit()
    return ReadinessLogRead.model_validate(row)


async def list_history(
    db: AsyncSession, user: User, query: ReadinessHistoryQuery
) -> ReadinessHistoryResponse:
    """The last `days` days of logs, newest first. Days with no log are omitted."""
    earliest = _today_in(user.timezone) - timedelta(days=query.days - 1)

    rows = (
        await db.scalars(
            select(ReadinessLog)
            .where(ReadinessLog.user_id == user.id, ReadinessLog.log_date >= earliest)
            .order_by(ReadinessLog.log_date.desc())
        )
    ).all()

    return ReadinessHistoryResponse(items=[ReadinessLogRead.model_validate(r) for r in rows])
