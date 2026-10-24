"""A coach reading a connected athlete's completed workouts.

Read-only and deliberately narrow. Every request re-checks, from the database,
that the caller is the coach of an active link whose athlete has switched
sharing on; nothing is remembered between requests, so ending the link or
turning sharing off cuts access immediately.

The athlete is never named by the client. The link id in the path identifies
the athlete, and a workout id only resolves if it belongs to that athlete, so
no id the caller can send reaches anyone else's data. Only the fields the coach
screens draw are returned: no notes, no plan snapshot, no body weight.
"""

from uuid import UUID

from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import ForbiddenError, NotFoundError
from app.domains.coaching.schemas import (
    AthleteExercise,
    AthleteSet,
    AthleteWorkoutDetail,
    AthleteWorkoutList,
    AthleteWorkoutSummary,
)
from app.models import CoachAthleteLink, Set, User, Workout

NOT_SHARING = "This athlete is not sharing workouts with you."


async def _authorise(db: AsyncSession, coach: User, link_id: UUID) -> CoachAthleteLink:
    link = await db.scalar(
        select(CoachAthleteLink).where(
            CoachAthleteLink.id == link_id,
            CoachAthleteLink.coach_id == coach.id,
            CoachAthleteLink.ended_at.is_(None),
        )
    )
    # Someone else's link, an unknown one and an ended one all look the same.
    if link is None:
        raise NotFoundError("Connection not found.")
    if not link.shares_workouts:
        raise ForbiddenError(NOT_SHARING)
    return link


def _completed(athlete_id: UUID) -> tuple[ColumnElement[bool], ColumnElement[bool]]:
    return (Workout.user_id == athlete_id, Workout.finished_at.is_not(None))


async def list_workouts(
    db: AsyncSession, coach: User, link_id: UUID, limit: int, offset: int
) -> AthleteWorkoutList:
    link = await _authorise(db, coach, link_id)
    where = _completed(link.athlete_id)
    total = await db.scalar(select(func.count()).select_from(Workout).where(*where))
    rows = (
        await db.scalars(
            select(Workout)
            .where(*where)
            # id breaks ties so offset paging never repeats or skips a row.
            .order_by(Workout.performed_at.desc(), Workout.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return AthleteWorkoutList(
        items=[AthleteWorkoutSummary.model_validate(row) for row in rows],
        total=total or 0,
        limit=limit,
        offset=offset,
    )


async def get_workout(
    db: AsyncSession, coach: User, link_id: UUID, workout_id: UUID
) -> AthleteWorkoutDetail:
    link = await _authorise(db, coach, link_id)
    workout = await db.scalar(
        select(Workout)
        .where(Workout.id == workout_id, *_completed(link.athlete_id))
        .options(selectinload(Workout.sets).selectinload(Set.exercise))
    )
    if workout is None:
        raise NotFoundError("Workout not found.")

    # Group by exercise in the order the session happened (first set logged).
    exercises: dict[UUID, AthleteExercise] = {}
    for row in sorted(workout.sets, key=lambda item: item.id):
        group = exercises.get(row.exercise_id)
        if group is None:
            group = exercises[row.exercise_id] = AthleteExercise(
                exercise_id=row.exercise_id, name=row.exercise.name, sets=[]
            )
        group.sets.append(
            AthleteSet(
                set_number=row.set_number,
                weight_kg=row.weight_kg,
                reps=row.reps,
                rir=row.rir,
                is_warmup=row.is_warmup,
            )
        )
    summary = AthleteWorkoutSummary.model_validate(workout)
    return AthleteWorkoutDetail(**summary.model_dump(), exercises=list(exercises.values()))
