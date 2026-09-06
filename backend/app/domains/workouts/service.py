"""Workout and set business logic.

Two invariants this module is responsible for:

1. Ownership. Every lookup filters on user_id, so one account can never read
   or mutate another's sessions. Doing this in one place is safer than
   remembering an `if` in each endpoint.

2. The denormalised totals on `workouts` stay in sync with the sets beneath
   them. They are recomputed after every mutation; if that were skipped, the
   history screen would quietly show wrong volume while the detail screen
   looked fine.
"""

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import NotFoundError, ValidationAppError
from app.domains.workouts.schemas import (
    SetCreate,
    SetRead,
    SetUpdate,
    WorkoutCreate,
    WorkoutDetail,
    WorkoutListResponse,
    WorkoutQuery,
    WorkoutSummary,
    WorkoutUpdate,
)
from app.models import Exercise, Set, Workout


async def _load_owned_workout(
    db: AsyncSession, workout_id: UUID, user_id: UUID, *, with_sets: bool = False
) -> Workout:
    """Fetch a workout that belongs to this user, or raise 404.

    A workout owned by someone else reports 404 rather than 403: telling the
    caller "this exists but is not yours" would leak which ids are real.
    """
    stmt = select(Workout).where(Workout.id == workout_id, Workout.user_id == user_id)
    if with_sets:
        # Eager load; a lazy load outside the await context raises
        # MissingGreenlet under async SQLAlchemy.
        stmt = stmt.options(selectinload(Workout.sets).selectinload(Set.exercise))

    workout = await db.scalar(stmt)
    if workout is None:
        raise NotFoundError("Workout not found")
    return workout


async def _recalculate_totals(db: AsyncSession, workout: Workout) -> None:
    """Refresh total_volume_kg and total_sets from the sets currently stored.

    Recomputed from scratch rather than adjusted incrementally: an increment
    that is missed once stays wrong forever, whereas a full recount is
    self-healing and, at a few dozen rows per workout, costs nothing.
    """
    row = (
        await db.execute(
            select(
                func.coalesce(func.sum(Set.weight_kg * Set.reps), 0),
                func.count(),
            ).where(Set.workout_id == workout.id, Set.is_warmup.is_(False))
        )
    ).one()

    # Quantise to match the NUMERIC(10,2) column. Without this, SUM over no
    # rows collapses to Decimal("0") and the API returns "0" here but
    # "800.00" elsewhere — the same field in two shapes for the client to
    # parse.
    workout.total_volume_kg = Decimal(row[0]).quantize(Decimal("0.01"))
    workout.total_sets = row[1]


async def _next_set_number(db: AsyncSession, workout_id: UUID, exercise_id: UUID) -> int:
    """The next set number for this exercise within this workout."""
    current_max = await db.scalar(
        select(func.coalesce(func.max(Set.set_number), 0)).where(
            Set.workout_id == workout_id, Set.exercise_id == exercise_id
        )
    )
    return int(current_max or 0) + 1


async def _assert_exercises_exist(db: AsyncSession, exercise_ids: set[UUID]) -> None:
    """Reject unknown exercise ids up front.

    The foreign key would also refuse them, but only at flush time and as a
    500. Checking here turns it into a clear 422.
    """
    if not exercise_ids:
        return

    found = set(
        (await db.scalars(select(Exercise.id).where(Exercise.id.in_(exercise_ids)))).all()
    )
    missing = exercise_ids - found
    if missing:
        raise ValidationAppError(
            "Unknown exercise id(s): " + ", ".join(sorted(str(i) for i in missing))
        )


def _to_set_read(row: Set) -> SetRead:
    return SetRead(
        id=row.id,
        exercise_id=row.exercise_id,
        exercise_name=row.exercise.name,
        set_number=row.set_number,
        weight_kg=row.weight_kg,
        reps=row.reps,
        rir=row.rir,
        rpe=row.rpe,
        is_warmup=row.is_warmup,
    )


async def _to_detail(db: AsyncSession, workout: Workout) -> WorkoutDetail:
    """Build the detail response, loading sets in a stable order."""
    rows = (
        await db.scalars(
            select(Set)
            .where(Set.workout_id == workout.id)
            .options(selectinload(Set.exercise))
            # id ascending keeps sets in the order they were logged, which is
            # the order the session actually happened in.
            .order_by(Set.id)
        )
    ).all()

    return WorkoutDetail(
        id=workout.id,
        title=workout.title,
        notes=workout.notes,
        performed_at=workout.performed_at,
        total_volume_kg=workout.total_volume_kg,
        total_sets=workout.total_sets,
        template_id=workout.template_id,
        is_private=workout.is_private,
        sets=[_to_set_read(row) for row in rows],
    )


# ── Workouts ─────────────────────────────────────────────────────────────


async def create_workout(
    db: AsyncSession, user_id: UUID, payload: WorkoutCreate
) -> WorkoutDetail:
    """Log a session, optionally with all of its sets in one request."""
    await _assert_exercises_exist(db, {s.exercise_id for s in payload.sets})

    workout = Workout(
        user_id=user_id,
        title=payload.title,
        notes=payload.notes,
        performed_at=payload.performed_at or datetime.now(UTC),
        is_private=payload.is_private,
    )
    db.add(workout)
    await db.flush()  # need workout.id before attaching sets

    # Numbering is per exercise, so count them as we go rather than querying
    # for each one.
    counters: dict[UUID, int] = {}
    for item in payload.sets:
        counters[item.exercise_id] = counters.get(item.exercise_id, 0) + 1
        db.add(
            Set(
                workout_id=workout.id,
                exercise_id=item.exercise_id,
                set_number=counters[item.exercise_id],
                weight_kg=item.weight_kg,
                reps=item.reps,
                rir=item.rir,
                rpe=item.rpe,
                is_warmup=item.is_warmup,
            )
        )

    await db.flush()
    await _recalculate_totals(db, workout)
    await db.commit()

    return await _to_detail(db, workout)


async def list_workouts(
    db: AsyncSession, user_id: UUID, query: WorkoutQuery
) -> WorkoutListResponse:
    """The user's sessions, most recent first."""
    total = await db.scalar(
        select(func.count()).select_from(Workout).where(Workout.user_id == user_id)
    )

    rows = (
        await db.scalars(
            select(Workout)
            .where(Workout.user_id == user_id)
            .order_by(Workout.performed_at.desc())
            .limit(query.limit)
            .offset(query.offset)
        )
    ).all()

    return WorkoutListResponse(
        items=[WorkoutSummary.model_validate(row) for row in rows],
        total=total or 0,
        limit=query.limit,
        offset=query.offset,
    )


async def get_workout(db: AsyncSession, user_id: UUID, workout_id: UUID) -> WorkoutDetail:
    workout = await _load_owned_workout(db, workout_id, user_id)
    return await _to_detail(db, workout)


async def update_workout(
    db: AsyncSession, user_id: UUID, workout_id: UUID, payload: WorkoutUpdate
) -> WorkoutDetail:
    workout = await _load_owned_workout(db, workout_id, user_id)

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(workout, field, value)

    await db.commit()
    return await _to_detail(db, workout)


async def delete_workout(db: AsyncSession, user_id: UUID, workout_id: UUID) -> None:
    """Delete a session. Its sets go with it via ON DELETE CASCADE."""
    workout = await _load_owned_workout(db, workout_id, user_id)
    await db.delete(workout)
    await db.commit()


# ── Sets ─────────────────────────────────────────────────────────────────


async def add_set(
    db: AsyncSession, user_id: UUID, workout_id: UUID, payload: SetCreate
) -> WorkoutDetail:
    """Append a set and refresh the workout's totals."""
    workout = await _load_owned_workout(db, workout_id, user_id)
    await _assert_exercises_exist(db, {payload.exercise_id})

    db.add(
        Set(
            workout_id=workout.id,
            exercise_id=payload.exercise_id,
            set_number=await _next_set_number(db, workout.id, payload.exercise_id),
            weight_kg=payload.weight_kg,
            reps=payload.reps,
            rir=payload.rir,
            rpe=payload.rpe,
            is_warmup=payload.is_warmup,
        )
    )

    await db.flush()
    await _recalculate_totals(db, workout)
    await db.commit()

    return await _to_detail(db, workout)


async def update_set(
    db: AsyncSession, user_id: UUID, workout_id: UUID, set_id: int, payload: SetUpdate
) -> WorkoutDetail:
    """Correct a logged set.

    Ownership is checked through the workout, so a set id from someone else's
    session cannot be reached even by guessing (ids are sequential integers).
    """
    workout = await _load_owned_workout(db, workout_id, user_id)

    target = await db.scalar(
        select(Set).where(Set.id == set_id, Set.workout_id == workout.id)
    )
    if target is None:
        raise NotFoundError("Set not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(target, field, value)

    await db.flush()
    # Weight, reps or the warmup flag may have changed, so totals move too.
    await _recalculate_totals(db, workout)
    await db.commit()

    return await _to_detail(db, workout)


async def delete_set(
    db: AsyncSession, user_id: UUID, workout_id: UUID, set_id: int
) -> WorkoutDetail:
    """Remove a set, then close the gap it leaves in the numbering."""
    workout = await _load_owned_workout(db, workout_id, user_id)

    target = await db.scalar(
        select(Set).where(Set.id == set_id, Set.workout_id == workout.id)
    )
    if target is None:
        raise NotFoundError("Set not found")

    exercise_id = target.exercise_id
    await db.delete(target)
    await db.flush()

    # Deleting set 2 of 3 would otherwise leave 1 and 3, and the UI labels
    # sets by this number.
    remaining = (
        await db.scalars(
            select(Set)
            .where(Set.workout_id == workout.id, Set.exercise_id == exercise_id)
            .order_by(Set.set_number)
        )
    ).all()
    for position, row in enumerate(remaining, start=1):
        row.set_number = position

    await db.flush()
    await _recalculate_totals(db, workout)
    await db.commit()

    return await _to_detail(db, workout)