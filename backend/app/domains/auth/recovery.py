"""Password recovery: a code by email, then a new password.

The journey is two calls, and the second one carries everything it needs, so there is no
intermediate "verified" credential that could be stolen or reused:

  1. request_recovery(email): the same answer for every address. For an account, a random
     8-digit code is stored (as a keyed hash) and emailed; asking again replaces it.
  2. reset_password(email, code, new_password): the code and the new password together.
     Nothing changes unless the code is right.

Why these numbers (OWASP Forgot Password Cheat Sheet: 6 to 12 digit PINs are fine with
strict limits; tokens expire and are single-use; no automatic sign-in; no lockout):
  * Code: 8 digits from `secrets` (about 26.6 bits). Lifetime 15 minutes
    (PASSWORD_RESET_CODE_TTL_SECONDS). At most 5 guesses per code
    (PASSWORD_RESET_MAX_ATTEMPTS), spent in the database before the code is compared, so
    a parallel burst cannot overshoot; at most 10 per address and 30 per requester per
    15 minutes (Redis); at most 5 codes per address per hour with a 60 second cooldown.
    The best a guesser can do against one address is about 10 guesses per 15 minutes
    for a 1 in 10^8 space.
  * Stored as HMAC-SHA256 under a key derived from the server's secret, bound to the
    challenge, the account and the purpose. A database leak alone does not allow offline
    guessing of an 8-digit code (a bare or unsalted hash would fall to 10^8 tries in
    seconds). A leak of the database and the secret does, which is why the lifetime
    is short and a used or replaced code is deleted. Rotating JWT_SECRET_KEY invalidates
    outstanding codes.
  * One outstanding code per account (unique user_id). A new request replaces it, so the
    old code stops working at once. A reset deletes it: single use.
  * Failures (wrong, expired, used up, replaced, unknown address, deleted account) all
    answer identically, so the answer reveals neither an account nor why a code failed.
  * A code is a different kind of credential from a token: nothing but this module reads
    it, it is never a JWT and never authorizes anything else.

Sessions: a completed reset bumps users.credential_version (access tokens of the old
value are refused, see auth/dependencies.py and refresh()), deletes every refresh token of
the account and the code. It does NOT sign anyone in.

Concurrency: the reset takes locks in the order refresh, logout, activation and deletion
use (session families, then the user row, then the challenge row). Two resets with the
same code run one after the other and the second finds nothing; a login or refresh that
overlaps either finishes first and is then ended by the reset, or sees the new password
and is refused (login and refresh share-lock the user row). Deletion first: the account
and its code are gone and the reset answers like any unknown address; nothing is ever
created by recovery.
"""

import hmac
import secrets
from dataclasses import dataclass
from datetime import timedelta
from hashlib import sha256
from uuid import UUID, uuid4

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dberrors import RETRYABLE_SQLSTATES, references_missing_user, sqlstate_of
from app.core.exceptions import BadRequestError, ServiceUnavailableError
from app.core.passwordwork import BUSY_RETRY_AFTER_SECONDS, PasswordWorkBusyError, offload
from app.core.security import hash_password
from app.domains.auth.service import lock_family
from app.domains.auth.throttle import AuthThrottle
from app.models import PasswordResetChallenge, RefreshToken, User

CODE_DIGITS = 8
_PURPOSE = "password-reset"
_LOCK_TIMEOUT = "5s"
_ATTEMPTS = 3

INVALID_CODE_MESSAGE = (
    "That code is not valid, or it has expired or was already used. "
    "Check it, or request a new code."
)
_NOT_CHANGED = "The password could not be changed right now. Nothing was changed; try again."


@dataclass(frozen=True)
class PendingEmail:
    """A message to send once the response has gone out. Holds the code: never log it."""

    to: str
    code: str

    def __repr__(self) -> str:
        return "PendingEmail(to=<redacted>, code=<redacted>)"


def new_code() -> str:
    return f"{secrets.randbelow(10**CODE_DIGITS):0{CODE_DIGITS}d}"


def normalize_code(raw: str) -> str | None:
    """The digits of what was typed (spaces and hyphens ignored), or None if it is not a code."""
    digits = raw.replace(" ", "").replace("-", "")
    if len(digits) != CODE_DIGITS or not (digits.isascii() and digits.isdigit()):
        return None
    return digits


def _key() -> bytes:
    return hmac.new(
        settings.JWT_SECRET_KEY.encode(), b"bodytrack/password-recovery/v1", sha256
    ).digest()


def hash_code(challenge_id: UUID, user_id: UUID, code: str) -> str:
    """Keyed hash of a code, bound to its challenge, its account and its purpose."""
    message = f"{_PURPOSE}\0{challenge_id}\0{user_id}\0{code}".encode()
    return hmac.new(_key(), message, sha256).hexdigest()


async def request_recovery(
    db: AsyncSession, email: str, throttle: AuthThrottle, *, deliver: bool
) -> PendingEmail | None:
    """Count the request, and for a registered address store a fresh code to email.

    Returns what to send, or None (unknown address, deleted meanwhile, or no delivery
    configured). The caller answers the same way in every case.
    """
    await throttle.recovery_request(email)
    if not deliver:
        return None

    user = await db.scalar(select(User).where(User.email == email))
    challenge_id, code = uuid4(), new_code()
    # An account without a password (created with Google or Apple) is answered like an
    # unknown address: an emailed code would let whoever controls the mailbox add a password
    # to an account that was never reachable that way. It signs in with its provider.
    if user is None or not user.has_password:
        hash_code(challenge_id, uuid4(), code)  # the same work as below
        return None

    code_hash = hash_code(challenge_id, user.id, code)
    expires_at = func.now() + timedelta(seconds=settings.PASSWORD_RESET_CODE_TTL_SECONDS)
    row = insert(PasswordResetChallenge).values(
        id=challenge_id, user_id=user.id, code_hash=code_hash, expires_at=expires_at, attempts=0
    )
    # Replaces the previous code of this account in one statement: it is invalid from
    # the moment this commits, and two requests at once leave exactly one row.
    upsert = row.on_conflict_do_update(
        index_elements=[PasswordResetChallenge.user_id],
        set_={
            "id": row.excluded.id,
            "code_hash": row.excluded.code_hash,
            "expires_at": row.excluded.expires_at,
            "attempts": 0,
            "created_at": func.now(),
        },
    )
    try:
        await db.execute(upsert)
        await db.commit()
    except IntegrityError as error:
        await db.rollback()
        if references_missing_user(error):  # deleted while this request ran
            return None
        raise
    return PendingEmail(to=user.email, code=code)


async def reset_password(
    db: AsyncSession, email: str, code: str, new_password: str, throttle: AuthThrottle
) -> str:
    """Set a new password if `code` is the live code for `email`. Returns the account's email.

    Every way of failing raises the same BadRequestError.
    """
    attempt = await throttle.recovery_confirm(email)

    user = await db.scalar(select(User).where(User.email == email))
    if user is not None and not user.has_password:
        user = None  # no password to reset: the same answer as an unknown address
    challenge = (
        await db.scalar(
            select(PasswordResetChallenge).where(PasswordResetChallenge.user_id == user.id)
        )
        if user is not None
        else None
    )
    supplied = normalize_code(code)

    if user is None or challenge is None or supplied is None:
        # Same work and same answer as a wrong code for an account.
        hash_code(uuid4(), uuid4(), supplied or "0" * CODE_DIGITS)
        await db.execute(
            update(PasswordResetChallenge)
            .where(PasswordResetChallenge.id == uuid4())
            .values(attempts=PasswordResetChallenge.attempts + 1)
        )
        await db.commit()
        raise BadRequestError(INVALID_CODE_MESSAGE)

    # Spend one guess before looking at the code. The update is atomic, so concurrent
    # guesses are counted one by one and the limit holds; it also refuses a code that
    # is used up or past its lifetime (measured by the database's clock).
    spent = await db.scalar(
        update(PasswordResetChallenge)
        .where(
            PasswordResetChallenge.id == challenge.id,
            PasswordResetChallenge.attempts < settings.PASSWORD_RESET_MAX_ATTEMPTS,
            PasswordResetChallenge.expires_at > func.now(),
        )
        .values(attempts=PasswordResetChallenge.attempts + 1)
        .returning(PasswordResetChallenge.attempts)
    )
    await db.commit()
    expected = hash_code(challenge.id, user.id, supplied)
    if spent is None or not hmac.compare_digest(expected, challenge.code_hash):
        raise BadRequestError(INVALID_CODE_MESSAGE)

    # The slow part, outside any lock. Plain values are read now: a rollback in the loop
    # below expires the ORM objects.
    try:
        password_hash = await offload(hash_password, new_password)
    except PasswordWorkBusyError:
        # The code was right and nothing was changed: not a failed attempt.
        await attempt.refund()
        raise ServiceUnavailableError(_NOT_CHANGED, retry_after=BUSY_RETRY_AFTER_SECONDS) from None
    user_id, challenge_id, account_email = user.id, challenge.id, user.email

    for attempt_number in range(_ATTEMPTS):
        try:
            await _apply(db, user_id, challenge_id, password_hash)
            break
        except DBAPIError as error:
            await db.rollback()
            if sqlstate_of(error) not in RETRYABLE_SQLSTATES:
                raise
            if attempt_number == _ATTEMPTS - 1:
                raise ServiceUnavailableError(_NOT_CHANGED, retry_after=5) from None

    # A right code is not a failed attempt.
    await attempt.refund()
    return account_email


async def _apply(db: AsyncSession, user_id: UUID, challenge_id: UUID, password_hash: str) -> None:
    await db.execute(text(f"SET LOCAL lock_timeout = '{_LOCK_TIMEOUT}'"))

    # Same order as deletion: session families, then the user row.
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

    # Gone (deleted) or no longer the live code (replaced, used by a concurrent request):
    # nothing is changed, and the answer is the usual one.
    if await db.scalar(select(User.id).where(User.id == user_id).with_for_update()) is None:
        await db.rollback()
        raise BadRequestError(INVALID_CODE_MESSAGE)
    live = await db.scalar(
        select(PasswordResetChallenge.id)
        .where(
            PasswordResetChallenge.id == challenge_id,
            PasswordResetChallenge.expires_at > func.now(),
        )
        .with_for_update()
    )
    if live is None:
        await db.rollback()
        raise BadRequestError(INVALID_CODE_MESSAGE)

    await db.execute(
        update(User)
        .where(User.id == user_id)
        .values(password_hash=password_hash, credential_version=User.credential_version + 1)
    )
    await db.execute(delete(RefreshToken).where(RefreshToken.user_id == user_id))
    await db.execute(
        delete(PasswordResetChallenge).where(PasswordResetChallenge.user_id == user_id)
    )
    await db.commit()
