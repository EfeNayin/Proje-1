"""Request and response models for the auth endpoints."""

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID
from zoneinfo import available_timezones

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

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


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


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
    created_at: datetime


class AuthResponse(BaseModel):
    """Returned by register and login: the account plus a fresh token pair."""

    user: UserProfile
    tokens: TokenPair