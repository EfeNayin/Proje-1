"""Auth business logic.

This layer knows nothing about HTTP. It raises the exceptions from
app.core.exceptions and lets the router translate them into responses,
which keeps it directly unit-testable.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import ConflictError, UnauthorizedError
from app.core.security import (
    JWTError,
    create_access_token,
    create_refresh_token,
    decode_token,
    dummy_password_hash,
    hash_password,
    hash_token,
    is_refresh_token,
    verify_password,
)
from app.domains.auth.schemas import (
    BCRYPT_MAX_BYTES,
    LoginRequest,
    RegisterRequest,
    TokenPair,
)
from app.domains.auth.throttle import AuthThrottle
from app.models import RefreshToken, User

# Login and register deliberately return the same message for "no such email"
# and "wrong password". Distinguishing them would let anyone probe which
# addresses are registered.
_INVALID_CREDENTIALS = "Invalid email or password"


async def register(db: AsyncSession, payload: RegisterRequest) -> tuple[User, TokenPair]:
    """Create an account and issue its first token pair."""
    # email and username are CITEXT, so this comparison is case-insensitive
    # and "Efe@x.com" collides with "efe@x.com" as intended.
    existing = await db.scalar(
        select(User).where(
            or_(User.email == payload.email, User.username == payload.username)
        )
    )
    if existing is not None:
        # Which field collided is not disclosed, for the same reason as above.
        raise ConflictError("Email or username is already taken")

    user = User(
        email=payload.email,
        username=payload.username,
        password_hash=hash_password(payload.password),
        first_name=payload.first_name,
        timezone=payload.timezone,
        locale=payload.locale,
    )
    db.add(user)
    await db.flush()  # populate user.id before it is used as a foreign key

    tokens = await _issue_token_pair(db, user.id)
    await db.commit()
    await db.refresh(user)
    return user, tokens


async def login(
    db: AsyncSession, payload: LoginRequest, throttle: AuthThrottle
) -> tuple[User, TokenPair]:
    """Verify credentials and issue a token pair."""
    # Counted before anything is looked up or hashed, for known and unknown emails
    # alike: an attempt that is refused here learns nothing, and one that is not
    # refused cannot be told apart by how it is limited.
    attempt = await throttle.login_account(payload.email)

    user = await db.scalar(select(User).where(User.email == payload.email))

    # Always run one bcrypt verification, against a throwaway hash when the email
    # is unknown, so the response time does not reveal whether it is registered.
    password_hash = user.password_hash if user is not None else dummy_password_hash()
    # Registration refuses passwords over 72 bytes, so none exists; bcrypt would
    # only compare the first 72 bytes and accept a longer string with the right
    # prefix. Compare an empty string instead, which no account can match.
    candidate = payload.password
    if len(candidate.encode("utf-8")) > BCRYPT_MAX_BYTES:
        candidate = ""
    password_ok = verify_password(candidate, password_hash)

    if user is None or not password_ok:
        raise UnauthorizedError(_INVALID_CREDENTIALS)

    # A right password is not a failed attempt; only failures stay counted.
    await attempt.refund()

    tokens = await _issue_token_pair(db, user.id)
    await db.commit()
    return user, tokens


async def refresh(db: AsyncSession, raw_token: str, throttle: AuthThrottle) -> TokenPair:
    """Exchange a refresh token for a new pair, rotating the old one.

    Rotation means the presented token is revoked and replaced. A revoked
    token that shows up again is a strong signal that it was stolen and
    replayed, so in that case every active token for the user is revoked and
    they have to sign in again everywhere.

    That theft detection only works if rotation is atomic across concurrent
    callers. `with_for_update()` below takes a row lock on this specific
    token (token_hash is unique, so it never touches any other token or
    user's rows) before its `revoked_at` is read. Without it, two requests
    presenting the *same still-valid* token at the same time — a client
    retry after a dropped response, or a stolen token raced against the
    legitimate device's own refresh — would both read `revoked_at IS NULL`
    before either commits, and both would go on to rotate it successfully:
    two live token pairs minted from one input, and neither request ever
    sees the "already used" branch below that is supposed to catch exactly
    this. The mobile client's own single-flight guards against firing two
    refreshes from itself, but has no way to know about a second device or
    a retried request in flight elsewhere — that guarantee has to live here.
    The lock makes the second request wait for the first's whole rotation
    (revoke + issue + commit) to finish, so its own read always sees the
    up-to-date `revoked_at` and takes the replay-detection branch instead.
    """
    try:
        claims = decode_token(raw_token)
    except JWTError:
        # Covers both a bad signature and an expired token.
        raise UnauthorizedError("Invalid or expired refresh token") from None

    if not is_refresh_token(claims):
        # An access token must not be usable to mint new tokens.
        raise UnauthorizedError("Invalid or expired refresh token")

    try:
        user_id = UUID(str(claims.get("sub")))
    except ValueError:
        raise UnauthorizedError("Invalid or expired refresh token") from None

    # `user_id` comes from a token whose signature, expiry and type were just
    # verified, so it is an identity this server vouched for. Anything that failed
    # above never gets here and never spends this account's allowance.
    await throttle.refresh_user(user_id)

    stored = await db.scalar(
        select(RefreshToken)
        .where(RefreshToken.token_hash == hash_token(raw_token))
        .with_for_update()
    )
    if stored is None:
        raise UnauthorizedError("Invalid or expired refresh token")

    if stored.revoked_at is not None:
        await _revoke_all_for_user(db, stored.user_id)
        await db.commit()
        raise UnauthorizedError("Refresh token was already used. Please sign in again.")

    now = datetime.now(UTC)
    if stored.expires_at <= now:
        raise UnauthorizedError("Invalid or expired refresh token")

    # The account may have been deleted since the token was issued.
    user = await db.get(User, user_id)
    if user is None:
        raise UnauthorizedError("Invalid or expired refresh token")

    stored.revoked_at = now
    tokens = await _issue_token_pair(db, user.id)
    await db.commit()
    return tokens


async def logout(db: AsyncSession, raw_token: str) -> None:
    """End the session this refresh token belongs to. Idempotent; never errors.

    The row is deleted rather than marked revoked on purpose. A revoked token
    that is presented again is treated by `refresh()` as a theft signal and
    takes down every session of the account; a request still in flight from the
    device that just signed out must not do that to the user's other devices.
    A deleted token simply is not found, which is a plain 401.

    Anything that is not a currently signed refresh token (garbage, an access
    token, an expired one) is ignored and answered the same way, so the endpoint
    says nothing about which tokens were real. Access tokens are stateless and
    stay valid until they expire (ACCESS_TOKEN_EXPIRE_MINUTES); only the ability
    to mint new ones ends here.
    """
    try:
        claims = decode_token(raw_token)
    except JWTError:
        return
    if not is_refresh_token(claims):
        return
    await db.execute(delete(RefreshToken).where(RefreshToken.token_hash == hash_token(raw_token)))
    await db.commit()


async def _issue_token_pair(db: AsyncSession, user_id: UUID) -> TokenPair:
    """Create an access + refresh token and persist the refresh token's hash.

    Does not commit; the caller decides the transaction boundary.
    """
    access = create_access_token(user_id)
    raw_refresh, expires_at = create_refresh_token(user_id)

    db.add(
        RefreshToken(
            user_id=user_id,
            token_hash=hash_token(raw_refresh),
            expires_at=expires_at,
        )
    )

    return TokenPair(
        access_token=access,
        refresh_token=raw_refresh,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


async def _revoke_all_for_user(db: AsyncSession, user_id: UUID) -> None:
    """Revoke every still-valid refresh token belonging to a user."""
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )