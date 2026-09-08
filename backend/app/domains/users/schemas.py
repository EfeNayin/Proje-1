"""Request and response models for the user endpoints."""

from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator

# Re-exported so callers have a single obvious place to import the profile
# shape from, even though it is defined alongside the auth responses.
from app.domains.auth.schemas import (
    Gender,
    SupportedLocale,
    Username,
    UserProfile,
    validate_timezone,
)

__all__ = ["UserProfile", "UserUpdate"]


class UserUpdate(BaseModel):
    """Partial profile update. Every field is optional.

    email is deliberately excluded: changing it needs a verification flow,
    which is out of scope for now. username IS changeable here — see
    app.domains.users.service.update_profile for the uniqueness check, since
    a Pydantic field alone cannot query the database.
    """

    first_name: str | None = Field(default=None, max_length=100)
    last_name: str | None = Field(default=None, max_length=100)
    username: Username | None = None
    bio: str | None = Field(default=None, max_length=1000)
    is_private: bool | None = None
    weight_unit: Literal["kg", "lb"] | None = None

    # Users travel and relocate, so the timezone has to be changeable. Note
    # that changing it re-slices past workouts into weeks under the new zone,
    # which is the intended behaviour: the "week" a session belongs to follows
    # where the user is now.
    timezone: str | None = None
    locale: SupportedLocale | None = None

    # Personal details (Personal Details screen). Current weight is
    # deliberately NOT here — it is set through PUT /body/measurements, which
    # appends a new history row instead of overwriting a single field.
    height_cm: Decimal | None = Field(default=None, ge=50, le=300, decimal_places=1)
    date_of_birth: date | None = None
    gender: Gender | None = None
    goal_weight_kg: Decimal | None = Field(default=None, ge=20, le=400, decimal_places=1)

    @field_validator("timezone")
    @classmethod
    def timezone_is_known(cls, value: str | None) -> str | None:
        # None means "leave unchanged" and must skip validation.
        return value if value is None else validate_timezone(value)