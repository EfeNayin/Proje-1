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
    PrimaryMuscle,
)
from app.models import Exercise, ExerciseMuscleGroup, MuscleGroup

# Adım 26: the picker groups the 17-muscle taxonomy into seven broad
# categories for browsing, matching how people actually think about a
# session ("chest day", "leg day") rather than the detailed breakdown used
# for volume analytics. Two placements are judgement calls, not obvious from
# the muscle name alone:
#   - forearms -> biceps: forearm work (wrist curls etc.) is conventionally
#     paired with an arm/biceps day in this app's catalogue, and the user's
#     seven categories had no separate "forearms" or "arms" bucket.
#   - traps -> back: shrugs and other trap work sit on a back day here rather
#     than under "shoulders".
# Every one of the 17 muscle_groups rows appears in exactly one category.
CATEGORY_MUSCLES: dict[str, tuple[str, ...]] = {
    "chest": ("chest",),
    "back": ("upper_back", "lats", "lower_back", "traps"),
    "biceps": ("biceps", "forearms"),
    "triceps": ("triceps",),
    "legs": ("quads", "hamstrings", "glutes", "calves"),
    "abs": ("abs", "obliques"),
    "shoulders": ("front_delts", "side_delts", "rear_delts"),
}


def _normalise(column: Any) -> ColumnElement[str]:
    """Lowercase and strip accents, so 'gogus' matches 'Göğüs'.

    Mirrors the expression used by idx_exercises_name / _name_tr. Writing it
    any other way here would silently stop using those indexes.

    The parameter is Any because callers pass a mix of mapped attributes and
    plain strings, and SQLAlchemy's InstrumentedAttribute does not satisfy
    ColumnElement under mypy. The return type is the one callers rely on.
    """
    return cast(ColumnElement[str], func.lower(func.immutable_unaccent(column)))


def _trains_directly(*muscle_clause: ColumnElement[bool]) -> ColumnElement[bool]:
    """True for exercises with a PRIMARY link to a muscle matching the clause.

    Primary only, for the same reason the weekly set count is (see CLAUDE.md,
    "Hipertrofi modeli"): browsing "triceps" asks what trains triceps directly.
    A bench press, where triceps only assist, is a chest exercise and listing it
    under triceps misdescribes it. Secondary involvement is still shown on the
    exercise detail; it just does not decide which list an exercise is in.

    EXISTS rather than a JOIN: a JOIN would repeat an exercise once per matching
    muscle (a squat under "legs" matches quads and glutes) and inflate the count.
    """
    return (
        select(1)
        .select_from(ExerciseMuscleGroup)
        .join(MuscleGroup, MuscleGroup.id == ExerciseMuscleGroup.muscle_group_id)
        .where(
            ExerciseMuscleGroup.exercise_id == Exercise.id,
            ExerciseMuscleGroup.role == "primary",
            *muscle_clause,
        )
        .exists()
    )


def primary_muscles(exercise: Exercise) -> list[PrimaryMuscle]:
    """The exercise's primary muscles, best fit first, then by code.

    The same order the detail view uses, and stable between requests. Needs
    muscle_links and their muscle_group loaded.
    """
    links = sorted(
        (link for link in exercise.muscle_links if link.role == "primary"),
        key=lambda link: (-link.effectiveness, link.muscle_group.name),
    )
    return [
        PrimaryMuscle(name=link.muscle_group.name, name_tr=link.muscle_group.name_tr)
        for link in links
    ]


# Eager load: async SQLAlchemy raises MissingGreenlet on a lazy load triggered
# outside the session's await context. selectinload costs two extra queries for
# a whole page (links, then muscle groups), not one per exercise.
_WITH_MUSCLES = selectinload(Exercise.muscle_links).selectinload(ExerciseMuscleGroup.muscle_group)


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
        stmt = stmt.where(_trains_directly(MuscleGroup.name == query.muscle))

    if query.category:
        # Any of the muscles that make up this broad category.
        stmt = stmt.where(_trains_directly(MuscleGroup.name.in_(CATEGORY_MUSCLES[query.category])))

    return stmt


async def list_exercises(db: AsyncSession, query: ExerciseQuery) -> ExerciseListResponse:
    """Search, filter and page through the catalogue."""
    total = await db.scalar(_apply_filters(select(func.count()).select_from(Exercise), query))

    stmt = _apply_filters(select(Exercise), query)
    # Compound movements first: they are what people log at the start of a
    # session, so they belong at the top of the picker.
    stmt = (
        stmt.options(_WITH_MUSCLES)
        .order_by(Exercise.is_compound.desc(), Exercise.name)
        .limit(query.limit)
        .offset(query.offset)
    )

    rows = (await db.scalars(stmt)).all()

    return ExerciseListResponse(
        items=[
            ExerciseSummary(
                id=row.id,
                name=row.name,
                name_tr=row.name_tr,
                equipment=row.equipment,
                is_compound=row.is_compound,
                primary_muscles=primary_muscles(row),
            )
            for row in rows
        ],
        total=total or 0,
        limit=query.limit,
        offset=query.offset,
    )


async def get_exercise(db: AsyncSession, exercise_id: UUID) -> ExerciseDetail:
    """One exercise plus the muscles it trains."""
    exercise = await db.scalar(
        select(Exercise).where(Exercise.id == exercise_id).options(_WITH_MUSCLES)
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
        primary_muscles=primary_muscles(exercise),
        muscles=muscles,
    )


async def list_muscle_groups(db: AsyncSession) -> list[MuscleGroupSummary]:
    """Every muscle group with its volume landmarks, grouped by region."""
    rows = (
        await db.scalars(select(MuscleGroup).order_by(MuscleGroup.region, MuscleGroup.name))
    ).all()
    return [MuscleGroupSummary.model_validate(row) for row in rows]
