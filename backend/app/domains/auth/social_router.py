"""Endpoints for Sign in with Google / Apple, mounted under /auth/social.

The flow, from the app's side:
  GET  /providers      which providers work here (and the public client ids)
  POST /nonce          Apple only: a single-use value to request the credential with
  POST /login          a provider credential -> signed in, or an onboarding offer
  POST /complete       finish onboarding: create the account (username, timezone)
  POST /link-existing  finish onboarding by signing in to an existing account (password)
  POST /link           from a signed-in session: add a provider (re-proving the account)
  POST /apple/notifications   Apple's server-to-server notices (consent revoked, ...)
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.exceptions import BadRequestError
from app.domains.auth import social
from app.domains.auth.dependencies import CurrentUser
from app.domains.auth.schemas import AuthResponse
from app.domains.auth.social_deps import SocialDep
from app.domains.auth.social_schemas import (
    AppleNotificationRequest,
    LinkProviderRequest,
    NonceResponse,
    ProviderAvailability,
    ProviderCredential,
    SignInMethods,
    SocialCompleteRequest,
    SocialLinkExistingRequest,
    SocialSignInResponse,
)
from app.domains.auth.throttle import (
    Throttle,
    limit_login_requester,
    limit_social_complete_requester,
    limit_social_nonce_requester,
    limit_social_notify_requester,
    limit_social_signin_requester,
)

router = APIRouter(prefix="/social", tags=["auth"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.get(
    "/providers",
    response_model=ProviderAvailability,
    summary="Which sign-in providers this server can complete",
)
async def providers(sc: SocialDep) -> ProviderAvailability:
    return social.availability(sc)


@router.post(
    "/nonce",
    response_model=NonceResponse,
    summary="A single-use value for an Apple sign-in",
    dependencies=[Depends(limit_social_nonce_requester)],
)
async def nonce(db: DbSession, sc: SocialDep) -> NonceResponse:
    if not sc.providers.apple_enabled:
        raise BadRequestError(
            "Sign-in with Apple is not available.", code="social_provider_disabled"
        )
    return await social.issue_nonce(db)


@router.post(
    "/login",
    response_model=SocialSignInResponse,
    summary="Sign in with a Google or Apple credential",
    description=(
        "A credential from a returning identity signs into the account it is linked to "
        "(status signed_in). A new identity creates NO account: it answers status "
        "onboarding with a short-lived, single-use token to finish with /complete or "
        "/link-existing. An email address never selects an account."
    ),
    dependencies=[Depends(limit_social_signin_requester)],
)
async def login(
    payload: ProviderCredential, db: DbSession, sc: SocialDep
) -> SocialSignInResponse:
    return await social.sign_in(db, sc, payload)


@router.post(
    "/complete",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create the account for a verified identity",
    dependencies=[Depends(limit_social_complete_requester)],
)
async def complete(payload: SocialCompleteRequest, db: DbSession) -> AuthResponse:
    return await social.complete_signup(db, payload)


@router.post(
    "/link-existing",
    response_model=AuthResponse,
    summary="Sign in to an existing account and link the verified identity to it",
    description=(
        "Proof of the existing account is its password (counted like a sign-in attempt); "
        "the identity comes from the onboarding token, never from the email typed."
    ),
    dependencies=[Depends(limit_login_requester)],
)
async def link_existing(
    payload: SocialLinkExistingRequest, db: DbSession, throttle: Throttle
) -> AuthResponse:
    return await social.link_existing_account(db, payload, throttle)


@router.post(
    "/link",
    response_model=SignInMethods,
    summary="Add a provider to your account",
    description=(
        "Needs a fresh credential from the new provider AND proof of the account again: "
        "its password, or a fresh credential from a provider it already has. A provider "
        "account linked to another Aures account is refused (409); nothing is merged."
    ),
    dependencies=[Depends(limit_social_signin_requester)],
)
async def link(
    payload: LinkProviderRequest,
    current_user: CurrentUser,
    db: DbSession,
    sc: SocialDep,
    throttle: Throttle,
) -> SignInMethods:
    return await social.link_to_signed_in_account(db, sc, current_user, payload, throttle)


@router.post(
    "/apple/notifications",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Apple's server-to-server notifications",
    description=(
        "Called by Apple, not by the app. The signed payload is verified against Apple's "
        "keys; consent-revoked and account-delete clear the stored authorization."
    ),
    dependencies=[Depends(limit_social_notify_requester)],
)
async def apple_notifications(
    payload: AppleNotificationRequest, db: DbSession, sc: SocialDep
) -> Response:
    await social.handle_apple_notification(db, sc, payload.payload)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
