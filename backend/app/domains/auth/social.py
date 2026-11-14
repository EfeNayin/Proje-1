"""Sign in with Google and Apple: the account side.

app/domains/auth/social_providers.py turns what a phone hands over into a verified identity
(provider + the provider's stable subject). This module decides what that identity means for
an Aures account. The rules, and why they are what they are:

* An identity is (provider, subject). The email a provider reports is contact data. It never
  selects an account, never attaches an identity to one and never grants a session; two
  different people can hold the same address over time, and Apple's relay address is not an
  address the person uses anywhere else.
* A returning identity signs into the account it is linked to.
* A new identity gets NO account yet. It gets a short-lived, single-use onboarding record
  (an opaque token whose hash is stored). The account exists only after the person finishes
  onboarding (username, timezone) or links the identity to an account they already own. A
  taken username, an abandoned flow or a crash leaves no partial account.
* Linking to an existing account needs proof of that account (its password, now) AND a
  fresh provider credential (the onboarding record, minutes old, or a new credential when
  linking from a signed-in session). An account without a password proves itself with a
  fresh credential from a provider it already has.
* A provider identity belongs to one account for good: linking one that is linked elsewhere
  is refused, nothing is merged and no data moves. The database enforces it (unique provider
  + subject), so concurrent attempts cannot both win.

Concurrency: two completions of the same onboarding record take the same row lock, so the
second finds it spent. Two records for one identity (a double tap) can both start, but only
one INSERT of the identity can commit; the loser's transaction, including its new user row,
rolls back and is told to sign in again.
"""

import logging
import re
import secrets
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from uuid import UUID

from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import and_, delete, func, or_, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dberrors import references_missing_user
from app.core.exceptions import (
    BadRequestError,
    ConflictError,
    ForbiddenError,
    ServiceUnavailableError,
    UnauthorizedError,
)
from app.core.passwordwork import PasswordWorkBusyError, offload
from app.core.secretbox import SecretBox
from app.core.security import dummy_password_hash, hash_token
from app.domains.auth.schemas import AuthResponse, UserProfile
from app.domains.auth.service import _issue_token_pair, lock_family, password_matches
from app.domains.auth.social_providers import (
    CredentialRejected,
    ProviderUnavailable,
    SocialProviders,
    VerifiedIdentity,
)
from app.domains.auth.social_schemas import (
    LinkedProvider,
    LinkProviderRequest,
    NonceResponse,
    OnboardingOffer,
    ProviderAvailability,
    ProviderCredential,
    SignInMethods,
    SocialCompleteRequest,
    SocialLinkExistingRequest,
    SocialSignInResponse,
)
from app.domains.auth.throttle import AuthThrottle
from app.models import (
    RefreshToken,
    SocialNonce,
    SocialSignupChallenge,
    User,
    UserIdentity,
)

logger = logging.getLogger(__name__)

_PROVIDER_NAMES = {"google": "Google", "apple": "Apple"}
_INVALID_CREDENTIAL = "We could not verify that sign-in. Try again."
_ONBOARDING_EXPIRED = "This sign-in expired. Start again."
_WRONG_PASSWORD = "Invalid email or password"
_LOCK_TIMEOUT = "5s"
_EMAIL = TypeAdapter(EmailStr)


@dataclass(frozen=True)
class Social:
    """The collaborators the flows need; tests replace the providers with fakes."""

    providers: SocialProviders
    box: SecretBox | None


# ── what is on offer ──────────────────────────────────────────────────────


def availability(social: Social) -> ProviderAvailability:
    google = social.providers.google_enabled
    return ProviderAvailability.model_validate(
        {
            "google": {
                "enabled": google,
                "ios_client_id": settings.GOOGLE_IOS_CLIENT_ID if google else None,
                "web_client_id": settings.GOOGLE_WEB_CLIENT_ID if google else None,
            },
            "apple": {"enabled": social.providers.apple_enabled},
        }
    )


# ── nonces ────────────────────────────────────────────────────────────────


async def issue_nonce(db: AsyncSession) -> NonceResponse:
    """A fresh single-use value for an Apple sign-in. Only its hash is stored."""
    raw = secrets.token_urlsafe(32)
    await db.execute(delete(SocialNonce).where(SocialNonce.expires_at < func.now()))
    db.add(
        SocialNonce(
            nonce_hash=hash_token(raw),
            expires_at=func.now() + timedelta(seconds=settings.SOCIAL_NONCE_TTL_SECONDS),
        )
    )
    await db.commit()
    return NonceResponse(nonce=raw, expires_in=settings.SOCIAL_NONCE_TTL_SECONDS)


async def _spend_nonce(db: AsyncSession, nonce: str) -> bool:
    """Use a nonce up. One statement, so two requests with the same value cannot both win.

    Committed at once: a nonce is spent even if what follows fails, so a captured credential
    can never be tried twice.
    """
    spent = await db.scalar(
        delete(SocialNonce)
        .where(SocialNonce.nonce_hash == hash_token(nonce), SocialNonce.expires_at > func.now())
        .returning(SocialNonce.nonce_hash)
    )
    await db.commit()
    return spent is not None


# ── verifying a credential ────────────────────────────────────────────────


def _name(provider: str) -> str:
    return _PROVIDER_NAMES[provider]


def _credential_error(*, signed_in: bool = False) -> UnauthorizedError | ForbiddenError:
    """401 for a signed-out attempt; 403 when the caller already has a session.

    The app reads a 401 as "the session is dead" and signs out, so a bad credential offered
    while signed in (linking, confirming a deletion) must not be one.
    """
    if signed_in:
        return ForbiddenError(_INVALID_CREDENTIAL, code="social_credential_invalid")
    return UnauthorizedError(_INVALID_CREDENTIAL, code="social_credential_invalid")


def _unavailable(provider: str) -> ServiceUnavailableError:
    return ServiceUnavailableError(
        f"Sign-in with {_name(provider)} is unavailable right now. Try again in a moment, "
        "or use your email.",
        retry_after=10,
        code="social_provider_unavailable",
    )


def _not_enabled(provider: str) -> BadRequestError:
    return BadRequestError(
        f"Sign-in with {_name(provider)} is not available.", code="social_provider_disabled"
    )


async def verify_credential(
    db: AsyncSession, social: Social, credential: ProviderCredential, *, signed_in: bool = False
) -> VerifiedIdentity:
    """Who this credential vouches for. Raises 401/403 (invalid), 400 (disabled), 503 (outage)."""
    provider = credential.provider
    try:
        if provider == "google":
            if not social.providers.google_enabled or credential.authorization_code is None:
                raise _not_enabled(provider)
            identity = await social.providers.verify_google(credential.authorization_code)
        else:
            if not social.providers.apple_enabled:
                raise _not_enabled(provider)
            assert credential.identity_token is not None and credential.nonce is not None
            identity = await social.providers.verify_apple(
                credential.identity_token, credential.nonce
            )
            # After the token proved itself, so a stranger who guesses nothing cannot burn
            # someone else's nonce; spent before anything is created, so it is single-use.
            if not await _spend_nonce(db, credential.nonce):
                message = "This sign-in expired or was already used. Try again."
                if signed_in:
                    raise ForbiddenError(message, code="social_nonce_invalid")
                raise UnauthorizedError(message, code="social_nonce_invalid")
    except CredentialRejected:
        raise _credential_error(signed_in=signed_in) from None
    except ProviderUnavailable:
        raise _unavailable(provider) from None
    if provider == "apple":
        identity = replace(
            identity,
            first_name=_clean_name(credential.first_name),
            last_name=_clean_name(credential.last_name),
        )
    return identity


def _clean_name(value: str | None) -> str | None:
    cleaned = (value or "").strip()
    return cleaned[:100] or None


async def _apple_refresh_token_for_storage(
    social: Social, credential: ProviderCredential
) -> str | None:
    """Exchange Apple's authorization code and return the encrypted refresh token, or None.

    Never raises: a sign-in does not depend on it. It runs before any lock is taken, because
    it is a network call.
    """
    if (
        credential.provider != "apple"
        or not credential.authorization_code
        or social.box is None
    ):
        return None
    token = await social.providers.apple_refresh_token(credential.authorization_code)
    return social.box.encrypt(token) if token else None


# ── sign in ───────────────────────────────────────────────────────────────


async def sign_in(
    db: AsyncSession, social: Social, credential: ProviderCredential
) -> SocialSignInResponse:
    identity = await verify_credential(db, social, credential)
    row = await db.scalar(
        select(UserIdentity).where(
            UserIdentity.provider == identity.provider, UserIdentity.subject == identity.subject
        )
    )
    if row is not None:
        return await _sign_in_existing(db, social, credential, row.id, row.user_id, identity)
    return await _offer_onboarding(db, social, credential, identity)


async def _sign_in_existing(
    db: AsyncSession,
    social: Social,
    credential: ProviderCredential,
    identity_id: int,
    user_id: UUID,
    identity: VerifiedIdentity,
) -> SocialSignInResponse:
    stored_token = await db.scalar(
        select(UserIdentity.apple_refresh_token_encrypted).where(UserIdentity.id == identity_id)
    )
    new_token = None if stored_token else await _apple_refresh_token_for_storage(social, credential)

    # Share-lock the account row as password sign-in does: a deletion or a credential change
    # either finished before this point, which the checks below see, or waits for these tokens.
    user = await db.scalar(
        select(User)
        .where(User.id == user_id)
        .with_for_update(read=True)
        .execution_options(populate_existing=True)
    )
    row = await db.get(UserIdentity, identity_id, populate_existing=True)
    if user is None or row is None:
        raise _credential_error()

    row.last_login_at = datetime.now(UTC)
    row.authorization_revoked_at = None
    if identity.email:
        row.email = identity.email
        row.email_verified = identity.email_verified
        row.is_private_email = identity.is_private_email
    if new_token:
        row.apple_refresh_token_encrypted = new_token

    tokens = await _issue_token_pair(db, user.id, credential_version=user.credential_version)
    try:
        await db.commit()
    except IntegrityError as error:
        await db.rollback()
        if references_missing_user(error):  # deleted while this ran
            raise _credential_error() from None
        raise
    await db.refresh(user)
    return SocialSignInResponse(
        status="signed_in", user=UserProfile.model_validate(user), tokens=tokens
    )


def _email_is_usable(identity: VerifiedIdentity | SocialSignupChallenge) -> bool:
    """Whether the provider's address can become the account's email as it is."""
    if not identity.email or not identity.email_verified:
        return False
    try:
        _EMAIL.validate_python(identity.email)
    except ValidationError:
        return False
    return True


def suggest_username(
    email: str | None, first_name: str | None, *, private_email: bool
) -> str | None:
    """A starting point for the username field; availability is NOT checked (it can change)."""
    base = first_name or ("" if private_email or not email else email.split("@")[0])
    cleaned = re.sub(r"[^a-zA-Z0-9_]", "", base)[:30]
    return cleaned if len(cleaned) >= 3 else None


async def _offer_onboarding(
    db: AsyncSession, social: Social, credential: ProviderCredential, identity: VerifiedIdentity
) -> SocialSignInResponse:
    encrypted = await _apple_refresh_token_for_storage(social, credential)
    token = secrets.token_urlsafe(32)
    ttl = settings.SOCIAL_SIGNUP_TTL_SECONDS
    # Old and superseded records go: one live record per identity, none past its time.
    await db.execute(
        delete(SocialSignupChallenge).where(
            or_(
                SocialSignupChallenge.expires_at < func.now(),
                and_(
                    SocialSignupChallenge.provider == identity.provider,
                    SocialSignupChallenge.subject == identity.subject,
                ),
            )
        )
    )
    record = SocialSignupChallenge(
        token_hash=hash_token(token),
        provider=identity.provider,
        subject=identity.subject,
        email=identity.email,
        email_verified=identity.email_verified,
        is_private_email=identity.is_private_email,
        first_name=identity.first_name,
        last_name=identity.last_name,
        apple_refresh_token_encrypted=encrypted,
        expires_at=func.now() + timedelta(seconds=ttl),
    )
    db.add(record)
    await db.commit()
    offer = OnboardingOffer(
        token=token,
        expires_in=ttl,
        provider=credential.provider,
        email=identity.email,
        email_is_usable=_email_is_usable(identity),
        is_private_email=identity.is_private_email,
        first_name=identity.first_name,
        suggested_username=suggest_username(
            identity.email, identity.first_name, private_email=identity.is_private_email
        ),
    )
    return SocialSignInResponse(status="onboarding", onboarding=offer)


# ── onboarding: create the account ────────────────────────────────────────


async def _lock_record(db: AsyncSession, onboarding_token: str) -> SocialSignupChallenge:
    record = await db.scalar(
        select(SocialSignupChallenge)
        .where(
            SocialSignupChallenge.token_hash == hash_token(onboarding_token),
            SocialSignupChallenge.consumed_at.is_(None),
            SocialSignupChallenge.expires_at > func.now(),
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if record is None:
        raise BadRequestError(_ONBOARDING_EXPIRED, code="social_onboarding_expired")
    return record


def _identity_from(record: SocialSignupChallenge, user_id: UUID) -> UserIdentity:
    return UserIdentity(
        user_id=user_id,
        provider=record.provider,
        subject=record.subject,
        email=record.email,
        email_verified=record.email_verified,
        is_private_email=record.is_private_email,
        apple_refresh_token_encrypted=record.apple_refresh_token_encrypted,
        last_login_at=datetime.now(UTC),
    )


async def complete_signup(db: AsyncSession, payload: SocialCompleteRequest) -> AuthResponse:
    """Create the account for a verified identity and sign it in. All or nothing."""
    record = await _lock_record(db, payload.onboarding_token)
    usable = _email_is_usable(record)
    email = record.email if usable else (str(payload.email) if payload.email else None)
    if email is None:
        raise BadRequestError(
            "Enter an email address to finish creating your account.",
            code="social_email_required",
        )

    if await db.scalar(
        select(UserIdentity.id).where(
            UserIdentity.provider == record.provider, UserIdentity.subject == record.subject
        )
    ):
        raise ConflictError(
            "This sign-in is already linked to an account. Sign in again.",
            code="social_identity_already_linked",
        )
    username_taken = await db.scalar(select(User.id).where(User.username == payload.username))
    email_taken = await db.scalar(select(User.id).where(User.email == email))
    if username_taken is not None:
        raise ConflictError("That username is taken.", code="social_username_taken")
    if email_taken is not None:
        if usable:
            # The person holds a verified address of this account: offering to link is safe.
            raise ConflictError(
                "An Aures account already uses this email. Sign in to it to link this sign-in.",
                code="social_email_in_use",
            )
        # A typed, unverified address: say no more than registration does.
        raise ConflictError("Email or username is already taken", code="social_email_in_use")

    first_name = _clean_name(payload.first_name) or record.first_name
    user = User(
        email=email,
        username=payload.username,
        password_hash=None,
        first_name=first_name,
        last_name=record.last_name,
        timezone=payload.timezone,
        locale=payload.locale,
    )
    db.add(user)
    try:
        await db.flush()
        db.add(_identity_from(record, user.id))
        await db.delete(record)
        tokens = await _issue_token_pair(db, user.id, credential_version=0)
        await db.commit()
    except IntegrityError:
        # A concurrent completion of the same identity, or a username/email taken in the
        # meantime: everything this request did, including the user row, is undone.
        await db.rollback()
        raise ConflictError(
            "That could not be completed. Check your details, or sign in again.",
            code="social_conflict",
        ) from None
    await db.refresh(user)
    return AuthResponse(user=UserProfile.model_validate(user), tokens=tokens)


# ── linking to an account the person already has ──────────────────────────


async def _refuse_if_conflicting(
    db: AsyncSession, user_id: UUID, provider: str, subject: str
) -> None:
    if await db.scalar(
        select(UserIdentity.id).where(
            UserIdentity.user_id == user_id, UserIdentity.provider == provider
        )
    ):
        raise ConflictError(
            f"This account already has a {_name(provider)} sign-in linked.",
            code="social_provider_already_linked",
        )
    if await db.scalar(
        select(UserIdentity.id).where(
            UserIdentity.provider == provider, UserIdentity.subject == subject
        )
    ):
        raise ConflictError(
            f"That {_name(provider)} account is already linked to a different Aures account.",
            code="social_identity_already_linked",
        )


async def _password_proof(
    db: AsyncSession, throttle: AuthThrottle, email: str, password: str
) -> User:
    """The account whose password this is. Counted like a sign-in attempt; only failures stay."""
    attempt = await throttle.login_account(email)
    user = await db.scalar(select(User).where(User.email == email))
    stored = user.password_hash if user is not None else None
    try:
        hash_ = stored if stored is not None else await offload(dummy_password_hash)
        matches = await password_matches(password, hash_)
    except PasswordWorkBusyError:
        await attempt.refund()
        raise
    if user is None or stored is None or not matches:
        raise UnauthorizedError(_WRONG_PASSWORD, code="invalid_credentials")
    await attempt.refund()
    return user


async def link_existing_account(
    db: AsyncSession, payload: SocialLinkExistingRequest, throttle: AuthThrottle
) -> AuthResponse:
    """Sign in to an existing account with its password and attach the onboarding identity.

    The email typed here is only how the person says which account; the password is the
    proof, and the identity comes from the fresh onboarding record, never from the email.
    """
    account = await _password_proof(db, throttle, str(payload.email), payload.password)
    user_id = account.id
    record = await _lock_record(db, payload.onboarding_token)
    user = await db.scalar(
        select(User)
        .where(User.id == user_id)
        .with_for_update(read=True)
        .execution_options(populate_existing=True)
    )
    if user is None:
        raise UnauthorizedError(_WRONG_PASSWORD, code="invalid_credentials")
    await _refuse_if_conflicting(db, user.id, record.provider, record.subject)
    db.add(_identity_from(record, user.id))
    await db.delete(record)
    tokens = await _issue_token_pair(db, user.id, credential_version=user.credential_version)
    try:
        await db.commit()
    except IntegrityError as error:
        await db.rollback()
        if references_missing_user(error):
            raise UnauthorizedError(_WRONG_PASSWORD, code="invalid_credentials") from None
        raise ConflictError(
            "That sign-in is already linked to an account.",
            code="social_identity_already_linked",
        ) from None
    await db.refresh(user)
    return AuthResponse(user=UserProfile.model_validate(user), tokens=tokens)


async def prove_provider_control(
    db: AsyncSession, social: Social, user: User, credential: ProviderCredential
) -> None:
    """A fresh credential from a provider this account already has. 403 if it is anyone else's."""
    identity = await verify_credential(db, social, credential, signed_in=True)
    row = await db.scalar(
        select(UserIdentity.id).where(
            UserIdentity.provider == identity.provider,
            UserIdentity.subject == identity.subject,
            UserIdentity.user_id == user.id,
        )
    )
    if row is None:
        # 403, not 401: the client reads a 401 as a dead session and signs out.
        raise ForbiddenError("That is not a sign-in linked to this account.", code="reauth_failed")


async def link_to_signed_in_account(
    db: AsyncSession,
    social: Social,
    user: User,
    payload: LinkProviderRequest,
    throttle: AuthThrottle,
) -> SignInMethods:
    """Add a provider to the signed-in account, after proving control of it again."""
    user_id, email = user.id, user.email
    if payload.password is not None:
        if not user.has_password:
            raise ForbiddenError("This account has no password.", code="reauth_failed")
        try:
            proven = await _password_proof(db, throttle, email, payload.password)
        except UnauthorizedError:
            # 403, not 401: a wrong password here is not a dead session.
            raise ForbiddenError("Incorrect password", code="reauth_failed") from None
        if proven.id != user_id:
            raise ForbiddenError("Incorrect password", code="reauth_failed")
    else:
        assert payload.reauthenticate_with is not None
        await prove_provider_control(db, social, user, payload.reauthenticate_with)

    credential = payload.credential
    identity = await verify_credential(db, social, credential, signed_in=True)
    encrypted = await _apple_refresh_token_for_storage(social, credential)
    await _refuse_if_conflicting(db, user_id, identity.provider, identity.subject)
    db.add(
        UserIdentity(
            user_id=user_id,
            provider=identity.provider,
            subject=identity.subject,
            email=identity.email,
            email_verified=identity.email_verified,
            is_private_email=identity.is_private_email,
            apple_refresh_token_encrypted=encrypted,
            last_login_at=datetime.now(UTC),
        )
    )
    try:
        await db.commit()
    except IntegrityError as error:
        await db.rollback()
        if references_missing_user(error):
            raise UnauthorizedError("Invalid or expired access token") from None
        raise ConflictError(
            "That sign-in is already linked to an account.",
            code="social_identity_already_linked",
        ) from None
    return await sign_in_methods(db, user_id)


async def sign_in_methods(db: AsyncSession, user_id: UUID) -> SignInMethods:
    has_password = await db.scalar(
        select(User.password_hash.is_not(None)).where(User.id == user_id)
    )
    rows = (
        await db.scalars(
            select(UserIdentity).where(UserIdentity.user_id == user_id).order_by(UserIdentity.id)
        )
    ).all()
    return SignInMethods(
        has_password=bool(has_password),
        providers=[LinkedProvider.model_validate(row) for row in rows],
    )


# ── deletion support ──────────────────────────────────────────────────────


async def apple_tokens_for_revocation(db: AsyncSession, social: Social, user_id: UUID) -> list[str]:
    """The account's stored Apple refresh tokens, readable now. Read before the account is gone."""
    if social.box is None:
        return []
    stored = (
        await db.scalars(
            select(UserIdentity.apple_refresh_token_encrypted).where(
                UserIdentity.user_id == user_id,
                UserIdentity.provider == "apple",
                UserIdentity.apple_refresh_token_encrypted.is_not(None),
            )
        )
    ).all()
    tokens = (social.box.decrypt(value) for value in stored if value)
    return [token for token in tokens if token]


async def revoke_apple_tokens(providers: SocialProviders, tokens: list[str]) -> None:
    """After the account is deleted: tell Apple. Best effort, so an outage never blocks deletion.

    If Apple cannot be reached the authorization stays until the person removes the app in
    Settings > Apple Account > Sign in with Apple; the account itself is already gone.
    """
    for token in tokens:
        try:
            if not await providers.revoke_apple(token):
                logger.warning("apple authorization was not revoked for a deleted account")
        except Exception:  # a background task must never raise
            logger.warning("apple authorization revocation failed for a deleted account")


# ── Apple server-to-server notifications ──────────────────────────────────

_REVOKING_EVENTS = {"consent-revoked", "account-delete"}


async def handle_apple_notification(db: AsyncSession, social: Social, payload: str) -> None:
    """The person withdrew consent, or deleted their Apple ID.

    The stored token is useless then, so it goes, and the identity is marked. If Apple was
    the account's only way in (no password), every session ends too: whoever holds a stolen
    session of an account whose owner just revoked access must not keep it. An account that
    also has a password keeps its sessions, which that password established.
    The identity row stays, so signing in with Apple again (a fresh authorization) reaches
    the same account.
    """
    try:
        event = await social.providers.verify_apple_notification(payload)
    except CredentialRejected:
        raise UnauthorizedError("Invalid notification", code="social_credential_invalid") from None
    except ProviderUnavailable:
        raise _unavailable("apple") from None
    if event.event_type not in _REVOKING_EVENTS:
        return
    row = await db.scalar(
        select(UserIdentity).where(
            UserIdentity.provider == "apple", UserIdentity.subject == event.subject
        )
    )
    if row is None:
        return
    identity_id, user_id = row.id, row.user_id

    await db.execute(text(f"SET LOCAL lock_timeout = '{_LOCK_TIMEOUT}'"))
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
    locked = await db.scalar(
        select(User.password_hash).where(User.id == user_id).with_for_update()
    )
    still_there = await db.scalar(select(User.id).where(User.id == user_id))
    if still_there is None:
        await db.rollback()
        return
    await db.execute(
        update(UserIdentity)
        .where(UserIdentity.id == identity_id)
        .values(authorization_revoked_at=func.now(), apple_refresh_token_encrypted=None)
    )
    if locked is None:  # no password: Apple was the way in
        await db.execute(
            update(User)
            .where(User.id == user_id)
            .values(credential_version=User.credential_version + 1)
        )
        await db.execute(delete(RefreshToken).where(RefreshToken.user_id == user_id))
    await db.commit()
