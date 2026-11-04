"""Deleting an account for good.

This is erasure, not deactivation: the user row and everything the account owns are
removed, in one transaction, after the current password was checked again.

Ownership policy: what is deleted, what stays, and why
------------------------------------------------------
Records are judged by who they belong to, not by which foreign key happens to point at
the user. Every reference to `users` was audited (tests/test_account_deletion.py fails
if a new one appears without a decision here).

Deleted with the account (it owns them):
  * the profile row, nutrition goals and preferences; refresh sessions; the account's
    outstanding password-recovery code (a keyed hash, never the code);
  * workouts, their sets, pending-write receipts and plan snapshots;
  * readiness logs and body measurements;
  * programs, days, exercises-in-days and template-save receipts (a coach's own
    programs, and an athlete's accepted copies, are both "programs the account owns");
  * the coach's invites, and invites the account used to connect;
  * every connection the account is part of (as coach or as athlete), with what hangs
    off it: program offers and their snapshots, prepared-program lineages (all
    versions), and workout feedback written on that connection.

Kept, because another person owns it:
  * the other party's accounts, sessions, workouts, readings and body data;
  * an athlete's accepted copies of a deleted coach's programs, and the athlete's
    workouts, including ones started from those copies. They are the athlete's
    independent records (that is how accepting works). No coach id, name or link
    remains on them. Free text the coach wrote inside the program (names, notes) is
    part of the copy and stays as written: it is not scanned or rewritten, so if the
    coach typed identifying words into it they remain.
  * a coach's own programs when an *athlete* is deleted, including the draft that was
    prepared for them. The draft was only hidden from the coach's list because the
    connection existed; with the connection gone it is an ordinary, inactive program
    of the coach's, exactly as after an ended connection. Nothing in the database
    ties it to the deleted athlete any more (its name is whatever the coach typed).
  * the shared exercise catalogue. An exercise a deleted user created stays (other
    people's records may use it) and only loses its creator (`created_by` -> NULL).

Conflicts between ownership and retention, decided explicitly:
  * Feedback a deleted coach wrote on an athlete's workouts is deleted with the coach
    (it is the coach's own words), although the athlete's workouts stay.
  * Offers a deleted coach had sent, including ones the athlete had not answered, are
    deleted: nothing actionable is left that points at an account that no longer
    exists. The athlete's accepted copies are not offers and stay.
  * When an athlete is deleted, offers and preparations the coach made for that
    connection are deleted with the connection; the coach is not left with a record
    that names or identifies the athlete.

What is NOT claimed: this does not make the database free of every trace in every
place. Rate-limit counters in Redis are keyed by a keyed hash and expire on their own;
backups and logs outside this application are not touched here.

Concurrency: the locks below are taken in the same order the other operations take
them, so deletion neither deadlocks with them nor lets them slip a row in behind it.
  1. each session family of the account (same advisory lock as refresh and logout);
  2. the account's connections, in id order (the first lock accepting an offer,
     publishing and feedback take);
  3. the account's "which program is active" lock (program activation and acceptance);
  4. the user row (and a check that the credentials this request was authorized with
     are still the account's: a password recovery that committed meanwhile refuses it).
     Anything still inserting a row for this user (a login, a write)
     either committed before this point and is removed by the cascade, or is refused
     afterwards by the foreign key (callers turn that into a plain 401), so nothing
     can be left behind or bring the account back.
A deadlock, or waiting more than a few seconds for a lock, rolls back everything and is
retried; if it still fails the caller is told nothing was deleted.
"""

from uuid import UUID

from sqlalchemy import delete, or_, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dberrors import RETRYABLE_SQLSTATES, sqlstate_of
from app.core.exceptions import ForbiddenError, ServiceUnavailableError, UnauthorizedError
from app.domains.auth.service import lock_family, password_matches
from app.domains.programs.service import lock_active_program
from app.domains.users.ratelimit import AccountDeletionThrottle
from app.models import CoachAthleteLink, CoachInvite, RefreshToken, User

_ATTEMPTS = 3
_LOCK_TIMEOUT = "5s"

_NOT_DELETED = "The account could not be deleted right now. Nothing was deleted; try again."


async def delete_account(
    db: AsyncSession, user: User, password: str, throttle: AccountDeletionThrottle
) -> None:
    """Check the password again, then erase `user` (always the signed-in account)."""
    # Counted before bcrypt, so a refused caller never reaches it.
    attempt = await throttle.begin(user)
    if not password_matches(password, user.password_hash):
        # 403, not 401: this client reads a 401 as "the session is dead" and signs out.
        raise ForbiddenError("Incorrect password")
    # Only wrong passwords stay counted.
    await attempt.refund()

    # Read now: a rollback in the loop expires the object.
    user_id, credential_version = user.id, user.credential_version
    for attempt_number in range(_ATTEMPTS):
        try:
            await _erase(db, user_id, credential_version)
            return
        except DBAPIError as error:
            await db.rollback()
            if sqlstate_of(error) not in RETRYABLE_SQLSTATES:
                raise
            if attempt_number == _ATTEMPTS - 1:
                raise ServiceUnavailableError(_NOT_DELETED, retry_after=5) from None


async def _erase(db: AsyncSession, user_id: UUID, credential_version: int) -> None:
    await db.execute(text(f"SET LOCAL lock_timeout = '{_LOCK_TIMEOUT}'"))

    # 1. Sessions: wait for any refresh or logout of this account to finish.
    families = (
        await db.scalars(
            select(RefreshToken.family_id)
            .where(RefreshToken.user_id == user_id)
            .distinct()
            .order_by(RefreshToken.family_id)
        )
    ).all()
    for family in families:
        await lock_family(db, family)

    # 2. Connections, in id order.
    await db.execute(
        select(CoachAthleteLink.id)
        .where(or_(CoachAthleteLink.coach_id == user_id, CoachAthleteLink.athlete_id == user_id))
        .order_by(CoachAthleteLink.id)
        .with_for_update()
    )

    # 3. Programs.
    await lock_active_program(db, user_id)

    # 4. The user row, last. A repeated or racing request finds nothing here. A password
    # recovery that committed while this request waited for the lock has changed the
    # credentials this request was authorized with: it is refused, nothing is deleted.
    current = await db.scalar(
        select(User.credential_version).where(User.id == user_id).with_for_update()
    )
    if current is None or current != credential_version:
        await db.rollback()
        raise UnauthorizedError("Invalid or expired access token")

    # Connections first: they take the offers, preparations and feedback with them.
    await db.execute(
        delete(CoachAthleteLink).where(
            or_(CoachAthleteLink.coach_id == user_id, CoachAthleteLink.athlete_id == user_id)
        )
    )
    # Codes this account used to connect to a coach (the coach's own codes go with the
    # coach, below). Kept, a used code would only record that someone accepted it.
    await db.execute(delete(CoachInvite).where(CoachInvite.accepted_by_id == user_id))
    # Everything else the account owns follows from the foreign keys.
    await db.execute(delete(User).where(User.id == user_id))
    await db.commit()
