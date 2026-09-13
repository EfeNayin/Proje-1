"""Program, template and template-exercise business logic.

Two invariants this module is responsible for:

1. Ownership. Programs are looked up by (id, user_id) directly. Templates
   and their exercises carry no user_id of their own, so ownership is
   proven by joining through the parent program — the same "prove it
   through the owning row" shape sets use to prove ownership through their
   workout.

2. Exactly one active program per user, enforced by a partial UNIQUE index
   (idx_programs_one_active). Whatever program is currently active must be
   deactivated in the SAME transaction, before the target program is
   activated — a single UPDATE that tried to do both at once would collide
   with itself under that index the instant both rows read is_active=true.
"""

import hashlib
import json
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import ConflictError, NotFoundError, ValidationAppError
from app.domains.programs.schemas import (
    ProgramCreate,
    ProgramDetail,
    ProgramSummary,
    ProgramUpdate,
    TemplateExerciseRead,
    TemplateExercisesSet,
    TemplateStart,
    WorkoutTemplateCreate,
    WorkoutTemplateRead,
    WorkoutTemplateUpdate,
    WorkoutTemplateWithExercisesCreate,
)
from app.domains.workouts.service import close_dangling_workouts
from app.models import Exercise, Program, TemplateExercise, Workout, WorkoutTemplate
from app.models.program import TemplateSaveRequest


async def _load_owned_program(db: AsyncSession, program_id: UUID, user_id: UUID) -> Program:
    """Fetch a program that belongs to this user, or raise 404.

    A program owned by someone else reports 404 rather than 403: telling
    the caller "this exists but is not yours" would leak which ids are real.
    """
    program = await db.scalar(
        select(Program).where(Program.id == program_id, Program.user_id == user_id)
    )
    if program is None:
        raise NotFoundError("Program not found")
    return program


async def _load_owned_template(
    db: AsyncSession, template_id: UUID, user_id: UUID, *, lock: bool = False
) -> WorkoutTemplate:
    """A template belonging to one of this user's programs, or 404.

    Templates carry no user_id of their own; ownership is proven by joining
    through the program that owns them.
    """
    statement = (
        select(WorkoutTemplate)
        .join(Program, Program.id == WorkoutTemplate.program_id)
        .where(WorkoutTemplate.id == template_id, Program.user_id == user_id)
    )
    if lock:
        statement = statement.with_for_update(of=WorkoutTemplate)
    template = await db.scalar(statement)
    if template is None:
        raise NotFoundError("Template not found")
    return template


async def _assert_exercises_exist(db: AsyncSession, exercise_ids: set[UUID]) -> None:
    """Reject unknown exercise ids up front.

    The foreign key would also refuse them, but only at flush time and as a
    500. Checking here turns it into a clear 422.
    """
    if not exercise_ids:
        return

    found = set((await db.scalars(select(Exercise.id).where(Exercise.id.in_(exercise_ids)))).all())
    missing = exercise_ids - found
    if missing:
        raise ValidationAppError(
            "Unknown exercise id(s): " + ", ".join(sorted(str(i) for i in missing))
        )


def _to_exercise_read(row: TemplateExercise) -> TemplateExerciseRead:
    return TemplateExerciseRead(
        id=row.id,
        exercise_id=row.exercise_id,
        exercise_name=row.exercise.name,
        exercise_order=row.exercise_order,
        target_sets=row.target_sets,
        target_reps_min=row.target_reps_min,
        target_reps_max=row.target_reps_max,
        target_rir=row.target_rir,
        target_rpe=row.target_rpe,
        notes=row.notes,
    )


async def _load_exercises(db: AsyncSession, template_id: UUID) -> list[TemplateExerciseRead]:
    """A template's exercises, freshly queried and eagerly loaded.

    Always re-queried rather than read off an in-memory relationship: some
    callers mutate exercises through a bulk delete-then-insert that never
    touches the ORM collection, so trusting it would risk stale data, and a
    lazy load outside the await context would raise MissingGreenlet anyway.
    """
    rows = (
        await db.scalars(
            select(TemplateExercise)
            .where(TemplateExercise.template_id == template_id)
            .options(selectinload(TemplateExercise.exercise))
            .order_by(TemplateExercise.exercise_order)
        )
    ).all()
    return [_to_exercise_read(row) for row in rows]


async def _to_template_detail(db: AsyncSession, template: WorkoutTemplate) -> WorkoutTemplateRead:
    return WorkoutTemplateRead(
        id=template.id,
        name=template.name,
        day_order=template.day_order,
        notes=template.notes,
        exercises=await _load_exercises(db, template.id),
    )


async def _to_program_detail(db: AsyncSession, program: Program) -> ProgramDetail:
    """Build the detail response, loading templates and their exercises fresh."""
    templates = (
        await db.scalars(
            select(WorkoutTemplate)
            .where(WorkoutTemplate.program_id == program.id)
            .options(
                selectinload(WorkoutTemplate.exercises).selectinload(TemplateExercise.exercise)
            )
            .order_by(WorkoutTemplate.day_order)
        )
    ).all()

    return ProgramDetail(
        id=program.id,
        name=program.name,
        is_active=program.is_active,
        notes=program.notes,
        templates=[
            WorkoutTemplateRead(
                id=t.id,
                name=t.name,
                day_order=t.day_order,
                notes=t.notes,
                exercises=[
                    _to_exercise_read(row)
                    for row in sorted(t.exercises, key=lambda r: r.exercise_order)
                ],
            )
            for t in templates
        ],
    )


async def _deactivate_current_program(db: AsyncSession, user_id: UUID) -> None:
    """Turn off whatever program is currently active for this user, if any.

    Must run in the same transaction as whatever activates the next one.
    """
    await db.execute(
        update(Program)
        .where(Program.user_id == user_id, Program.is_active.is_(True))
        .values(is_active=False)
    )


# ── Programs ─────────────────────────────────────────────────────────────


async def create_program(db: AsyncSession, user_id: UUID, payload: ProgramCreate) -> ProgramDetail:
    """A new program is active by default, so any current one is closed first."""
    await _deactivate_current_program(db, user_id)

    program = Program(user_id=user_id, name=payload.name, notes=payload.notes, is_active=True)
    db.add(program)
    await db.commit()

    return await _to_program_detail(db, program)


async def list_programs(db: AsyncSession, user_id: UUID) -> list[ProgramSummary]:
    rows = (
        await db.scalars(
            select(Program).where(Program.user_id == user_id).order_by(Program.created_at.desc())
        )
    ).all()
    return [ProgramSummary.model_validate(row) for row in rows]


async def get_program(db: AsyncSession, user_id: UUID, program_id: UUID) -> ProgramDetail:
    program = await _load_owned_program(db, program_id, user_id)
    return await _to_program_detail(db, program)


async def update_program(
    db: AsyncSession, user_id: UUID, program_id: UUID, payload: ProgramUpdate
) -> ProgramDetail:
    program = await _load_owned_program(db, program_id, user_id)

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(program, field, value)

    await db.commit()
    return await _to_program_detail(db, program)


async def activate_program(db: AsyncSession, user_id: UUID, program_id: UUID) -> ProgramDetail:
    """Make this the active program. Whatever was active closes first, same transaction."""
    program = await _load_owned_program(db, program_id, user_id)

    await _deactivate_current_program(db, user_id)
    program.is_active = True

    await db.commit()
    return await _to_program_detail(db, program)


async def delete_program(db: AsyncSession, user_id: UUID, program_id: UUID) -> None:
    """Delete a program. Its templates and their exercises go with it via cascade."""
    program = await _load_owned_program(db, program_id, user_id)
    await db.delete(program)
    await db.commit()


# ── Templates ────────────────────────────────────────────────────────────


async def create_template(
    db: AsyncSession, user_id: UUID, program_id: UUID, payload: WorkoutTemplateCreate
) -> WorkoutTemplateRead:
    program = await _load_owned_program(db, program_id, user_id)

    template = WorkoutTemplate(
        program_id=program.id, name=payload.name, day_order=payload.day_order, notes=payload.notes
    )
    db.add(template)
    await db.commit()

    return await _to_template_detail(db, template)


async def create_template_with_exercises(
    db: AsyncSession,
    user_id: UUID,
    program_id: UUID,
    payload: WorkoutTemplateWithExercisesCreate,
    request_id: UUID | None = None,
) -> WorkoutTemplateRead:
    program = await _load_owned_program(db, program_id, user_id)
    if request_id is not None:
        request_hash = hashlib.sha256(json.dumps(
            {"program_id": str(program_id), "payload": payload.model_dump(mode="json")},
            sort_keys=True, separators=(",", ":"),
        ).encode()).hexdigest()
        # The unique key makes concurrent retries wait for the first transaction.
        # A rollback releases the key so the waiting request can perform the save.
        inserted = await db.scalar(
            insert(TemplateSaveRequest).values(
                user_id=user_id, request_id=request_id, request_hash=request_hash
            ).on_conflict_do_nothing().returning(TemplateSaveRequest.request_id)
        )
        if inserted is None:
            receipt = await db.get(TemplateSaveRequest, (user_id, request_id))
            if receipt is None or receipt.request_hash != request_hash:
                raise ConflictError("This save request was already used with different details.")
            if receipt.response is None:
                raise ConflictError("This save request has no completed result.")
            detail = WorkoutTemplateRead.model_validate(receipt.response)
            await _load_owned_template(db, detail.id, user_id)
            return detail
    await _assert_exercises_exist(db, {item.exercise_id for item in payload.exercises})
    template = WorkoutTemplate(
        program_id=program.id, name=payload.name, day_order=payload.day_order, notes=payload.notes
    )
    db.add(template)
    await db.flush()
    for order, item in enumerate(payload.exercises):
        db.add(TemplateExercise(
            template_id=template.id, exercise_order=order, **item.model_dump()
        ))
    await db.flush()
    # Prepare the complete response before committing; failures leave no partial template.
    detail = await _to_template_detail(db, template)
    if request_id is not None:
        await db.execute(update(TemplateSaveRequest).where(
            TemplateSaveRequest.user_id == user_id,
            TemplateSaveRequest.request_id == request_id,
        ).values(response=detail.model_dump(mode="json")))
    await db.commit()
    return detail


async def get_template(db: AsyncSession, user_id: UUID, template_id: UUID) -> WorkoutTemplateRead:
    template = await _load_owned_template(db, template_id, user_id)
    return await _to_template_detail(db, template)


async def update_template(
    db: AsyncSession, user_id: UUID, template_id: UUID, payload: WorkoutTemplateUpdate
) -> WorkoutTemplateRead:
    template = await _load_owned_template(db, template_id, user_id)

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(template, field, value)

    await db.commit()
    return await _to_template_detail(db, template)


async def delete_template(db: AsyncSession, user_id: UUID, template_id: UUID) -> None:
    """Delete a template. Its exercise targets go with it via cascade; workouts
    already logged from it keep their history (template_id is set to NULL)."""
    template = await _load_owned_template(db, template_id, user_id)
    await db.delete(template)
    await db.commit()


async def set_template_exercises(
    db: AsyncSession, user_id: UUID, template_id: UUID, payload: TemplateExercisesSet
) -> WorkoutTemplateRead:
    """Replace every exercise and target in a template with the given list.

    Simplest correct approach: delete everything and reinsert in the order
    given, rather than diffing against what was there before.
    """
    # Serialize target replacement with start so a snapshot sees one complete plan.
    template = await _load_owned_template(db, template_id, user_id, lock=True)
    await _assert_exercises_exist(db, {item.exercise_id for item in payload.exercises})

    await db.execute(delete(TemplateExercise).where(TemplateExercise.template_id == template.id))
    for order, item in enumerate(payload.exercises):
        db.add(
            TemplateExercise(
                template_id=template.id,
                exercise_id=item.exercise_id,
                exercise_order=order,
                target_sets=item.target_sets,
                target_reps_min=item.target_reps_min,
                target_reps_max=item.target_reps_max,
                target_rir=item.target_rir,
                target_rpe=item.target_rpe,
                notes=item.notes,
            )
        )

    await db.flush()
    await db.commit()
    return await _to_template_detail(db, template)


# ── Start from template ──────────────────────────────────────────────────


async def start_workout_from_template(
    db: AsyncSession, user_id: UUID, template_id: UUID
) -> TemplateStart:
    """Create an empty workout linked to this template.

    No sets are created — only the link and a snapshot. The user logs what actually
    happened against the returned targets, the same way they always log a
    set; this endpoint just saves them from re-picking every exercise.
    """
    template = await _load_owned_template(db, template_id, user_id, lock=True)
    snapshot = await _to_template_detail(db, template)

    await close_dangling_workouts(db, user_id)

    workout = Workout(
        user_id=user_id,
        template_id=template.id,
        template_snapshot=snapshot.model_dump(mode="json"),
        title=template.name,
        performed_at=datetime.now(UTC),
    )
    db.add(workout)
    await db.commit()

    return TemplateStart(
        workout_id=workout.id,
        template_id=template.id,
        performed_at=workout.performed_at,
        targets=snapshot.exercises,
    )
