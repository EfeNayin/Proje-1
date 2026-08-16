"""Auth dependencies shared by protected endpoints."""

from typing import Annotated
from uuid import UUID

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.exceptions import UnauthorizedError
from app.core.security import JWTError, decode_token, is_access_token
from app.models import User

# auto_error=False so a missing header reaches our own handler and comes back
# as a 401 through UnauthorizedError, rather than FastAPI's default 403.
# Declaring the scheme also gives Swagger UI its "Authorize" button.
_bearer = HTTPBearer(auto_error=False, description="Paste the access token")

_INVALID_TOKEN = "Invalid or expired access token"


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """Resolve the caller from the `Authorization: Bearer <token>` header."""
    if credentials is None:
        raise UnauthorizedError("Authorization header is missing")

    try:
        claims = decode_token(credentials.credentials)
    except JWTError:
        raise UnauthorizedError(_INVALID_TOKEN) from None

    # A refresh token must not grant access to protected endpoints.
    if not is_access_token(claims):
        raise UnauthorizedError(_INVALID_TOKEN)

    try:
        user_id = UUID(str(claims.get("sub")))
    except ValueError:
        raise UnauthorizedError(_INVALID_TOKEN) from None

    user = await db.get(User, user_id)
    if user is None:
        # Token is well-formed but the account is gone.
        raise UnauthorizedError(_INVALID_TOKEN)

    return user


# Shorthand so endpoints can write `current_user: CurrentUser`.
CurrentUser = Annotated[User, Depends(get_current_user)]