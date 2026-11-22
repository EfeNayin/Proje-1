"""A coach sends a program; the athlete decides whether to keep a copy.

Nothing here lets a coach touch an athlete's programs. Sending stores a frozen
snapshot as an *offer* tied to one connection. Accepting copies that snapshot
into a new program the athlete owns; from then on the copy is the athlete's
alone and nothing keeps it in sync with the coach's original.

Two kinds of offer share this machinery:

- LEGACY standalone offers (lineage_id NULL): one of the coach's own programs,
  sent once. Accepting adds an inactive copy. Unchanged.
- VERSIONS of a prepared program (see `lineages.py`): numbered, immutable, one
  waiting at a time; publishing a newer one marks the waiting one superseded.
  The first accepted version adds an inactive copy like any other. A later one
  adds a new independent copy and, only if the copy of the previously accepted
  version is the athlete's active program at that moment, makes the new copy
  active in its place (the old copy and its personal edits are kept untouched).

Rules that hold the design together:

- Every request re-reads the connection. An offer is only reachable through an
  active link, so ending the link makes pending offers unavailable at once, and
  a reconnection is a new link that cannot see the old link's offers.
- Accept and decline lock the link row first (the same row `end_link` locks and
  publishing locks), then the offer. A request that was already in flight when
  the connection ended, or when a newer version was published, waits, sees it,
  and is refused; two accepts of one offer take turns, and the second finds the
  first one's copy.
- Changing which program is active takes the per-user lock of
  `programs.service.lock_active_program` before touching any program row, as
  every other activation, deletion and creation does.
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
    AcceptanceEffect,
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
from app.domains.programs import service as programs_service
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


async def snapshot_program(db: AsyncSession, program: Program, *, lock: bool) -> OfferProgram:
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


def counts(program: OfferProgram) -> tuple[int, int]:
    return (len(program.templates), sum(len(t.exercises) for t in program.templates))


async def unusable_exercises(
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


def fingerprint_for(
    coach_id: UUID,
    link_id: UUID,
    program: OfferProgram,
    program_id: UUID,
    *,
    lineage_id: UUID | None = None,
    version: int | None = None,
) -> str:
    """Identifies exactly this content, for this coach, this program and this connection.

    Deterministic, so the preview and the send agree. It is only ever compared with
    what the server rebuilds itself; it is never a way to supply content. For a
    prepared program it also names the lineage and the version number this
    publication would get, so a preview goes stale when someone else publishes in
    between. Legacy sends hash exactly what they always did.
    """
    payload: dict[str, object] = {
        "coach_id": str(coach_id),
        "link_id": str(link_id),
        "program_id": str(program_id),
        "program": program.model_dump(mode="json"),
    }
    if lineage_id is not None:
        payload["lineage_id"] = str(lineage_id)
        payload["version"] = version
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def request_hash(link_id: UUID, program_id: UUID, fingerprint: str) -> str:
    """The send receipt covers the confirmed content, so a new confirmation is a new request."""
    payload = {"link_id": str(link_id), "program_id": str(program_id), "fingerprint": fingerprint}
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def sent_detail(offer: ProgramOffer) -> SentOfferDetail:
    program = OfferProgram.model_validate(offer.snapshot)
    templates, exercises = counts(program)
    return SentOfferDetail(
        id=offer.id,
        status=offer.status,
        program_name=offer.program_name,
        template_count=templates,
        exercise_count=exercises,
        sent_at=offer.created_at,
        responded_at=offer.responded_at,
        version=offer.version,
        superseded_at=offer.superseded_at,
        lineage_id=offer.lineage_id,
        program=program,
    )


def sent_summary(offer: ProgramOffer) -> SentOffer:
    templates, exercises = counts(OfferProgram.model_validate(offer.snapshot))
    return SentOffer(
        id=offer.id,
        status=offer.status,
        program_name=offer.program_name,
        template_count=templates,
        exercise_count=exercises,
        sent_at=offer.created_at,
        responded_at=offer.responded_at,
        version=offer.version,
        superseded_at=offer.superseded_at,
        lineage_id=offer.lineage_id,
    )


async def active_link_of_coach(
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


async def _refuse_prepared_program(db: AsyncSession, program_id: UUID) -> None:
    """A preparation is published as numbered versions, never through the standalone send."""
    if await programs_service.prepared_for(db, program_id) is not None:
        raise ConflictError(
            "This program is being prepared for an athlete. Publish it from Program management."
        )


async def preview_program(
    db: AsyncSession, coach: User, link_id: UUID, program_id: UUID
) -> ProgramPreview:
    """The exact content a send would offer right now, and the fingerprint that confirms it."""
    service.require_coach(coach)
    link = await active_link_of_coach(db, coach, link_id)
    program = await db.scalar(
        select(Program).where(Program.id == program_id, Program.user_id == coach.id)
    )
    if program is None:
        raise NotFoundError("Program not found")
    await _refuse_prepared_program(db, program.id)
    frozen = await snapshot_program(db, program, lock=False)
    return ProgramPreview(
        program=frozen, fingerprint=fingerprint_for(coach.id, link.id, frozen, program.id)
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
    link = await active_link_of_coach(db, coach, link_id, lock=True)
    digest = request_hash(link.id, program_id, fingerprint)

    existing = await db.scalar(
        select(ProgramOffer).where(
            ProgramOffer.coach_id == coach.id, ProgramOffer.request_id == request_id
        )
    )
    if existing is not None:
        if existing.request_hash != digest:
            raise ConflictError("This send request was already used for different content.")
        return sent_detail(existing), False

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
    await _refuse_prepared_program(db, program.id)

    frozen = await snapshot_program(db, program, lock=True)
    # What is stored below is this very object, so what was compared is what is sent.
    if not hmac.compare_digest(fingerprint, fingerprint_for(coach.id, link.id, frozen, program.id)):
        raise PreconditionFailedError(
            "This program changed after you reviewed it. Review the updated version and "
            "confirm again."
        )
    if counts(frozen)[1] == 0:
        raise ValidationAppError(NOTHING_TO_SEND)
    missing = await unusable_exercises(db, link.athlete_id, frozen)
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
    return sent_detail(offer), True


async def list_sent(
    db: AsyncSession, coach: User, link_id: UUID, limit: int, offset: int
) -> SentOfferList:
    service.require_coach(coach)
    link = await active_link_of_coach(db, coach, link_id)
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
        items=[sent_summary(row) for row in rows], total=total or 0, limit=limit, offset=offset
    )


# ── Athlete: review, accept, decline ─────────────────────────────────────


def _received(offer: ProgramOffer, coach: User) -> ReceivedOffer:
    templates, exercises = counts(OfferProgram.model_validate(offer.snapshot))
    return ReceivedOffer(
        id=offer.id,
        status=offer.status,
        program_name=offer.program_name,
        template_count=templates,
        exercise_count=exercises,
        sent_at=offer.created_at,
        responded_at=offer.responded_at,
        version=offer.version,
        superseded_at=offer.superseded_at,
        coach=PersonSummary.model_validate(coach),
        program_id=offer.accepted_program_id,
        activated=bool(offer.activated_on_accept) if offer.status == "accepted" else None,
    )


def _received_detail(
    offer: ProgramOffer, coach: User, acceptance: AcceptanceEffect | None = None
) -> ReceivedOfferDetail:
    return ReceivedOfferDetail(
        **_received(offer, coach).model_dump(),
        program=OfferProgram.model_validate(offer.snapshot),
        acceptance=acceptance,
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


async def _preceding_copy(
    db: AsyncSession, offer: ProgramOffer, athlete_id: UUID, *, lock: bool
) -> tuple[ProgramOffer, Program] | None:
    """The copy of the latest EARLIER accepted version of this lineage, if the athlete still has it.

    None for a legacy offer, for the first version, when no earlier version was
    accepted, or when the athlete deleted that copy (the offer then has no
    accepted_program_id). Nothing is ever inferred from names or content.
    """
    if offer.lineage_id is None or offer.version is None:
        return None
    previous = await db.scalar(
        select(ProgramOffer)
        .where(
            ProgramOffer.lineage_id == offer.lineage_id,
            ProgramOffer.status == "accepted",
            ProgramOffer.version < offer.version,
        )
        .order_by(ProgramOffer.version.desc())
        .limit(1)
        .execution_options(populate_existing=True)
    )
    if previous is None or previous.accepted_program_id is None:
        return None
    statement = select(Program).where(
        Program.id == previous.accepted_program_id, Program.user_id == athlete_id
    )
    if lock:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    copy = await db.scalar(statement)
    return None if copy is None else (previous, copy)


async def _acceptance_effect(
    db: AsyncSession, athlete: User, offer: ProgramOffer
) -> AcceptanceEffect:
    preceding = await _preceding_copy(db, offer, athlete.id, lock=False)
    if preceding is not None and preceding[1].is_active:
        return AcceptanceEffect(
            kind="replaces_active_copy",
            replaces_version=preceding[0].version,
            replaces_program_name=preceding[1].name,
        )
    active_name = await db.scalar(
        select(Program.name).where(Program.user_id == athlete.id, Program.is_active.is_(True))
    )
    return AcceptanceEffect(kind="inactive_copy", keeps_active_program_name=active_name)


async def get_received(db: AsyncSession, athlete: User, offer_id: UUID) -> ReceivedOfferDetail:
    offer, coach = await _offer_of_athlete(db, athlete, offer_id)
    effect = await _acceptance_effect(db, athlete, offer) if offer.status == "pending" else None
    return _received_detail(offer, coach, effect)


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


async def materialize_program(
    db: AsyncSession, owner_id: UUID, frozen: OfferProgram, *, active: bool
) -> Program:
    """Create a brand-new program (days and prescriptions included) from a frozen one.

    The single place a program is built from a snapshot: accepting an offer and
    starting a preparation from one of the coach's programs both use it, so the
    copy is always independent of its source. Flushed, not committed; the caller
    decides what else belongs in the transaction, and that the unique "one active
    program" index can only be satisfied when `active` is set after whatever was
    active has been deactivated.
    """
    program = Program(user_id=owner_id, name=frozen.name, notes=frozen.notes, is_active=active)
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
    await db.flush()
    return program


async def accept_offer(db: AsyncSession, athlete: User, offer_id: UUID) -> ReceivedOfferDetail:
    """Create the athlete's own copy. Repeating it returns the same result.

    The copy is inactive, except for one case: an offer that is a later version
    of a prepared program, whose previously accepted copy is still the athlete's
    active program right now. That copy is then deactivated (kept, with every
    personal edit) and the new one takes its place, in the same transaction.
    """
    offer, coach = await _lock_offer(db, athlete, offer_id)
    if offer.status == "accepted":
        return _received_detail(offer, coach)
    if offer.status == "declined":
        raise ConflictError("You declined this program. Ask your coach to send it again.")
    if offer.status == "superseded":
        raise ConflictError(
            "Your coach published a newer version, so this one can no longer be accepted. "
            "Open the latest version instead."
        )

    frozen = OfferProgram.model_validate(offer.snapshot)
    missing = await unusable_exercises(db, athlete.id, frozen)
    if missing:
        raise ConflictError(
            "This program uses exercises that are no longer available: "
            + ", ".join(missing)
            + ". Nothing was added. Ask your coach to send an updated program."
        )

    # One transaction: the program, its days, their exercises, the change of the
    # active program (if any) and the offer's new state commit together or not at all.
    activates = False
    if offer.lineage_id is not None:
        # Same lock every activation, deletion and creation takes, so whether the
        # previous copy is still active cannot change between this check and the commit.
        await programs_service.lock_active_program(db, athlete.id)
        preceding = await _preceding_copy(db, offer, athlete.id, lock=True)
        if preceding is not None and preceding[1].is_active:
            preceding[1].is_active = False
            # The unique "one active program" index must see the old one off first.
            await db.flush()
            activates = True
    program = await materialize_program(db, athlete.id, frozen, active=activates)
    offer.status = "accepted"
    offer.accepted_program_id = program.id
    offer.activated_on_accept = activates
    offer.responded_at = datetime.now(UTC)
    await db.commit()
    return _received_detail(offer, coach)


async def decline_offer(db: AsyncSession, athlete: User, offer_id: UUID) -> ReceivedOfferDetail:
    offer, coach = await _lock_offer(db, athlete, offer_id)
    if offer.status == "accepted":
        raise ConflictError("You already added this program. Delete your copy from Programs.")
    if offer.status == "superseded":
        raise ConflictError("Your coach already replaced this version with a newer one.")
    if offer.status == "pending":
        offer.status = "declined"
        offer.responded_at = datetime.now(UTC)
        await db.commit()
    return _received_detail(offer, coach)
