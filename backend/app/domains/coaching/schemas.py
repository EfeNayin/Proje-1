"""Request and response models for the coaching endpoints.

Only what the other party needs to recognise someone is exposed: username and
the name they chose to show. Never email or any training data.
"""

from datetime import datetime
from decimal import Decimal
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
    # Whether the athlete lets the coach read their completed workouts. Both
    # sides see the state; only the athlete can change it.
    shares_workouts: bool


class ConnectionList(BaseModel):
    items: list[Connection]


class WorkoutSharingRequest(BaseModel):
    enabled: bool


class AthleteWorkoutSummary(BaseModel):
    """A completed session as the coach's list needs it. No notes, no volume."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str | None
    performed_at: datetime
    finished_at: datetime
    # False: the athlete pressed Finish, so finished_at - performed_at is a
    # real duration. True: closed when a later session started. None: unknown.
    finished_automatically: bool | None
    # Working sets; warm-ups are not counted (same meaning as the athlete's own list).
    total_sets: int


class AthleteWorkoutList(BaseModel):
    items: list[AthleteWorkoutSummary]
    total: int
    limit: int
    offset: int


class AthleteSet(BaseModel):
    set_number: int
    weight_kg: Decimal
    reps: int
    # None: not recorded. 0 is a real value (nothing left in reserve).
    rir: int | None
    is_warmup: bool


class AthleteExercise(BaseModel):
    exercise_id: UUID
    name: str
    sets: list[AthleteSet]


class AthleteWorkoutDetail(AthleteWorkoutSummary):
    exercises: list[AthleteExercise]
