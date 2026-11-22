"""A coach prepares a program for ONE connected athlete and publishes it in versions.

Builds on `offers.py`; it adds no second way to snapshot, copy or send:

- The coach's preparation is an ordinary program they own (the lineage's *draft*),
  created inactive so their own active program is never touched, and edited with
  the normal program endpoints. Starting one from an existing program copies it
  through `materialize_program`, the same code accepting an offer uses, so the two
  share nothing afterwards.
- Publishing freezes the draft into a ProgramOffer with the next version number,
  using the same snapshot, fingerprint, receipt and validation as a standalone
  send. Versions never change; a later edit of the draft only affects the next one.
- Every request on a lineage locks the connection row first. That serialises
  publishing, discarding, acceptance (which takes the same lock) and the end of
  the connection, so a version can never be published on, or accepted through,
  a connection that has ended, and two publications take turns.
"""

import hashlib
import hmac
import json
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    ConflictError,
    NotFoundError,
    PreconditionFailedError,
    ValidationAppError,
)
from app.domains.coaching import offers, service
from app.domains.coaching.schemas import (
    LineageCreate,
    LineageDetail,
    LineageList,
    LineagePreview,
    LineageSummary,
    OfferProgram,
    PersonSummary,
    SentOfferDetail,
)
from app.domains.programs import service as programs_service
from app.models import CoachAthleteLink, Program, ProgramLineage, ProgramOffer, User

# A coach has a handful of athletes and a handful of programs per athlete; the cap
# only stops an unbounded pile of drafts on one connection.
MAX_LINEAGES_PER_LINK = 10
NOT_FOUND = "Program preparation not found."


def _create_hash(link_id: UUID, name: str | None, from_program_id: UUID | None) -> str:
    payload = {
        "link_id": str(link_id),
        "name": name,
        "from_program_id": None if from_program_id is None else str(from_program_id),
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def _publish_hash(link_id: UUID, lineage_id: UUID, fingerprint: str) -> str:
    """The receipt of a publication covers the confirmed content and its lineage."""
    payload = {"link_id": str(link_id), "lineage_id": str(lineage_id), "fingerprint": fingerprint}
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


async def _load_lineage(
    db: AsyncSession, coach: User, link: CoachAthleteLink, lineage_id: UUID
) -> ProgramLineage:
    """A lineage of this coach on this (already verified, active) connection, or 404."""
    lineage = await db.scalar(
        select(ProgramLineage).where(
            ProgramLineage.id == lineage_id,
            ProgramLineage.link_id == link.id,
            ProgramLineage.coach_id == coach.id,
        )
    )
    if lineage is None:
        raise NotFoundError(NOT_FOUND)
    return lineage


async def _athlete(db: AsyncSession, link: CoachAthleteLink) -> PersonSummary:
    person = await db.get(User, link.athlete_id)
    assert person is not None
    return PersonSummary.model_validate(person)


async def _versions(db: AsyncSession, lineage_id: UUID) -> list[ProgramOffer]:
    """Every published version, newest first."""
    return list(
        (
            await db.scalars(
                select(ProgramOffer)
                .where(ProgramOffer.lineage_id == lineage_id)
                .order_by(ProgramOffer.version.desc())
                .execution_options(populate_existing=True)
            )
        ).all()
    )


async def _draft(db: AsyncSession, lineage: ProgramLineage) -> Program:
    draft = await db.scalar(
        select(Program).where(
            Program.id == lineage.draft_program_id, Program.user_id == lineage.coach_id
        )
    )
    if draft is None:  # only a lineage of an ended connection can lack one, and none reaches here
        raise NotFoundError(NOT_FOUND)
    return draft


def _summary(
    lineage: ProgramLineage, draft: Program, athlete: PersonSummary, versions: list[ProgramOffer]
) -> LineageSummary:
    latest = versions[0] if versions else None
    waiting = next((offer for offer in versions if offer.status == "pending"), None)
    return LineageSummary(
        id=lineage.id,
        draft_program_id=draft.id,
        name=draft.name,
        athlete=athlete,
        created_at=lineage.created_at,
        latest_version=None if latest is None else latest.version,
        latest_status=None if latest is None else latest.status,
        pending_version=None if waiting is None else waiting.version,
    )


async def _detail(
    db: AsyncSession, lineage: ProgramLineage, link: CoachAthleteLink
) -> LineageDetail:
    draft = await _draft(db, lineage)
    versions = await _versions(db, lineage.id)
    current = await offers.snapshot_program(db, draft, lock=False)
    unchanged = bool(versions) and current == OfferProgram.model_validate(versions[0].snapshot)
    return LineageDetail(
        **_summary(lineage, draft, await _athlete(db, link), versions).model_dump(),
        has_unpublished_changes=not unchanged,
        versions=[offers.sent_summary(offer) for offer in versions],
    )


# ── Create, list, read, discard ──────────────────────────────────────────


async def create_lineage(
    db: AsyncSession,
    coach: User,
    link_id: UUID,
    request_id: UUID,
    payload: LineageCreate,
) -> tuple[LineageDetail, bool]:
    """Start a preparation for this athlete. Returns (detail, created).

    From scratch it is an empty, inactive program. From `from_program_id` it is an
    independent copy of one of the coach's own programs (not of another
    preparation); that program is not changed and does not stay linked. Either
    way the coach's own active program is untouched. Repeating the same request
    returns the same preparation; the same id with other details is refused.
    """
    service.require_coach(coach)
    link = await offers.active_link_of_coach(db, coach, link_id, lock=True)
    digest = _create_hash(link.id, payload.name, payload.from_program_id)

    existing = await db.scalar(
        select(ProgramLineage).where(
            ProgramLineage.coach_id == coach.id, ProgramLineage.create_request_id == request_id
        )
    )
    if existing is not None:
        if existing.create_hash != digest:
            raise ConflictError("This request was already used for a different preparation.")
        return await _detail(db, existing, link), False

    count = await db.scalar(
        select(func.count()).select_from(ProgramLineage).where(ProgramLineage.link_id == link.id)
    )
    if (count or 0) >= MAX_LINEAGES_PER_LINK:
        raise ConflictError(
            f"You can prepare at most {MAX_LINEAGES_PER_LINK} programs for one athlete."
        )

    if payload.from_program_id is not None:
        source = await db.scalar(
            select(Program)
            .where(Program.id == payload.from_program_id, Program.user_id == coach.id)
            .with_for_update(read=True)
        )
        if source is None:
            raise NotFoundError("Program not found")
        if await programs_service.prepared_for(db, source.id) is not None:
            raise ConflictError("Choose one of your own programs, not another preparation.")
        frozen = await offers.snapshot_program(db, source, lock=True)
        if payload.name is not None:
            frozen = frozen.model_copy(update={"name": payload.name})
    else:
        assert payload.name is not None
        frozen = OfferProgram(name=payload.name, notes=None, templates=[])

    # Inactive on purpose: the generic create-program operation activates by default,
    # which would silently replace the coach's own active program.
    draft = await offers.materialize_program(db, coach.id, frozen, active=False)
    lineage = ProgramLineage(
        link_id=link.id,
        coach_id=coach.id,
        draft_program_id=draft.id,
        create_request_id=request_id,
        create_hash=digest,
    )
    db.add(lineage)
    await db.commit()
    await db.refresh(lineage)
    return await _detail(db, lineage, link), True


async def list_lineages(db: AsyncSession, coach: User, link_id: UUID) -> LineageList:
    service.require_coach(coach)
    link = await offers.active_link_of_coach(db, coach, link_id)
    athlete = await _athlete(db, link)
    rows = (
        await db.execute(
            select(ProgramLineage, Program)
            .join(Program, Program.id == ProgramLineage.draft_program_id)
            .where(ProgramLineage.link_id == link.id, ProgramLineage.coach_id == coach.id)
            .order_by(ProgramLineage.created_at.desc(), ProgramLineage.id.desc())
        )
    ).all()
    items = [
        _summary(lineage, draft, athlete, await _versions(db, lineage.id))
        for lineage, draft in rows
    ]
    return LineageList(items=items)


async def get_lineage(
    db: AsyncSession, coach: User, link_id: UUID, lineage_id: UUID
) -> LineageDetail:
    service.require_coach(coach)
    link = await offers.active_link_of_coach(db, coach, link_id)
    return await _detail(db, await _load_lineage(db, coach, link, lineage_id), link)


async def get_version(
    db: AsyncSession, coach: User, link_id: UUID, lineage_id: UUID, version: int
) -> SentOfferDetail:
    """One published version with its complete prescriptions, exactly as sent."""
    service.require_coach(coach)
    link = await offers.active_link_of_coach(db, coach, link_id)
    lineage = await _load_lineage(db, coach, link, lineage_id)
    offer = await db.scalar(
        select(ProgramOffer).where(
            ProgramOffer.lineage_id == lineage.id, ProgramOffer.version == version
        )
    )
    if offer is None:
        raise NotFoundError("Version not found.")
    return offers.sent_detail(offer)


async def discard_lineage(db: AsyncSession, coach: User, link_id: UUID, lineage_id: UUID) -> None:
    """Delete a preparation that was never published. Published ones are history and stay."""
    service.require_coach(coach)
    link = await offers.active_link_of_coach(db, coach, link_id, lock=True)
    lineage = await _load_lineage(db, coach, link, lineage_id)
    published = await db.scalar(
        select(ProgramOffer.id).where(ProgramOffer.lineage_id == lineage.id).limit(1)
    )
    if published is not None:
        raise ConflictError("This preparation was already published to the athlete.")
    draft = await _draft(db, lineage)
    await db.delete(lineage)
    await db.delete(draft)
    await db.commit()


# ── Publish ──────────────────────────────────────────────────────────────


async def _next_version(db: AsyncSession, lineage_id: UUID) -> tuple[int, ProgramOffer | None]:
    """The number the next publication gets, and the version it would replace."""
    top = await db.scalar(
        select(func.max(ProgramOffer.version)).where(ProgramOffer.lineage_id == lineage_id)
    )
    waiting = await db.scalar(
        select(ProgramOffer)
        .where(ProgramOffer.lineage_id == lineage_id, ProgramOffer.status == "pending")
        .execution_options(populate_existing=True)
    )
    return (top or 0) + 1, waiting


async def preview_version(
    db: AsyncSession, coach: User, link_id: UUID, lineage_id: UUID
) -> LineagePreview:
    """The exact content publishing would send right now, the number it would get,
    and the waiting version it would replace, with the fingerprint that confirms it."""
    service.require_coach(coach)
    link = await offers.active_link_of_coach(db, coach, link_id)
    lineage = await _load_lineage(db, coach, link, lineage_id)
    draft = await _draft(db, lineage)
    frozen = await offers.snapshot_program(db, draft, lock=False)
    version, waiting = await _next_version(db, lineage.id)
    return LineagePreview(
        program=frozen,
        fingerprint=offers.fingerprint_for(
            coach.id, link.id, frozen, draft.id, lineage_id=lineage.id, version=version
        ),
        lineage_id=lineage.id,
        athlete=await _athlete(db, link),
        version=version,
        replaces_version=None if waiting is None else waiting.version,
    )


async def publish_version(
    db: AsyncSession,
    coach: User,
    link_id: UUID,
    lineage_id: UUID,
    request_id: UUID,
    fingerprint: str,
) -> tuple[SentOfferDetail, bool]:
    """Freeze the draft as the next version and offer it. Returns (offer, created).

    The coach confirmed a preview identified by `fingerprint`, which names the
    content AND the version number. The snapshot and the number are rebuilt here,
    under locks, and published only if they still match; otherwise nothing is
    created and the coach reviews the new preview. A waiting version is marked
    superseded in the same transaction, so it can never be accepted afterwards.

    Repeating the same request returns the same version even if the draft or the
    lineage has moved on, so a lost response can be retried safely.
    """
    service.require_coach(coach)
    link = await offers.active_link_of_coach(db, coach, link_id, lock=True)
    lineage = await _load_lineage(db, coach, link, lineage_id)
    digest = _publish_hash(link.id, lineage.id, fingerprint)

    existing = await db.scalar(
        select(ProgramOffer).where(
            ProgramOffer.coach_id == coach.id, ProgramOffer.request_id == request_id
        )
    )
    if existing is not None:
        if existing.request_hash != digest:
            raise ConflictError("This publish request was already used for different content.")
        return offers.sent_detail(existing), False

    draft = await db.scalar(
        select(Program)
        .where(Program.id == lineage.draft_program_id, Program.user_id == coach.id)
        .with_for_update(read=True)
    )
    if draft is None:
        raise NotFoundError(NOT_FOUND)
    frozen = await offers.snapshot_program(db, draft, lock=True)
    version, waiting = await _next_version(db, lineage.id)
    expected = offers.fingerprint_for(
        coach.id, link.id, frozen, draft.id, lineage_id=lineage.id, version=version
    )
    if not hmac.compare_digest(fingerprint, expected):
        raise PreconditionFailedError(
            "This preparation changed after you reviewed it. Review the updated version and "
            "confirm again."
        )
    if offers.counts(frozen)[1] == 0:
        raise ValidationAppError(offers.NOTHING_TO_SEND)
    missing = await offers.unusable_exercises(db, link.athlete_id, frozen)
    if missing:
        raise ValidationAppError(
            "These exercises are not available to the athlete: " + ", ".join(missing)
        )

    if waiting is not None:
        waiting.status = "superseded"
        waiting.superseded_at = datetime.now(UTC)
        # Before the insert: only one version per lineage may be pending at a time.
        await db.flush()
    offer = ProgramOffer(
        link_id=link.id,
        coach_id=coach.id,
        request_id=request_id,
        request_hash=digest,
        source_program_id=draft.id,
        program_name=frozen.name,
        snapshot=frozen.model_dump(mode="json"),
        status="pending",
        lineage_id=lineage.id,
        version=version,
    )
    db.add(offer)
    await db.commit()
    await db.refresh(offer)
    return offers.sent_detail(offer), True
