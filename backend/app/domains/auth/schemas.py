"""Request and response models for the auth endpoints."""

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID
from zoneinfo import available_timezones

from pydantic import AfterValidator, BaseModel, ConfigDict, EmailStr, Field, field_validator

# bcrypt hashes at most 72 BYTES and silently ignores the rest. Two passwords
# sharing their first 72 bytes would therefore be interchangeable, so we
# reject anything longer instead of truncating it quietly.
BCRYPT_MAX_BYTES = 72

# Languages the product currently ships. Adding one is a code change (you need
# the translations anyway), which is why this lives here and not as a database
# CHECK constraint that would force a migration.
SupportedLocale = Literal["tr", "en"]

Gender = Literal["male", "female", "other", "prefer_not_to_say"]

# Inputs to the nutrition goal formula (Mifflin-St Jeor + activity multiplier).
# Defined here, alongside Gender, since UserProfile needs both — they are
# also directly editable through PATCH /users/me, not just through the
# nutrition domain.
ActivityLevel = Literal["sedentary", "light", "moderate", "active", "very_active"]
NutritionGoalKind = Literal["cut", "maintain", "bulk"]

# Every name in Python's IANA database is also known to PostgreSQL, so a value
# that passes this check is safe to use in `AT TIME ZONE` later. Computed once
# at import: the set has ~600 entries and never changes at runtime.
#
# NOTE: this relies on the IANA database being available. Debian slim images do
# not always ship one, and without it available_timezones() returns an EMPTY
# set, which would reject every timezone. requirements.txt therefore pins the
# `tzdata` package as a guaranteed fallback.
_VALID_TIMEZONES = available_timezones()

Username = Annotated[
    str,
    Field(
        min_length=3,
        max_length=50,
        pattern=r"^[a-zA-Z0-9_]+$",
        examples=["efenayin"],
    ),
]

Password = Annotated[str, Field(min_length=8, max_length=72, examples=["s3cret-passphrase"])]

# ── Phone number (optional, unverified contact information) ──
# Stored as E.164: "+", the country calling code, the subscriber number, digits only, at
# most 15 of them (ITU-T E.164). The rule is structural. It does NOT know which numbers
# exist, what length a country uses, or whether the number is reachable (that needs a
# numbering-plan library and, for the last one, a verification flow, neither of which
# exists here), so it is contact information the owner typed, never proof of anything.
# The mobile client applies the same rule (mobile/src/account/phoneNumber.ts); keep the two
# in step, and the shared cases in tests/test_phone_number.py and
# mobile/tests/phone-number.test.cjs.
PHONE_INPUT_MAX_LENGTH = 40
_PHONE_MIN_DIGITS = 8
_PHONE_MAX_DIGITS = 15
_PHONE_SEPARATORS = " \t-.()"
PHONE_COUNTRY_CODE_HINT = (
    "Start with the country code, for example +90 532 123 45 67. "
    "Spaces, hyphens, dots and parentheses are allowed."
)


def normalize_phone_number(value: str) -> str | None:
    """"+90 (532) 123-45-67" -> "+905321234567"; blank -> None; anything else -> ValueError.

    Messages never contain the value: validation errors reach logs and clients.
    """
    text = value.strip()
    if not text:
        return None
    if text.startswith("00"):  # the international call prefix many countries dial instead of +
        text = "+" + text[2:]
    if not text.startswith("+"):
        raise ValueError(f"Phone number needs an explicit country code. {PHONE_COUNTRY_CODE_HINT}")
    digits = "".join(character for character in text[1:] if character not in _PHONE_SEPARATORS)
    # ASCII digits only: str.isdigit() also accepts other scripts' digits and superscripts.
    if not digits or any(character not in "0123456789" for character in digits):
        raise ValueError(
            f"Phone number may contain only digits after the +. {PHONE_COUNTRY_CODE_HINT}"
        )
    if digits[0] == "0":
        raise ValueError(f"A country code never starts with 0. {PHONE_COUNTRY_CODE_HINT}")
    if not _PHONE_MIN_DIGITS <= len(digits) <= _PHONE_MAX_DIGITS:
        raise ValueError(
            f"Phone number must have {_PHONE_MIN_DIGITS} to {_PHONE_MAX_DIGITS} digits "
            "including the country code."
        )
    return "+" + digits


def _fits_bcrypt(value: str) -> str:
    if len(value.encode("utf-8")) > BCRYPT_MAX_BYTES:
        raise ValueError(
            f"Password must be at most {BCRYPT_MAX_BYTES} bytes "
            "(non-ASCII characters count as more than one byte)"
        )
    return value


# The registration rules, for a password that is chosen again (password recovery).
NewPassword = Annotated[Password, AfterValidator(_fits_bcrypt)]


def validate_timezone(value: str) -> str:
    """Reject anything that is not an IANA timezone name.

    An unchecked value would be stored happily and then blow up much later,
    inside the analytics query, when PostgreSQL evaluates `AT TIME ZONE`.
    """
    if value not in _VALID_TIMEZONES:
        raise ValueError(f"Unknown IANA timezone: {value!r}. Example: 'Europe/Istanbul'")
    return value


class RegisterRequest(BaseModel):
    email: EmailStr
    username: Username
    password: Password
    first_name: str | None = Field(default=None, max_length=100)

    # Optional and unverified. Omitted, null and blank all mean "none", so older clients
    # (which never send it) keep working; anything else is normalized to E.164 or refused.
    phone_number: str | None = Field(default=None, max_length=PHONE_INPUT_MAX_LENGTH)

    # Clients should send the device's timezone. The default keeps signup
    # working if they do not, and matches the current primary market.
    timezone: str = Field(default="Europe/Istanbul", examples=["Europe/Istanbul"])
    locale: SupportedLocale = "tr"

    @field_validator("password")
    @classmethod
    def password_fits_bcrypt(cls, value: str) -> str:
        # Length is checked in bytes, not characters: Turkish letters such as
        # "ğ" or "ş" take 2 bytes each, so 72 characters can exceed 72 bytes.
        if len(value.encode("utf-8")) > BCRYPT_MAX_BYTES:
            raise ValueError(
                f"Password must be at most {BCRYPT_MAX_BYTES} bytes "
                "(non-ASCII characters count as more than one byte)"
            )
        return value

    @field_validator("timezone")
    @classmethod
    def timezone_is_known(cls, value: str) -> str:
        return validate_timezone(value)

    @field_validator("phone_number")
    @classmethod
    def phone_number_is_normalized(cls, value: str | None) -> str | None:
        return None if value is None else normalize_phone_number(value)


class LoginRequest(BaseModel):
    email: EmailStr
    # Bounded only so absurd input is refused before it reaches bcrypt (passlib
    # raises on very long secrets, which used to surface as a 500). Deliberately
    # far above the 72-byte registration limit; the exact rule is in
    # service.login.
    password: str = Field(max_length=1024)


class PasswordRecoveryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr


class PasswordRecoveryAccepted(BaseModel):
    """The one answer to a recovery request, whether or not the address has an account."""

    message: str
    # Constants of the deployment, so they say nothing about the address.
    code_valid_minutes: int
    resend_after_seconds: int


class PasswordRecoveryConfirm(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    # What the person typed: spaces and hyphens are tolerated and removed by the service.
    code: str = Field(max_length=32)
    new_password: NewPassword


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    # Seconds until the access token expires, so clients can refresh ahead of
    # time instead of waiting for a 401.
    expires_in: int


class UserProfile(BaseModel):
    """A user's own profile. Includes email, so never return it for someone else."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    username: str
    first_name: str | None
    last_name: str | None
    # Private contact information of the account owner: it appears only in the owner's own
    # profile (this model is never used for anyone else) and nowhere in coach or athlete views.
    phone_number: str | None
    bio: str | None
    is_private: bool
    weight_unit: str
    timezone: str
    locale: str
    height_cm: Decimal | None
    date_of_birth: date | None
    gender: Gender | None
    goal_weight_kg: Decimal | None
    activity_level: ActivityLevel | None
    nutrition_goal: NutritionGoalKind | None
    coach_enabled: bool
    # False for an account created with Google or Apple. The app uses it to decide how the
    # person confirms sensitive actions (a password, or signing in with the provider again).
    has_password: bool
    created_at: datetime


class AuthResponse(BaseModel):
    """Returned by register and login: the account plus a fresh token pair."""

    user: UserProfile
    tokens: TokenPair