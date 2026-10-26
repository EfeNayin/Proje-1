"""Auth endpoints: register, login, refresh, logout."""

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

router = APIRouter(prefix="/auth", tags=["auth"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.post(
    "/register",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create an account",
)
async def register(payload: RegisterRequest, db: DbSession) -> AuthResponse:
    user, tokens = await service.register(db, payload)
    return AuthResponse(user=UserProfile.model_validate(user), tokens=tokens)


@router.post(
    "/login",
    response_model=AuthResponse,
    summary="Sign in with email and password",
)
async def login(payload: LoginRequest, db: DbSession) -> AuthResponse:
    user, tokens = await service.login(db, payload)
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
)
async def refresh(payload: RefreshRequest, db: DbSession) -> TokenPair:
    return await service.refresh(db, payload.refresh_token)


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="End this device's session",
    description=(
        "Revokes the refresh token presented, so it can no longer mint access "
        "tokens. Always answers 204, including for a token that is unknown or "
        "already expired. Access tokens already issued stay valid until they "
        "expire."
    ),
)
async def logout(payload: RefreshRequest, db: DbSession) -> Response:
    await service.logout(db, payload.refresh_token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
