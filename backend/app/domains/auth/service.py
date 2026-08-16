"""Auth business logic.

This layer knows nothing about HTTP. It raises the exceptions from
app.core.exceptions and lets the router translate them into responses,
which keeps it directly unit-testable.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import ConflictError, UnauthorizedError
from app.core.security import (
    JWTError,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    hash_token,
    is_refresh_token,
    verify_password,
)
from app.domains.auth.schemas import LoginRequest, RegisterRequest, TokenPair
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
        display_name=payload.display_name,
    )
    db.add(user)
    await db.flush()  # populate user.id before it is used as a foreign key

    tokens = await _issue_token_pair(db, user.id)
    await db.commit()
    await db.refresh(user)
    return user, tokens


async def login(db: AsyncSession, payload: LoginRequest) -> tuple[User, TokenPair]:
    """Verify credentials and issue a token pair."""
    user = await db.scalar(select(User).where(User.email == payload.email))

    if user is None or not verify_password(payload.password, user.password_hash):
        raise UnauthorizedError(_INVALID_CREDENTIALS)

    tokens = await _issue_token_pair(db, user.id)
    await db.commit()
    return user, tokens


async def refresh(db: AsyncSession, raw_token: str) -> TokenPair:
    """Exchange a refresh token for a new pair, rotating the old one.

    Rotation means the presented token is revoked and replaced. A revoked
    token that shows up again is a strong signal that it was stolen and
    replayed, so in that case every active token for the user is revoked and
    they have to sign in again everywhere.
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

    stored = await db.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw_token))
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