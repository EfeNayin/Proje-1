"""Exercise catalogue queries."""

from typing import Any, Literal, cast
from uuid import UUID

from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.sql.elements import ColumnElement

from app.core.exceptions import NotFoundError
from app.domains.exercises.schemas import (
    ExerciseDetail,
    ExerciseListResponse,
    ExerciseQuery,
    ExerciseSummary,
    MuscleGroupSummary,
    MuscleInvolvement,
)
from app.models import Exercise, ExerciseMuscleGroup, MuscleGroup


def _normalise(column: Any) -> ColumnElement[str]:
    """Lowercase and strip accents, so 'gogus' matches 'Göğüs'.

    Mirrors the expression used by idx_exercises_name / _name_tr. Writing it
    any other way here would silently stop using those indexes.

    The parameter is Any because callers pass a mix of mapped attributes and
    plain strings, and SQLAlchemy's InstrumentedAttribute does not satisfy
    ColumnElement under mypy. The return type is the one callers rely on.
    """
    return cast(ColumnElement[str], func.lower(func.immutable_unaccent(column)))


def _apply_filters(stmt: Select[Any], query: ExerciseQuery) -> Select[Any]:
    """Apply search and filter clauses shared by the list and count queries."""
    if query.q:
        pattern = f"%{query.q}%"
        stmt = stmt.where(
            or_(
                _normalise(Exercise.name).like(_normalise(pattern)),
                # name_tr is nullable; LIKE on NULL yields NULL, which is
                # falsy, so rows without a Turkish name simply do not match.
                _normalise(Exercise.name_tr).like(_normalise(pattern)),
            )
        )

    if query.equipment:
        stmt = stmt.where(Exercise.equipment == query.equipment)

    if query.muscle:
        # EXISTS rather than a JOIN: an exercise can hit the same muscle
        # through several rows, and a JOIN would duplicate it in the results.
        stmt = stmt.where(
            select(1)
            .select_from(ExerciseMuscleGroup)
            .join(MuscleGroup, MuscleGroup.id == ExerciseMuscleGroup.muscle_group_id)
            .where(
                ExerciseMuscleGroup.exercise_id == Exercise.id,
                MuscleGroup.name == query.muscle,
            )
            .exists()
        )

    return stmt


async def list_exercises(db: AsyncSession, query: ExerciseQuery) -> ExerciseListResponse:
    """Search, filter and page through the catalogue."""
    total = await db.scalar(
        _apply_filters(select(func.count()).select_from(Exercise), query)
    )

    stmt = _apply_filters(select(Exercise), query)
    # Compound movements first: they are what people log at the start of a
    # session, so they belong at the top of the picker.
    stmt = stmt.order_by(Exercise.is_compound.desc(), Exercise.name).limit(
        query.limit
    ).offset(query.offset)

    rows = (await db.scalars(stmt)).all()

    return ExerciseListResponse(
        items=[ExerciseSummary.model_validate(row) for row in rows],
        total=total or 0,
        limit=query.limit,
        offset=query.offset,
    )


async def get_exercise(db: AsyncSession, exercise_id: UUID) -> ExerciseDetail:
    """One exercise plus the muscles it trains."""
    exercise = await db.scalar(
        select(Exercise)
        .where(Exercise.id == exercise_id)
        # Eager load: async SQLAlchemy raises MissingGreenlet on a lazy load
        # triggered outside the session's await context.
        .options(selectinload(Exercise.muscle_links).selectinload(ExerciseMuscleGroup.muscle_group))
    )
    if exercise is None:
        raise NotFoundError("Exercise not found")

    muscles = [
        MuscleInvolvement(
            name=link.muscle_group.name,
            name_tr=link.muscle_group.name_tr,
            role=cast(Literal["primary", "secondary"], link.role),
            effectiveness=link.effectiveness,
        )
        # Primary muscles first, then by effectiveness, so the client can show
        # the headline muscle without sorting again.
        for link in sorted(
            exercise.muscle_links, key=lambda x: (x.role != "primary", -x.effectiveness)
        )
    ]

    return ExerciseDetail(
        id=exercise.id,
        name=exercise.name,
        name_tr=exercise.name_tr,
        equipment=exercise.equipment,
        is_compound=exercise.is_compound,
        muscles=muscles,
    )


async def list_muscle_groups(db: AsyncSession) -> list[MuscleGroupSummary]:
    """Every muscle group with its volume landmarks, grouped by region."""
    rows = (
        await db.scalars(select(MuscleGroup).order_by(MuscleGroup.region, MuscleGroup.name))
    ).all()
    return [MuscleGroupSummary.model_validate(row) for row in rows]