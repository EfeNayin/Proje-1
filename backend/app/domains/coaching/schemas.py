"""Request and response models for the coaching endpoints.

Only what the other party needs to recognise someone is exposed: username and
the name they chose to show. Never email or any training data.
"""

from datetime import datetime
from decimal import Decimal
from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


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


# ── Program offers ───────────────────────────────────────────────────────

OfferStatus = Literal["pending", "accepted", "declined"]


class OfferExercise(BaseModel):
    """One prescription as the coach sent it. Mirrors the program target fields."""

    exercise_id: UUID
    # The name as it was when sent, so the offer reads the same later.
    exercise_name: str
    exercise_order: int = Field(ge=0)
    target_sets: int = Field(gt=0, le=20)
    target_reps_min: int | None = Field(default=None, gt=0, le=100)
    target_reps_max: int | None = Field(default=None, gt=0, le=100)
    target_rir: int | None = Field(default=None, ge=0, le=10)
    target_rpe: Decimal | None = Field(default=None, ge=1, le=10, decimal_places=1)
    notes: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def reps_range_is_consistent(self) -> Self:
        if (
            self.target_reps_min is not None
            and self.target_reps_max is not None
            and self.target_reps_min > self.target_reps_max
        ):
            raise ValueError("target_reps_min must not be greater than target_reps_max")
        return self


class OfferTemplate(BaseModel):
    name: str = Field(max_length=200)
    day_order: int = Field(ge=0, le=100)
    notes: str | None = Field(default=None, max_length=1000)
    exercises: list[OfferExercise] = Field(max_length=50)


class OfferProgram(BaseModel):
    """The frozen program: exactly what the athlete is shown and what accepting copies."""

    name: str = Field(max_length=200)
    notes: str | None = Field(default=None, max_length=1000)
    templates: list[OfferTemplate]


class ProgramOfferRequest(BaseModel):
    program_id: UUID
    # From the preview the coach confirmed. The server rebuilds the snapshot itself
    # and refuses to send anything that does not match it.
    fingerprint: str = Field(min_length=64, max_length=64, pattern="^[0-9a-f]{64}$")


class ProgramPreview(BaseModel):
    """What sending this program to this athlete would offer right now."""

    program: OfferProgram
    fingerprint: str


class OfferSummary(BaseModel):
    id: UUID
    status: OfferStatus
    program_name: str
    template_count: int
    exercise_count: int
    sent_at: datetime
    responded_at: datetime | None


class SentOffer(OfferSummary):
    """The coach's view. Never says which program the athlete ended up with."""


class SentOfferDetail(SentOffer):
    program: OfferProgram


class SentOfferList(BaseModel):
    items: list[SentOffer]
    total: int
    limit: int
    offset: int


class ReceivedOffer(OfferSummary):
    coach: PersonSummary
    # The athlete's own copy, once accepted (None while pending/declined, or
    # after they deleted the copy).
    program_id: UUID | None


class ReceivedOfferDetail(ReceivedOffer):
    program: OfferProgram


class ReceivedOfferList(BaseModel):
    items: list[ReceivedOffer]
    total: int
    limit: int
    offset: int
