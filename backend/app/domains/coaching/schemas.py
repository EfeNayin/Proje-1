"""Request and response models for the coaching endpoints.

Only what the other party needs to recognise someone is exposed: username and
the name they chose to show. Never email or any training data.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class InviteCodeRequest(BaseModel):
    """The code travels in the body, never the URL, so it stays out of access logs."""

    code: str = Field(min_length=1, max_length=64)


class PersonSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    username: str
    first_name: str | None
    last_name: str | None


class InviteCreated(BaseModel):
    id: UUID
    # Shown once. Only its hash is stored, so it cannot be fetched again.
    code: str
    expires_at: datetime


class InvitePreview(BaseModel):
    coach: PersonSummary
    expires_at: datetime


class Connection(BaseModel):
    """An accepted link, described from the point of view of the caller.

    `person` is the athlete when a coach lists their athletes, and the coach
    when an athlete lists their coaches.
    """

    id: UUID
    person: PersonSummary
    connected_at: datetime


class ConnectionList(BaseModel):
    items: list[Connection]
