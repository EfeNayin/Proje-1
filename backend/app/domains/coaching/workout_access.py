"""A coach reading a connected athlete's completed workouts.

Read-only and deliberately narrow. Every request re-checks, from the database,
that the caller is the coach of an active link whose athlete has switched
sharing on; nothing is remembered between requests, so ending the link or
turning sharing off cuts access immediately.

The athlete is never named by the client. The link id in the path identifies
the athlete, and a workout id only resolves if it belongs to that athlete, so
no id the caller can send reaches anyone else's data. Only the fields the coach
screens draw are returned: no notes, no plan snapshot, no body weight.

The exercise history reuses the athlete's own history query (see
`earlier_exercise_sessions`) after this module has authorised the request.
"""

import base64
import binascii
from datetime import datetime
from uuid import UUID

from sqlalchemy import ColumnElement, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import ForbiddenError, NotFoundError, ValidationAppError
from app.domains.coaching.schemas import (
    AthleteExercise,
    AthleteExerciseHistoryCursor,
    AthleteExerciseHistoryPage,
    AthleteExerciseSession,
    AthleteSet,
    AthleteWorkoutDetail,
    AthleteWorkoutList,
    AthleteWorkoutSummary,
)
from app.domains.workouts.schemas import ExerciseHistoryQuery
from app.domains.workouts.service import earlier_exercise_sessions
from app.models import CoachAthleteLink, Set, User, Workout

NOT_SHARING = "This athlete is not sharing workouts with you."


async def _authorise(
    db: AsyncSession, coach: User, link_id: UUID, *, lock: bool = False
) -> CoachAthleteLink:
    """The coach's active, sharing link, or 404/403.

    `lock=True` takes the same row lock that ending the link and switching
    sharing off take, so a write that authorised here commits before either
    of them can proceed (and one that arrives after them is refused).
    """
    statement = select(CoachAthleteLink).where(
        CoachAthleteLink.id == link_id,
        CoachAthleteLink.coach_id == coach.id,
        CoachAthleteLink.ended_at.is_(None),
    )
    if lock:
        statement = statement.with_for_update()
    link = await db.scalar(statement)
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


def _decode_cursor(
    raw: str, link_id: UUID, anchor_id: UUID, exercise_id: UUID
) -> tuple[datetime, UUID]:
    """The position in a continuation token, if it was cut for exactly this request."""
    try:
        cursor = AthleteExerciseHistoryCursor.model_validate_json(
            base64.b64decode(raw, altchars=b"-_", validate=True)
        )
    except (ValueError, binascii.Error) as exc:
        raise ValidationAppError("Invalid exercise history cursor") from exc
    # A token from another connection, workout or exercise is not a bookmark here.
    if (cursor.link_id, cursor.anchor_workout_id, cursor.exercise_id) != (
        link_id,
        anchor_id,
        exercise_id,
    ):
        raise ValidationAppError("Invalid exercise history cursor")
    return cursor.performed_at, cursor.session_id


async def get_exercise_history(
    db: AsyncSession,
    coach: User,
    link_id: UUID,
    workout_id: UUID,
    exercise_id: UUID,
    query: ExerciseHistoryQuery,
) -> AthleteExerciseHistoryPage:
    """Earlier completed sessions of one exercise, opened from a shared workout.

    Checked on every request, in this order: the coach's active, sharing link;
    then that the anchor workout is the linked athlete's, completed, and has a
    set of this very exercise (warm-ups count here: it is the workout the coach
    is looking at). The sessions are the athlete's only, strictly earlier than
    the anchor, so the anchor itself never appears.
    """
    link = await _authorise(db, coach, link_id)
    anchor = await db.scalar(
        select(Workout).where(Workout.id == workout_id, *_completed(link.athlete_id))
    )
    if anchor is None:
        raise NotFoundError("Workout not found.")
    in_anchor = await db.scalar(
        select(
            select(Set.id)
            .where(Set.workout_id == anchor.id, Set.exercise_id == exercise_id)
            .exists()
        )
    )
    if not in_anchor:
        raise NotFoundError("Exercise not found in this workout.")

    after = (
        _decode_cursor(query.cursor, link.id, anchor.id, exercise_id)
        if query.cursor is not None
        else None
    )
    sessions, has_more = await earlier_exercise_sessions(
        db,
        link.athlete_id,
        exercise_id,
        before=anchor.performed_at,
        after=after,
        limit=query.limit,
    )
    next_cursor = None
    if has_more:
        last = sessions[-1][0]
        next_cursor = base64.urlsafe_b64encode(
            AthleteExerciseHistoryCursor(
                performed_at=last.performed_at,
                session_id=last.id,
                link_id=link.id,
                anchor_workout_id=anchor.id,
                exercise_id=exercise_id,
            )
            .model_dump_json()
            .encode()
        ).decode()
    return AthleteExerciseHistoryPage(
        items=[
            AthleteExerciseSession(
                workout_id=workout.id,
                title=workout.title,
                performed_at=workout.performed_at,
                sets=[
                    AthleteSet(
                        set_number=row.set_number,
                        weight_kg=row.weight_kg,
                        reps=row.reps,
                        rir=row.rir,
                        is_warmup=row.is_warmup,
                    )
                    for row in rows
                ],
            )
            for workout, rows in sessions
        ],
        next_cursor=next_cursor,
    )
