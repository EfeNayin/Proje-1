"""Request and response models for the auth endpoints."""

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

# bcrypt hashes at most 72 BYTES and silently ignores the rest. Two passwords
# sharing their first 72 bytes would therefore be interchangeable, so we
# reject anything longer instead of truncating it quietly.
BCRYPT_MAX_BYTES = 72

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


class RegisterRequest(BaseModel):
    email: EmailStr
    username: Username
    password: Password
    display_name: str | None = Field(default=None, max_length=100)

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
    display_name: str | None
    bio: str | None
    is_private: bool
    weight_unit: str
    created_at: datetime


class AuthResponse(BaseModel):
    """Returned by register and login: the account plus a fresh token pair."""

    user: UserProfile
    tokens: TokenPair