"""Request and response models for the user endpoints."""

from typing import Literal

from pydantic import BaseModel, Field

# Re-exported so callers have a single obvious place to import the profile
# shape from, even though it is defined alongside the auth responses.
from app.domains.auth.schemas import UserProfile

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