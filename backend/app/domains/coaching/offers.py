"""A coach sends a program; the athlete decides whether to keep a copy.

Nothing here lets a coach touch an athlete's programs. Sending stores a frozen
snapshot as an *offer* tied to one connection. Accepting copies that snapshot
into a new, inactive program the athlete owns; from then on the copy is the
athlete's alone and nothing keeps it in sync with the coach's original.

Two rules hold the design together:

- Every request re-reads the connection. An offer is only reachable through an
  active link, so ending the link makes pending offers unavailable at once, and
  a reconnection is a new link that cannot see the old link's offers.
- Accept and decline lock the link row first (the same row `end_link` locks),
  then the offer. A request that was already in flight when the connection
  ended therefore waits, sees the end, and is refused; two accepts of one offer
  take turns, and the second finds the first one's copy.
"""

import hashlib
import hmac
import json
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import (
    ConflictError,
    NotFoundError,
    PreconditionFailedError,
    ValidationAppError,
)
from app.domains.coaching import service
from app.domains.coaching.schemas import (
    OfferExercise,
    OfferProgram,
    OfferTemplate,
    PersonSummary,
    ProgramPreview,
    ReceivedOffer,
    ReceivedOfferDetail,
    ReceivedOfferList,
    SentOffer,
    SentOfferDetail,
    SentOfferList,
)
from app.models import (
    CoachAthleteLink,
    Exercise,
    Program,
    ProgramOffer,
    TemplateExercise,
    User,
    WorkoutTemplate,
)

NOTHING_TO_SEND = "Add at least one exercise to the program before sending it."


# ── Snapshot ─────────────────────────────────────────────────────────────


async def _snapshot(db: AsyncSession, program: Program, *, lock: bool) -> OfferProgram:
    """Deep copy of the program with its templates and prescriptions.

    Only what the athlete needs to follow the program: names, order, targets and
    the notes written on the program, its days and its exercises. Workout logs,
    ids of the coach's own rows and anything about the coach are not copied.
    With `lock`, the templates are read under a shared row lock. Every edit of a
    day or its exercises takes that row exclusively, so an edit in progress makes
    this wait and an edit that comes later waits for the send to finish: the copy
    is never half old, half new.
    """
    statement = (
        select(WorkoutTemplate)
        .where(WorkoutTemplate.program_id == program.id)
        .options(selectinload(WorkoutTemplate.exercises).selectinload(TemplateExercise.exercise))
        .order_by(WorkoutTemplate.day_order, WorkoutTemplate.created_at, WorkoutTemplate.id)
    )
    if lock:
        statement = statement.with_for_update(read=True, of=WorkoutTemplate)
    templates = (await db.scalars(statement)).all()
    return OfferProgram(
        name=program.name,
        notes=program.notes,
        templates=[
            OfferTemplate(
                name=template.name,
                day_order=template.day_order,
                notes=template.notes,
                exercises=[
                    OfferExercise(
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
                    for row in sorted(template.exercises, key=lambda r: (r.exercise_order, r.id))
                ],
            )
            for template in templates
        ],
    )


def _counts(program: OfferProgram) -> tuple[int, int]:
    return (len(program.templates), sum(len(t.exercises) for t in program.templates))


async def _unusable_exercises(
    db: AsyncSession, athlete_id: UUID, program: OfferProgram
) -> list[str]:
    """Names of exercises the athlete cannot use: gone, or another user's custom one."""
    wanted = {
        item.exercise_id: item.exercise_name
        for template in program.templates
        for item in template.exercises
    }
    usable = set(
        (
            await db.scalars(
                select(Exercise.id).where(
                    Exercise.id.in_(wanted),
                    (Exercise.created_by.is_(None)) | (Exercise.created_by == athlete_id),
                )
            )
        ).all()
    )
    return sorted({name for exercise_id, name in wanted.items() if exercise_id not in usable})


# ── Coach: send ──────────────────────────────────────────────────────────


def _fingerprint(coach_id: UUID, link_id: UUID, program: OfferProgram, program_id: UUID) -> str:
    """Identifies exactly this content, for this coach, this program and this connection.

    Deterministic, so the preview and the send agree. It is only ever compared with
    what the server rebuilds itself; it is never a way to supply content.
    """
    payload = {
        "coach_id": str(coach_id),
        "link_id": str(link_id),
        "program_id": str(program_id),
        "program": program.model_dump(mode="json"),
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def _request_hash(link_id: UUID, program_id: UUID, fingerprint: str) -> str:
    """The send receipt covers the confirmed content, so a new confirmation is a new request."""
    payload = {"link_id": str(link_id), "program_id": str(program_id), "fingerprint": fingerprint}
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def _sent_detail(offer: ProgramOffer) -> SentOfferDetail:
    program = OfferProgram.model_validate(offer.snapshot)
    templates, exercises = _counts(program)
    return SentOfferDetail(
        id=offer.id,
        status=offer.status,
        program_name=offer.program_name,
        template_count=templates,
        exercise_count=exercises,
        sent_at=offer.created_at,
        responded_at=offer.responded_at,
        program=program,
    )


def _sent_summary(offer: ProgramOffer) -> SentOffer:
    templates, exercises = _counts(OfferProgram.model_validate(offer.snapshot))
    return SentOffer(
        id=offer.id,
        status=offer.status,
        program_name=offer.program_name,
        template_count=templates,
        exercise_count=exercises,
        sent_at=offer.created_at,
        responded_at=offer.responded_at,
    )


async def _active_link_of_coach(
    db: AsyncSession, coach: User, link_id: UUID, *, lock: bool = False
) -> CoachAthleteLink:
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
    return link


async def preview_program(
    db: AsyncSession, coach: User, link_id: UUID, program_id: UUID
) -> ProgramPreview:
    """The exact content a send would offer right now, and the fingerprint that confirms it."""
    service.require_coach(coach)
    link = await _active_link_of_coach(db, coach, link_id)
    program = await db.scalar(
        select(Program).where(Program.id == program_id, Program.user_id == coach.id)
    )
    if program is None:
        raise NotFoundError("Program not found")
    frozen = await _snapshot(db, program, lock=False)
    return ProgramPreview(
        program=frozen, fingerprint=_fingerprint(coach.id, link.id, frozen, program.id)
    )


async def send_offer(
    db: AsyncSession,
    coach: User,
    link_id: UUID,
    request_id: UUID,
    program_id: UUID,
    fingerprint: str,
) -> tuple[SentOfferDetail, bool]:
    """Freeze one of the coach's own programs and offer it. Returns (offer, created).

    The coach confirmed a preview, identified by `fingerprint`. The snapshot is
    rebuilt here, under locks, and sent only if it still matches; otherwise
    nothing is created and the coach must review the new version.

    Repeating the same request returns the same offer even if the program has
    changed since, so a lost response can be retried safely. The same request id
    with different content is refused.
    """
    service.require_coach(coach)
    # Locking the link serialises sends on it and cannot interleave with the end
    # of the connection.
    link = await _active_link_of_coach(db, coach, link_id, lock=True)
    digest = _request_hash(link.id, program_id, fingerprint)

    existing = await db.scalar(
        select(ProgramOffer).where(
            ProgramOffer.coach_id == coach.id, ProgramOffer.request_id == request_id
        )
    )
    if existing is not None:
        if existing.request_hash != digest:
            raise ConflictError("This send request was already used for different content.")
        return _sent_detail(existing), False

    # Ownership is proven by (id, user_id), exactly as the programs endpoints do.
    # The shared lock keeps the program's name and notes (and its deletion) from
    # changing until this send commits; the days are locked in _snapshot.
    program = await db.scalar(
        select(Program)
        .where(Program.id == program_id, Program.user_id == coach.id)
        .with_for_update(read=True)
    )
    if program is None:
        raise NotFoundError("Program not found")

    frozen = await _snapshot(db, program, lock=True)
    # What is stored below is this very object, so what was compared is what is sent.
    if not hmac.compare_digest(fingerprint, _fingerprint(coach.id, link.id, frozen, program.id)):
        raise PreconditionFailedError(
            "This program changed after you reviewed it. Review the updated version and "
            "confirm again."
        )
    if _counts(frozen)[1] == 0:
        raise ValidationAppError(NOTHING_TO_SEND)
    missing = await _unusable_exercises(db, link.athlete_id, frozen)
    if missing:
        raise ValidationAppError(
            "These exercises are not available to the athlete: " + ", ".join(missing)
        )

    waiting = await db.scalar(
        select(ProgramOffer.id).where(
            ProgramOffer.link_id == link.id,
            ProgramOffer.source_program_id == program.id,
            ProgramOffer.status == "pending",
        )
    )
    if waiting is not None:
        raise ConflictError("This program is already waiting for the athlete's answer.")

    offer = ProgramOffer(
        link_id=link.id,
        coach_id=coach.id,
        request_id=request_id,
        request_hash=digest,
        source_program_id=program.id,
        program_name=frozen.name,
        snapshot=frozen.model_dump(mode="json"),
        status="pending",
    )
    db.add(offer)
    await db.commit()
    await db.refresh(offer)
    return _sent_detail(offer), True


async def list_sent(
    db: AsyncSession, coach: User, link_id: UUID, limit: int, offset: int
) -> SentOfferList:
    service.require_coach(coach)
    link = await _active_link_of_coach(db, coach, link_id)
    total = await db.scalar(
        select(func.count()).select_from(ProgramOffer).where(ProgramOffer.link_id == link.id)
    )
    rows = (
        await db.scalars(
            select(ProgramOffer)
            .where(ProgramOffer.link_id == link.id)
            .order_by(ProgramOffer.created_at.desc(), ProgramOffer.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return SentOfferList(
        items=[_sent_summary(row) for row in rows], total=total or 0, limit=limit, offset=offset
    )


# ── Athlete: review, accept, decline ─────────────────────────────────────


def _received(offer: ProgramOffer, coach: User) -> ReceivedOffer:
    templates, exercises = _counts(OfferProgram.model_validate(offer.snapshot))
    return ReceivedOffer(
        id=offer.id,
        status=offer.status,
        program_name=offer.program_name,
        template_count=templates,
        exercise_count=exercises,
        sent_at=offer.created_at,
        responded_at=offer.responded_at,
        coach=PersonSummary.model_validate(coach),
        program_id=offer.accepted_program_id,
    )


def _received_detail(offer: ProgramOffer, coach: User) -> ReceivedOfferDetail:
    return ReceivedOfferDetail(
        **_received(offer, coach).model_dump(),
        program=OfferProgram.model_validate(offer.snapshot),
    )


async def _offer_of_athlete(
    db: AsyncSession, athlete: User, offer_id: UUID
) -> tuple[ProgramOffer, User]:
    """An offer on one of this athlete's ACTIVE connections, or 404."""
    row = (
        await db.execute(
            select(ProgramOffer, User)
            .join(CoachAthleteLink, CoachAthleteLink.id == ProgramOffer.link_id)
            .join(User, User.id == CoachAthleteLink.coach_id)
            .where(
                ProgramOffer.id == offer_id,
                CoachAthleteLink.athlete_id == athlete.id,
                CoachAthleteLink.ended_at.is_(None),
            )
        )
    ).first()
    if row is None:
        raise NotFoundError("Offer not found.")
    return row[0], row[1]


async def list_received(
    db: AsyncSession, athlete: User, limit: int, offset: int
) -> ReceivedOfferList:
    where = (CoachAthleteLink.athlete_id == athlete.id, CoachAthleteLink.ended_at.is_(None))
    total = await db.scalar(
        select(func.count())
        .select_from(ProgramOffer)
        .join(CoachAthleteLink, CoachAthleteLink.id == ProgramOffer.link_id)
        .where(*where)
    )
    rows = (
        await db.execute(
            select(ProgramOffer, User)
            .join(CoachAthleteLink, CoachAthleteLink.id == ProgramOffer.link_id)
            .join(User, User.id == CoachAthleteLink.coach_id)
            .where(*where)
            # Waiting offers first; id breaks ties so paging never repeats a row.
            .order_by(
                case((ProgramOffer.status == "pending", 0), else_=1),
                ProgramOffer.created_at.desc(),
                ProgramOffer.id.desc(),
            )
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return ReceivedOfferList(
        items=[_received(offer, coach) for offer, coach in rows],
        total=total or 0,
        limit=limit,
        offset=offset,
    )


async def get_received(db: AsyncSession, athlete: User, offer_id: UUID) -> ReceivedOfferDetail:
    offer, coach = await _offer_of_athlete(db, athlete, offer_id)
    return _received_detail(offer, coach)


async def _lock_offer(
    db: AsyncSession, athlete: User, offer_id: UUID
) -> tuple[ProgramOffer, User]:
    """Lock the connection, then the offer, and re-read both under the lock."""
    offer, coach = await _offer_of_athlete(db, athlete, offer_id)
    link = await db.scalar(
        select(CoachAthleteLink)
        .where(CoachAthleteLink.id == offer.link_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if link is None or link.ended_at is not None or link.athlete_id != athlete.id:
        raise NotFoundError("Offer not found.")
    locked = await db.scalar(
        select(ProgramOffer)
        .where(ProgramOffer.id == offer.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    assert locked is not None
    return locked, coach


def _copy_template(db: AsyncSession, program: Program, template: OfferTemplate) -> WorkoutTemplate:
    copy = WorkoutTemplate(
        program_id=program.id,
        name=template.name,
        day_order=template.day_order,
        notes=template.notes,
    )
    db.add(copy)
    return copy


async def accept_offer(db: AsyncSession, athlete: User, offer_id: UUID) -> ReceivedOfferDetail:
    """Create the athlete's own, inactive copy. Repeating it returns the same copy."""
    offer, coach = await _lock_offer(db, athlete, offer_id)
    if offer.status == "accepted":
        return _received_detail(offer, coach)
    if offer.status == "declined":
        raise ConflictError("You declined this program. Ask your coach to send it again.")

    frozen = OfferProgram.model_validate(offer.snapshot)
    missing = await _unusable_exercises(db, athlete.id, frozen)
    if missing:
        raise ConflictError(
            "This program uses exercises that are no longer available: "
            + ", ".join(missing)
            + ". Nothing was added. Ask your coach to send an updated program."
        )

    # One transaction: the program, its days, their exercises and the offer's new
    # state commit together or not at all. Inactive, so the athlete's current
    # program stays exactly as it is until they activate this one themselves.
    program = Program(user_id=athlete.id, name=frozen.name, notes=frozen.notes, is_active=False)
    db.add(program)
    await db.flush()
    for template in frozen.templates:
        copy = _copy_template(db, program, template)
        await db.flush()
        for item in template.exercises:
            db.add(
                TemplateExercise(
                    template_id=copy.id,
                    exercise_id=item.exercise_id,
                    exercise_order=item.exercise_order,
                    target_sets=item.target_sets,
                    target_reps_min=item.target_reps_min,
                    target_reps_max=item.target_reps_max,
                    target_rir=item.target_rir,
                    target_rpe=item.target_rpe,
                    notes=item.notes,
                )
            )
    offer.status = "accepted"
    offer.accepted_program_id = program.id
    offer.responded_at = datetime.now(UTC)
    await db.commit()
    return _received_detail(offer, coach)


async def decline_offer(db: AsyncSession, athlete: User, offer_id: UUID) -> ReceivedOfferDetail:
    offer, coach = await _lock_offer(db, athlete, offer_id)
    if offer.status == "accepted":
        raise ConflictError("You already added this program. Delete your copy from Programs.")
    if offer.status == "pending":
        offer.status = "declined"
        offer.responded_at = datetime.now(UTC)
        await db.commit()
    return _received_detail(offer, coach)
