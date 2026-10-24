"""Coach mode, invites and coach-athlete links.

This layer knows nothing about HTTP. Authorisation lives here, not in the
client: every function takes the caller from the session and decides from the
database who may do what.
"""

import re
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    ConflictError,
    ForbiddenError,
    GoneError,
    NotFoundError,
    ValidationAppError,
)
from app.core.security import hash_token
from app.domains.coaching.ratelimit import invite_code_limiter
from app.models import CoachAthleteLink, CoachInvite, User

INVITE_TTL = timedelta(hours=48)
MAX_OPEN_INVITES = 10

# 32 symbols without the look-alikes 0/O and 1/I: 12 of them are 60 bits.
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_CODE_LENGTH = 12

INVALID_CODE = "This invite code is not valid."
EXPIRED_CODE = "This invite code has expired."
USED_CODE = "This invite code has already been used."


def _generate_code() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(_CODE_LENGTH))


def format_code(code: str) -> str:
    return "-".join(code[i : i + 4] for i in range(0, len(code), 4))


def normalize_code(raw: str) -> str | None:
    """Canonical form of what the user typed, or None if it cannot be a code."""
    cleaned = re.sub(r"[^A-Za-z0-9]", "", raw).upper()
    if len(cleaned) != _CODE_LENGTH or any(char not in _ALPHABET for char in cleaned):
        return None
    return cleaned


def require_coach(user: User) -> None:
    if not user.coach_enabled:
        raise ForbiddenError("Turn on coach tools first.")


async def enable_coach_mode(db: AsyncSession, user: User) -> User:
    """Idempotent. Adds the coach tools; changes nothing about the account's own data."""
    if not user.coach_enabled:
        user.coach_enabled = True
        await db.commit()
        await db.refresh(user)
    return user


async def create_invite(db: AsyncSession, coach: User) -> tuple[CoachInvite, str]:
    require_coach(coach)

    # Keep the number of live codes bounded. A lost response leaves a code the
    # coach never saw, so instead of refusing a new one, retire the oldest.
    open_invites = list(
        (
            await db.scalars(
                select(CoachInvite)
                .where(
                    CoachInvite.coach_id == coach.id,
                    CoachInvite.accepted_at.is_(None),
                    CoachInvite.expires_at > func.now(),
                )
                .order_by(CoachInvite.created_at.desc())
            )
        ).all()
    )
    for stale in open_invites[MAX_OPEN_INVITES - 1 :]:
        stale.expires_at = datetime.now(UTC)

    code = _generate_code()
    invite = CoachInvite(
        coach_id=coach.id,
        code_hash=hash_token(code),
        expires_at=datetime.now(UTC) + INVITE_TTL,
    )
    db.add(invite)
    await db.commit()
    await db.refresh(invite)
    return invite, format_code(code)


async def _find_invite(db: AsyncSession, caller: User, raw_code: str) -> CoachInvite:
    """Look a typed code up. Wrong guesses are counted against the caller."""
    invite_code_limiter.begin(caller.id)
    code = normalize_code(raw_code)
    invite = None
    if code is not None:
        invite = await db.scalar(
            select(CoachInvite)
            .where(CoachInvite.code_hash == hash_token(code))
            .execution_options(populate_existing=True)
        )
    if invite is None:
        raise NotFoundError(INVALID_CODE)
    invite_code_limiter.forgive(caller.id)
    return invite


async def _active_link(
    db: AsyncSession, coach_id: UUID, athlete_id: UUID
) -> CoachAthleteLink | None:
    link: CoachAthleteLink | None = await db.scalar(
        select(CoachAthleteLink).where(
            CoachAthleteLink.coach_id == coach_id,
            CoachAthleteLink.athlete_id == athlete_id,
            CoachAthleteLink.ended_at.is_(None),
        )
    )
    return link


async def preview_invite(db: AsyncSession, athlete: User, raw_code: str) -> tuple[User, datetime]:
    invite = await _find_invite(db, athlete, raw_code)
    if invite.coach_id == athlete.id:
        raise ValidationAppError("You cannot connect to yourself.")
    if invite.accepted_at is not None:
        raise ConflictError(USED_CODE)
    if invite.expires_at <= datetime.now(UTC):
        raise GoneError(EXPIRED_CODE)
    coach = await db.get(User, invite.coach_id)
    assert coach is not None  # FK with ON DELETE CASCADE: no coach, no invite
    return coach, invite.expires_at


async def _repeat_accept(
    db: AsyncSession, invite: CoachInvite, athlete_id: UUID
) -> tuple[CoachAthleteLink, User, bool]:
    """The invite is already accepted: succeed only for the same athlete's live link.

    A retry after a lost response lands here and gets the link it created. If
    that link has since been ended, the old code must not bring it back.
    """
    if invite.accepted_by_id == athlete_id:
        link = await db.scalar(
            select(CoachAthleteLink).where(CoachAthleteLink.invite_id == invite.id)
        )
        if link is not None and link.ended_at is None:
            coach = await db.get(User, link.coach_id)
            assert coach is not None
            return link, coach, False
    raise ConflictError(USED_CODE)


async def accept_invite(
    db: AsyncSession, athlete: User, raw_code: str
) -> tuple[CoachAthleteLink, User, bool]:
    """Returns (link, coach, created). `created` is False for an idempotent repeat."""
    # Plain values, read before any rollback: a rollback expires every loaded
    # object, and touching an expired attribute in async code would fail.
    athlete_id = athlete.id
    invite = await _find_invite(db, athlete, raw_code)
    invite_id, coach_id = invite.id, invite.coach_id
    if coach_id == athlete_id:
        raise ValidationAppError("You cannot connect to yourself.")
    if invite.accepted_at is not None:
        return await _repeat_accept(db, invite, athlete_id)
    if invite.expires_at <= datetime.now(UTC):
        raise GoneError(EXPIRED_CODE)
    if await _active_link(db, coach_id, athlete_id) is not None:
        # Checked before the code is spent, so it stays usable for someone else.
        raise ConflictError("You are already connected to this coach.")

    # The single-use rule: only one concurrent request can flip accepted_at
    # from NULL; the others match no row and fall through to the re-read below.
    claimed = await db.scalar(
        update(CoachInvite)
        .where(
            CoachInvite.id == invite_id,
            CoachInvite.accepted_at.is_(None),
            CoachInvite.expires_at > func.now(),
        )
        .values(accepted_at=func.now(), accepted_by_id=athlete_id)
        .returning(CoachInvite.id)
    )
    if claimed is None:
        # Lost the race (or it expired in the meantime): read what happened.
        current = await db.scalar(
            select(CoachInvite)
            .where(CoachInvite.id == invite_id)
            .execution_options(populate_existing=True)
        )
        assert current is not None
        if current.accepted_at is not None:
            return await _repeat_accept(db, current, athlete_id)
        raise GoneError(EXPIRED_CODE)

    link = CoachAthleteLink(coach_id=coach_id, athlete_id=athlete_id, invite_id=invite_id)
    db.add(link)
    try:
        await db.flush()
    except IntegrityError:
        # Another invite from the same coach connected this athlete a moment
        # ago. Undo the claim too, so this code is not wasted.
        await db.rollback()
        raise ConflictError("You are already connected to this coach.") from None
    await db.commit()
    await db.refresh(link)
    coach = await db.get(User, link.coach_id)
    assert coach is not None
    return link, coach, True


async def list_athletes(db: AsyncSession, coach: User) -> list[tuple[CoachAthleteLink, User]]:
    require_coach(coach)
    rows = await db.execute(
        select(CoachAthleteLink, User)
        .join(User, User.id == CoachAthleteLink.athlete_id)
        .where(CoachAthleteLink.coach_id == coach.id, CoachAthleteLink.ended_at.is_(None))
        .order_by(CoachAthleteLink.created_at.desc(), CoachAthleteLink.id)
    )
    return [(link, person) for link, person in rows.all()]


async def list_coaches(db: AsyncSession, athlete: User) -> list[tuple[CoachAthleteLink, User]]:
    rows = await db.execute(
        select(CoachAthleteLink, User)
        .join(User, User.id == CoachAthleteLink.coach_id)
        .where(CoachAthleteLink.athlete_id == athlete.id, CoachAthleteLink.ended_at.is_(None))
        .order_by(CoachAthleteLink.created_at.desc(), CoachAthleteLink.id)
    )
    return [(link, person) for link, person in rows.all()]


async def end_link(db: AsyncSession, user: User, link_id: UUID) -> None:
    """Either side may end a link. Idempotent; a stranger just gets a 404."""
    link = await db.scalar(
        select(CoachAthleteLink).where(CoachAthleteLink.id == link_id).with_for_update()
    )
    if link is None or user.id not in (link.coach_id, link.athlete_id):
        raise NotFoundError("Connection not found.")
    if link.ended_at is None:
        link.ended_at = datetime.now(UTC)
        link.ended_by_id = user.id
        await db.commit()
