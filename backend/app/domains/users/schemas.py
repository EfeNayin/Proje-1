"""Request and response models for the user endpoints."""

from typing import Literal

from pydantic import BaseModel, Field, field_validator

# Re-exported so callers have a single obvious place to import the profile
# shape from, even though it is defined alongside the auth responses.
from app.domains.auth.schemas import SupportedLocale, UserProfile, validate_timezone

__all__ = ["UserProfile", "UserUpdate"]


class UserUpdate(BaseModel):
    """Partial profile update. Every field is optional.

    email and username are deliberately excluded: changing them needs a
    verification flow, which is out of scope for now.
    """

    display_name: str | None = Field(default=None, max_length=100)
    bio: str | None = Field(default=None, max_length=1000)
    is_private: bool | None = None
    weight_unit: Literal["kg", "lb"] | None = None

    # Users travel and relocate, so the timezone has to be changeable. Note
    # that changing it re-slices past workouts into weeks under the new zone,
    # which is the intended behaviour: the "week" a session belongs to follows
    # where the user is now.
    timezone: str | None = None
    locale: SupportedLocale | None = None

    @field_validator("timezone")
    @classmethod
    def timezone_is_known(cls, value: str | None) -> str | None:
        # None means "leave unchanged" and must skip validation.
        return value if value is None else validate_timezone(value)