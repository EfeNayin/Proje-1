"""Auth endpoints: register, login, refresh, logout.

Register, login and refresh are rate limited (app/domains/auth/throttle.py). Logout
is not: it only deletes a refresh token the caller already holds.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.domains.auth import service
from app.domains.auth.schemas import (
    AuthResponse,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenPair,
    UserProfile,
)
from app.domains.auth.throttle import (
    Throttle,
    limit_login_requester,
    limit_refresh_requester,
    limit_register_requester,
)

router = APIRouter(prefix="/auth", tags=["auth"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.post(
    "/register",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create an account",
    dependencies=[Depends(limit_register_requester)],
)
async def register(payload: RegisterRequest, db: DbSession) -> AuthResponse:
    user, tokens = await service.register(db, payload)
    return AuthResponse(user=UserProfile.model_validate(user), tokens=tokens)


@router.post(
    "/login",
    response_model=AuthResponse,
    summary="Sign in with email and password",
    dependencies=[Depends(limit_login_requester)],
)
async def login(payload: LoginRequest, db: DbSession, throttle: Throttle) -> AuthResponse:
    user, tokens = await service.login(db, payload, throttle)
    return AuthResponse(user=UserProfile.model_validate(user), tokens=tokens)


@router.post(
    "/refresh",
    response_model=TokenPair,
    summary="Exchange a refresh token for a new token pair",
    description=(
        "Rotates the token: the one presented is revoked and a new pair is "
        "returned. Replaying an already-used token revokes every session for "
        "that account."
    ),
    dependencies=[Depends(limit_refresh_requester)],
)
async def refresh(payload: RefreshRequest, db: DbSession, throttle: Throttle) -> TokenPair:
    return await service.refresh(db, payload.refresh_token, throttle)


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="End this device's session",
    description=(
        "Ends the session the refresh token presented belongs to: that token and "
        "any successor its rotations produced can no longer mint access tokens. "
        "Other sessions of the account are not affected. Always answers 204, "
        "including for a token that is unknown or already expired. Access tokens "
        "already issued stay valid until they expire."
    ),
)
async def logout(payload: RefreshRequest, db: DbSession) -> Response:
    await service.logout(db, payload.refresh_token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
