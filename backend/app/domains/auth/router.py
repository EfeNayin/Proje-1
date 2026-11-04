"""Auth endpoints: register, login, refresh, logout, password recovery.

Register, login and refresh are rate limited (app/domains/auth/throttle.py). Logout
is not: it only deletes a refresh token the caller already holds. Password recovery has
its own limits (see the throttle module).
"""

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.mailer import SmtpMailer, get_mailer
from app.domains.auth import recovery, recovery_email, service
from app.domains.auth.schemas import (
    AuthResponse,
    LoginRequest,
    PasswordRecoveryAccepted,
    PasswordRecoveryConfirm,
    PasswordRecoveryRequest,
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
Mailer = Annotated[SmtpMailer, Depends(get_mailer)]


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


@router.post(
    "/password-recovery/request",
    response_model=PasswordRecoveryAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Ask for a password reset code by email",
    description=(
        "Always answers the same way, whether or not the address has an account: if it "
        "does, a code is emailed (after the response is sent); otherwise nothing is. "
        "Asking again replaces the previous code. Limited per requester and per address, "
        "with a resend cooldown (429)."
    ),
)
async def request_password_recovery(
    payload: PasswordRecoveryRequest,
    db: DbSession,
    throttle: Throttle,
    mailer: Mailer,
    background: BackgroundTasks,
) -> PasswordRecoveryAccepted:
    pending = await recovery.request_recovery(
        db, payload.email, throttle, deliver=mailer.enabled
    )
    if pending is not None:
        # After the response: how long it took must not say whether a message was sent.
        subject, body = recovery_email.code_message(pending.code)
        background.add_task(mailer.send, pending.to, subject, body)
    return PasswordRecoveryAccepted(
        message="If an account exists for that address, we have sent it a reset code.",
        code_valid_minutes=settings.PASSWORD_RESET_CODE_TTL_SECONDS // 60,
        resend_after_seconds=settings.RATE_LIMIT_RECOVERY_RESEND_COOLDOWN_SECONDS,
    )


@router.post(
    "/password-recovery/confirm",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Choose a new password with a reset code",
    description=(
        "Sets the new password if the code is the live one for the address; every way "
        "of failing (wrong, expired, used, replaced, unknown address) answers 400 with "
        "the same text. On success every session of the account ends and every access "
        "token issued before is refused; nobody is signed in by this call."
    ),
)
async def confirm_password_recovery(
    payload: PasswordRecoveryConfirm,
    db: DbSession,
    throttle: Throttle,
    mailer: Mailer,
    background: BackgroundTasks,
) -> Response:
    account_email = await recovery.reset_password(
        db, payload.email, payload.code, payload.new_password, throttle
    )
    subject, body = recovery_email.password_changed_message()
    # A notice only: the reset is complete whether or not it is delivered.
    background.add_task(mailer.send, account_email, subject, body)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
