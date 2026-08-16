"""Weekly training volume against hypertrophy landmarks.

The core feature. Two decisions shape everything here:

1. Weeks are cut in the user's own timezone. performed_at is stored in UTC,
   so a session at 01:00 Monday in Istanbul is 22:00 Sunday UTC and would
   land in the previous week if the boundary were computed in UTC.

2. Only *direct* sets count toward the landmarks. MEV/MAV/MRV as published by
   Renaissance Periodization refer to direct work for a muscle; the indirect
   stimulus from compound pressing and pulling is already folded into those
   numbers. Counting assistance work again would inflate every total and
   push users into false "over MRV" territory.
"""

from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domains.analytics.schemas import (
    MuscleWeeklyVolume,
    VolumeStatus,
    WeeklyVolume,
    WeeklyVolumeQuery,
    WeeklyVolumeResponse,
)
from app.models import ExerciseMuscleGroup, MuscleGroup, Set, User, Workout

_PRIMARY = "primary"


def _classify(direct_sets: int, mev: int | None, mav: int | None, mrv: int | None) -> VolumeStatus:
    """Place a week's direct set count against the landmarks.

    "untrained" is kept separate from "below_mev" because zero sets and a few
    sets need different nudges in the UI: one is "you skipped this muscle",
    the other is "you are close, add a couple".
    """
    if direct_sets == 0:
        return "untrained"
    if mev is None or mav is None or mrv is None:
        # No published landmark for this muscle; report the count without a
        # verdict rather than inventing one.
        return "optimal"
    if direct_sets < mev:
        return "below_mev"
    if direct_sets <= mav:
        return "optimal"
    if direct_sets <= mrv:
        return "high"
    return "above_mrv"


def _week_start_in(timezone: str, moment: datetime | None = None) -> date:
    """The Monday of the week containing `moment`, in the given timezone.

    date_trunc('week') in PostgreSQL is ISO 8601 and always starts on Monday,
    so this matches what the query produces.
    """
    zone = ZoneInfo(timezone)
    local = (moment or datetime.now(zone)).astimezone(zone)
    return (local - timedelta(days=local.weekday())).date()


async def weekly_volume(
    db: AsyncSession, user: User, query: WeeklyVolumeQuery
) -> WeeklyVolumeResponse:
    """Per-muscle volume for the last N weeks, newest first."""
    current_week = _week_start_in(user.timezone)
    earliest_week = current_week - timedelta(weeks=query.weeks - 1)

    # AT TIME ZONE in function form: converts the stored UTC instant into the
    # user's wall clock, so date_trunc cuts the week where they experienced it.
    local_time = func.timezone(user.timezone, Workout.performed_at)
    week_start = func.date_trunc("week", local_time).cast(Set.created_at.type).label("week_start")

    is_direct = ExerciseMuscleGroup.role == _PRIMARY

    stmt = (
        select(
            week_start,
            ExerciseMuscleGroup.muscle_group_id,
            func.count().filter(is_direct).label("direct_sets"),
            func.count().label("involved_sets"),
            func.avg(ExerciseMuscleGroup.effectiveness)
            .filter(is_direct)
            .label("avg_effectiveness"),
            func.coalesce(
                func.sum(Set.weight_kg * Set.reps).filter(is_direct), 0
            ).label("volume_kg"),
        )
        .select_from(Set)
        .join(Workout, Workout.id == Set.workout_id)
        .join(ExerciseMuscleGroup, ExerciseMuscleGroup.exercise_id == Set.exercise_id)
        .where(
            Workout.user_id == user.id,
            # Warmups would inflate every count and trigger false "over MRV".
            Set.is_warmup.is_(False),
            func.date_trunc("week", local_time) >= earliest_week,
        )
        .group_by(week_start, ExerciseMuscleGroup.muscle_group_id)
    )

    rows = (await db.execute(stmt)).all()

    # (week_start, muscle_group_id) -> aggregates
    by_week: dict[date, dict[int, tuple[int, int, float | None, Decimal]]] = {}
    for row in rows:
        bucket = by_week.setdefault(row.week_start.date(), {})
        bucket[row.muscle_group_id] = (
            row.direct_sets,
            row.involved_sets,
            float(row.avg_effectiveness) if row.avg_effectiveness is not None else None,
            Decimal(row.volume_kg).quantize(Decimal("0.01")),
        )

    muscle_groups = (
        await db.scalars(select(MuscleGroup).order_by(MuscleGroup.region, MuscleGroup.name))
    ).all()

    weeks: list[WeeklyVolume] = []
    for offset in range(query.weeks):
        start = current_week - timedelta(weeks=offset)
        found = by_week.get(start, {})

        muscles = []
        for group in muscle_groups:
            direct, involved, effectiveness, volume = found.get(
                group.id, (0, 0, None, Decimal("0.00"))
            )
            muscles.append(
                MuscleWeeklyVolume(
                    muscle_group_id=group.id,
                    name=group.name,
                    name_tr=group.name_tr,
                    region=group.region,
                    direct_sets=direct,
                    involved_sets=involved,
                    avg_effectiveness=round(effectiveness, 2)
                    if effectiveness is not None
                    else None,
                    volume_kg=volume,
                    mev=group.mev,
                    mav=group.mav,
                    mrv=group.mrv,
                    status=_classify(direct, group.mev, group.mav, group.mrv),
                )
            )

        weeks.append(WeeklyVolume(week_start=start, muscles=muscles))

    return WeeklyVolumeResponse(weeks=weeks, timezone=user.timezone)