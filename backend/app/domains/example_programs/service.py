"""Browse the example programs and copy one into the caller's own programs.

Browsing reads static content (`catalogue.py`) and writes nothing. Copying builds
a complete, independent program through `offers.materialize_program`, the one
routine that turns a frozen program into rows (accepting a coach's offer uses it
too), so a copy shares nothing with the example or with any other copy.

The copy is atomic and safe to repeat:

- One transaction holds the receipt, the program, its days and their exercises.
  Anything that fails (an exercise missing from the catalogue, a bad target)
  rolls all of it back, receipt included, so the same request id can try again.
- The receipt row is inserted FIRST with ON CONFLICT DO NOTHING. A second request
  with the same id (double tap, retry after a lost response, a concurrent twin)
  blocks on that unique key until the first transaction ends, then finds either
  the finished copy or a free key. Same pattern as the template-save receipts.
- A retry returns the original program. It never creates a second one, and it is
  checked against what the first request asked for.
- The copy is created INACTIVE and no program row of the user is touched, so the
  active program is preserved; activation stays the explicit existing action.
"""

from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, NotFoundError, ServiceUnavailableError
from app.domains.coaching import offers
from app.domains.coaching.schemas import OfferExercise, OfferProgram, OfferTemplate
from app.domains.example_programs import catalogue
from app.domains.example_programs.schemas import (
    ExampleCopyRequest,
    ExampleDay,
    ExampleDetail,
    ExampleExercise,
    ExampleList,
    ExampleSource,
    ExampleSummary,
)
from app.domains.programs import service as programs_service
from app.domains.programs.schemas import ProgramDetail
from app.models import Exercise
from app.models.program import ExampleProgramCopyRequest

UNAVAILABLE_CODE = "example_unavailable"


def _summary(example: catalogue.Example) -> ExampleSummary:
    return ExampleSummary(
        id=example.id,
        version=example.version,
        level=example.level,
        name=example.name,
        summary=example.summary,
        sessions_per_week=example.sessions_per_week,
        schedule=example.schedule,
        day_count=len(example.days),
        exercise_count=sum(len(day.moves) for day in example.days),
        weekly_working_sets=catalogue.weekly_working_sets(example),
    )


def _example_or_404(example_id: str) -> catalogue.Example:
    example = catalogue.by_id(example_id)
    if example is None:
        raise NotFoundError("This example program does not exist.")
    return example


async def resolve(db: AsyncSession, example: catalogue.Example) -> OfferProgram:
    """The example as a frozen program whose every exercise is a real catalogue row.

    Names are matched to the SYSTEM catalogue only (created_by IS NULL): a custom
    exercise someone made with the same name must never be picked up. A name that
    matches nothing, or more than one row, makes the whole example unavailable;
    nothing is guessed or skipped. Targets are validated by the same model a coach's
    program snapshot goes through.
    """
    problems = catalogue.validate_catalogue((example,))
    if problems:
        raise _unavailable(f"its content is invalid ({problems[0]})")

    wanted = {move.exercise for day in example.days for move in day.moves}
    rows = (
        await db.execute(
            select(Exercise.name, Exercise.id).where(
                Exercise.created_by.is_(None), Exercise.name.in_(wanted)
            )
        )
    ).all()
    by_name: dict[str, list[UUID]] = {}
    for name, exercise_id in rows:
        by_name.setdefault(name, []).append(exercise_id)
    missing = sorted(name for name in wanted if name not in by_name)
    ambiguous = sorted(name for name, ids in by_name.items() if len(ids) > 1)
    if missing or ambiguous:
        parts = []
        if missing:
            parts.append("missing from the exercise catalogue: " + ", ".join(missing))
        if ambiguous:
            parts.append("listed more than once in the catalogue: " + ", ".join(ambiguous))
        raise _unavailable("; ".join(parts))

    try:
        return OfferProgram(
            name=example.name,
            notes=_program_notes(example),
            templates=[
                OfferTemplate(
                    name=day.name,
                    day_order=day_order,
                    notes=day.note,
                    exercises=[
                        OfferExercise(
                            exercise_id=by_name[move.exercise][0],
                            exercise_name=move.exercise,
                            exercise_order=order,
                            target_sets=move.sets,
                            target_reps_min=move.reps_min,
                            target_reps_max=move.reps_max,
                            target_rir=move.rir,
                            target_rpe=None,
                            notes=move.note,
                        )
                        for order, move in enumerate(day.moves)
                    ],
                )
                for day_order, day in enumerate(example.days)
            ],
        )
    except ValidationError as err:
        raise _unavailable("a target is not valid") from err


def _program_notes(example: catalogue.Example) -> str:
    return (
        f"Aures example program ({example.level}). Suggested schedule: {example.schedule} "
        "This is an editable copy; change anything you like."
    )


def _unavailable(reason: str) -> ServiceUnavailableError:
    return ServiceUnavailableError(
        f"This example program cannot be added right now: {reason}. Nothing was added.",
        code=UNAVAILABLE_CODE,
    )


# ── Browse ───────────────────────────────────────────────────────────────


def list_examples() -> ExampleList:
    return ExampleList(examples=[_summary(example) for example in catalogue.EXAMPLES])


async def get_example(db: AsyncSession, example_id: str) -> ExampleDetail:
    """The full preview. Resolved against the catalogue, so it never shows an example
    that could not be copied."""
    example = _example_or_404(example_id)
    await resolve(db, example)  # raises if any exercise or target cannot be used
    return ExampleDetail(
        **_summary(example).model_dump(),
        sequence=list(example.sequence),
        days=[
            ExampleDay(
                name=day.name,
                day_order=day_order,
                notes=day.note,
                exercises=[
                    ExampleExercise(
                        exercise_name=move.exercise,
                        exercise_order=order,
                        target_sets=move.sets,
                        target_reps_min=move.reps_min,
                        target_reps_max=move.reps_max,
                        target_rir=move.rir,
                        notes=move.note,
                    )
                    for order, move in enumerate(day.moves)
                ],
            )
            for day_order, day in enumerate(example.days)
        ],
        sources=[
            ExampleSource(
                title=source.title,
                citation=source.citation,
                url=source.url,
                finding=source.finding,
            )
            for source in example.sources
        ],
        authored=list(example.authored),
    )


# ── Copy ─────────────────────────────────────────────────────────────────


async def copy_example(
    db: AsyncSession, user_id: UUID, request_id: UUID, payload: ExampleCopyRequest
) -> ProgramDetail:
    """Add an independent, inactive copy of an example to the user's programs, once."""
    inserted = await db.scalar(
        insert(ExampleProgramCopyRequest)
        .values(
            user_id=user_id,
            request_id=request_id,
            example_id=payload.example_id,
            example_version=payload.version,
        )
        .on_conflict_do_nothing()
        .returning(ExampleProgramCopyRequest.request_id)
    )
    if inserted is None:
        return await _replay(db, user_id, request_id, payload)

    # A new request: now check it against the content as it is today. Raising rolls
    # the receipt back with everything else, so a corrected retry can use the same id.
    example = _example_or_404(payload.example_id)
    if payload.version != example.version:
        raise ConflictError(
            "This example program was updated since you opened it. Open it again to see "
            "the current version.",
            code="example_version_changed",
        )
    frozen = await resolve(db, example)

    # Inactive: whatever is active stays active. No other program row is touched.
    program = await offers.materialize_program(db, user_id, frozen, active=False)
    receipt = await db.get(ExampleProgramCopyRequest, (user_id, request_id))
    assert receipt is not None
    receipt.program_id = program.id
    await db.commit()
    return await programs_service.get_program(db, user_id, program.id)


async def _replay(
    db: AsyncSession, user_id: UUID, request_id: UUID, payload: ExampleCopyRequest
) -> ProgramDetail:
    receipt = await db.get(
        ExampleProgramCopyRequest,
        (user_id, request_id),
        populate_existing=True,
    )
    if receipt is None:
        # Cannot happen for a committed key; treat a vanished one as a retryable conflict.
        raise ConflictError("This request could not be completed. Try again.")
    if receipt.example_id != payload.example_id or receipt.example_version != payload.version:
        raise ConflictError(
            "This request id was already used for a different example program.",
            code="example_request_mismatch",
        )
    if receipt.program_id is None:
        raise ConflictError(
            "This copy was already added and has since been deleted. Add the example again "
            "to get a new one.",
            code="example_copy_deleted",
        )
    return await programs_service.get_program(db, user_id, receipt.program_id)
