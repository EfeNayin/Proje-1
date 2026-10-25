"""A coach's feedback on a shared completed workout, and the athlete reading it.

Two sides with different rules:

* The coach reads and writes only through their own active, sharing link, and
  only on a completed workout of that link's athlete. All of that is checked
  from the database on every request. Writes also take the link's row lock,
  the one ending the link and switching sharing off take, so a write either
  commits before either of those or is refused after it; a stale request
  cannot slip through between the check and the commit.
* The athlete reads every piece of feedback on their own workouts, whatever
  later happens to the link: ending it or switching sharing off ends the
  coach's access, not the athlete's copy of what was written for them.

At most one entry exists per (connection, workout). Creating is idempotent by
request id; editing and deleting must name the version they saw, so an edit
made from stale data is refused instead of silently overwriting a newer one.
"""

import hashlib
from uuid import UUID

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, NotFoundError
from app.domains.coaching import workout_access
from app.domains.coaching.schemas import (
    CoachFeedback,
    CoachFeedbackResult,
    PersonSummary,
    ReceivedFeedback,
    ReceivedFeedbackList,
)
from app.models import CoachAthleteLink, User, Workout, WorkoutFeedback

CHANGED = (
    "This feedback changed since you opened it. Review the latest version before " "saving over it."
)


async def _context(
    db: AsyncSession, coach: User, link_id: UUID, workout_id: UUID, *, write: bool
) -> tuple[CoachAthleteLink, Workout]:
    link = await workout_access._authorise(db, coach, link_id, lock=write)
    statement = select(Workout).where(
        Workout.id == workout_id, *workout_access._completed(link.athlete_id)
    )
    if write:
        # Keeps the workout from being deleted until this write commits.
        statement = statement.with_for_update(read=True)
    workout = await db.scalar(statement)
    if workout is None:
        raise NotFoundError("Workout not found.")
    return link, workout


async def _current(db: AsyncSession, link_id: UUID, workout_id: UUID) -> WorkoutFeedback | None:
    row: WorkoutFeedback | None = await db.scalar(
        select(WorkoutFeedback).where(
            WorkoutFeedback.link_id == link_id, WorkoutFeedback.workout_id == workout_id
        )
    )
    return row


def _create_hash(link_id: UUID, workout_id: UUID, body: str) -> str:
    return hashlib.sha256(f"{link_id}\n{workout_id}\n{body}".encode()).hexdigest()


async def get_feedback(
    db: AsyncSession, coach: User, link_id: UUID, workout_id: UUID
) -> CoachFeedbackResult:
    link, workout = await _context(db, coach, link_id, workout_id, write=False)
    row = await _current(db, link.id, workout.id)
    return CoachFeedbackResult(feedback=CoachFeedback.model_validate(row) if row else None)


async def create_feedback(
    db: AsyncSession, coach: User, link_id: UUID, workout_id: UUID, request_id: UUID, body: str
) -> tuple[CoachFeedback, bool]:
    """Returns (feedback, created). Repeating the same request returns the same row."""
    link, workout = await _context(db, coach, link_id, workout_id, write=True)
    digest = _create_hash(link.id, workout.id, body)

    existing = await _current(db, link.id, workout.id)
    if existing is not None:
        if existing.create_request_id == request_id:
            if existing.create_hash != digest:
                raise ConflictError("This request was already used for different text.")
            return CoachFeedback.model_validate(existing), False
        raise ConflictError(
            "You already left feedback on this workout. Review it before changing it."
        )
    reused = await db.scalar(
        select(WorkoutFeedback.id).where(
            WorkoutFeedback.link_id == link.id, WorkoutFeedback.create_request_id == request_id
        )
    )
    if reused is not None:
        raise ConflictError("This request was already used for a different workout.")

    row = WorkoutFeedback(
        link_id=link.id,
        workout_id=workout.id,
        body=body,
        create_request_id=request_id,
        create_hash=digest,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return CoachFeedback.model_validate(row), True


async def update_feedback(
    db: AsyncSession,
    coach: User,
    link_id: UUID,
    workout_id: UUID,
    body: str,
    expected_version: int,
) -> CoachFeedback:
    link, workout = await _context(db, coach, link_id, workout_id, write=True)
    row = await _current(db, link.id, workout.id)
    if row is None:
        # Deleted elsewhere. A conflict, not a 404: 404 is reserved for losing access.
        raise ConflictError(CHANGED)
    if row.version == expected_version:
        if row.body == body:
            return CoachFeedback.model_validate(row)
        await db.execute(
            update(WorkoutFeedback)
            .where(WorkoutFeedback.id == row.id, WorkoutFeedback.version == expected_version)
            .values(body=body, version=WorkoutFeedback.version + 1, updated_at=func.now())
        )
        await db.commit()
        await db.refresh(row)
        return CoachFeedback.model_validate(row)
    if row.version == expected_version + 1 and row.body == body:
        # A lost response: this very edit was already applied.
        return CoachFeedback.model_validate(row)
    raise ConflictError(CHANGED)


async def delete_feedback(
    db: AsyncSession, coach: User, link_id: UUID, workout_id: UUID, expected_version: int
) -> None:
    """Idempotent: feedback that is already gone is a success."""
    link, workout = await _context(db, coach, link_id, workout_id, write=True)
    row = await _current(db, link.id, workout.id)
    if row is None:
        return
    if row.version != expected_version:
        raise ConflictError(CHANGED)
    await db.execute(delete(WorkoutFeedback).where(WorkoutFeedback.id == row.id))
    await db.commit()


async def list_received(db: AsyncSession, athlete: User, workout_id: UUID) -> ReceivedFeedbackList:
    """Everything coaches wrote on this athlete's workout, oldest first, never mixed.

    Deliberately independent of the links' current state.
    """
    owned = await db.scalar(
        select(Workout.id).where(Workout.id == workout_id, Workout.user_id == athlete.id)
    )
    if owned is None:
        raise NotFoundError("Workout not found")
    rows = (
        await db.execute(
            select(WorkoutFeedback, User)
            .join(CoachAthleteLink, CoachAthleteLink.id == WorkoutFeedback.link_id)
            .join(User, User.id == CoachAthleteLink.coach_id)
            .where(
                WorkoutFeedback.workout_id == workout_id,
                CoachAthleteLink.athlete_id == athlete.id,
            )
            .order_by(WorkoutFeedback.created_at, WorkoutFeedback.id)
        )
    ).all()
    return ReceivedFeedbackList(
        items=[
            ReceivedFeedback(
                id=row.id,
                coach=PersonSummary.model_validate(coach),
                body=row.body,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
            for row, coach in rows
        ]
    )
