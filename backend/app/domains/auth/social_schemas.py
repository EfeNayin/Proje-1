"""Request and response models for Sign in with Google / Apple.

Validation errors never echo what was sent (see main.py), which matters here: these bodies
carry authorization codes, identity tokens and passwords.
"""

from datetime import datetime
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.domains.auth.schemas import (
    SupportedLocale,
    TokenPair,
    Username,
    UserProfile,
    validate_timezone,
)

Provider = Literal["google", "apple"]


class ProviderCredential(BaseModel):
    """What the phone got from a provider, for one attempt.

    Google: `authorization_code`, the one-time server auth code. Apple: `identity_token`
    and the `nonce` it was requested with (from POST /auth/social/nonce), plus the
    `authorization_code` when the app has it (used only to be able to revoke later). Apple
    reveals the person's name to the app on the first authorization only, so the app passes
    it along.
    """

    model_config = ConfigDict(extra="forbid")

    provider: Provider
    authorization_code: str | None = Field(default=None, min_length=1, max_length=4096)
    identity_token: str | None = Field(default=None, min_length=1, max_length=8192)
    nonce: str | None = Field(default=None, min_length=16, max_length=256)
    first_name: str | None = Field(default=None, max_length=100)
    last_name: str | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def carries_what_its_provider_needs(self) -> Self:
        if self.provider == "google":
            if not self.authorization_code or self.identity_token or self.nonce:
                raise ValueError("Google sign-in takes an authorization_code and nothing else")
        elif not self.identity_token or not self.nonce:
            raise ValueError("Apple sign-in takes an identity_token and the nonce it used")
        return self


class NonceResponse(BaseModel):
    nonce: str
    expires_in: int


class GoogleAvailability(BaseModel):
    enabled: bool
    # Public identifiers (they ship inside any app that uses them): the app configures the
    # native SDK with them. Present only while enabled.
    ios_client_id: str | None = None
    web_client_id: str | None = None


class AppleAvailability(BaseModel):
    enabled: bool


class ProviderAvailability(BaseModel):
    """Which providers this server can complete. Nothing else is advertised."""

    google: GoogleAvailability
    apple: AppleAvailability


class OnboardingOffer(BaseModel):
    """A verified identity with no Aures account yet; what the app needs to finish or link."""

    token: str
    expires_in: int
    provider: Provider
    # What the provider reported, for display. Contact data; see social_providers.py.
    email: str | None
    # Whether it becomes the account's email as is. When false the app asks for one.
    email_is_usable: bool
    is_private_email: bool
    first_name: str | None
    suggested_username: str | None


class SocialSignInResponse(BaseModel):
    status: Literal["signed_in", "onboarding"]
    user: UserProfile | None = None
    tokens: TokenPair | None = None
    onboarding: OnboardingOffer | None = None


class SocialCompleteRequest(BaseModel):
    """Create the account for a verified identity. Same username rules as registration."""

    model_config = ConfigDict(extra="forbid")

    onboarding_token: str = Field(min_length=1, max_length=256)
    username: Username
    first_name: str | None = Field(default=None, max_length=100)
    # Only used when the provider gave no usable address.
    email: EmailStr | None = None
    timezone: str = Field(default="Europe/Istanbul")
    locale: SupportedLocale = "tr"

    @field_validator("timezone")
    @classmethod
    def timezone_is_known(cls, value: str) -> str:
        return validate_timezone(value)


class SocialLinkExistingRequest(BaseModel):
    """Sign in to an existing Aures account (proof: its password) and attach the identity."""

    model_config = ConfigDict(extra="forbid")

    onboarding_token: str = Field(min_length=1, max_length=256)
    email: EmailStr
    password: str = Field(min_length=1, max_length=1024)


class LinkProviderRequest(BaseModel):
    """From a signed-in session: add a provider, proving control of the account again.

    Exactly one proof: the account's password, or a fresh credential from a provider the
    account already has (for an account that has no password).
    """

    model_config = ConfigDict(extra="forbid")

    credential: ProviderCredential
    password: str | None = Field(default=None, min_length=1, max_length=1024)
    reauthenticate_with: ProviderCredential | None = None

    @model_validator(mode="after")
    def exactly_one_proof(self) -> Self:
        if (self.password is None) == (self.reauthenticate_with is None):
            raise ValueError("Send exactly one of password or reauthenticate_with")
        return self


class LinkedProvider(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    provider: Provider
    email: str | None
    created_at: datetime


class SignInMethods(BaseModel):
    has_password: bool
    providers: list[LinkedProvider]


class AppleNotificationRequest(BaseModel):
    """What Apple posts to the notification endpoint: one signed JWT."""

    model_config = ConfigDict(extra="forbid")

    payload: str = Field(min_length=1, max_length=16384)
