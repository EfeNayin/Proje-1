"""Request and response models for workouts and sets."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SetCreate(BaseModel):
    """One logged set.

    set_number is not accepted from the client: the server assigns the next
    number for that exercise within the workout, so ordering stays consistent
    even after sets are deleted and renumbered.
    """

    exercise_id: UUID
    weight_kg: Decimal = Field(ge=0, le=1000, decimal_places=2)
    reps: int = Field(ge=0, le=1000)

    # Two different effort scales; users typically fill in one or neither.
    rir: int | None = Field(default=None, ge=0, le=10)
    rpe: Decimal | None = Field(default=None, ge=1, le=10, decimal_places=1)

    # Warmups are excluded from volume analytics.
    is_warmup: bool = False


class SetUpdate(BaseModel):
    """Partial update. Omitted fields keep their value.

    exercise_id is excluded: moving a set to a different exercise would break
    its numbering. Delete and re-add instead.
    """

    weight_kg: Decimal | None = Field(default=None, ge=0, le=1000, decimal_places=2)
    reps: int | None = Field(default=None, ge=0, le=1000)
    rir: int | None = Field(default=None, ge=0, le=10)
    rpe: Decimal | None = Field(default=None, ge=1, le=10, decimal_places=1)
    is_warmup: bool | None = None


class SetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    exercise_id: UUID
    exercise_name: str
    set_number: int
    weight_kg: Decimal
    reps: int
    rir: int | None
    rpe: Decimal | None
    is_warmup: bool


class WorkoutCreate(BaseModel):
    """Start a session.

    Sets can be sent inline so a client that logged a whole session offline
    can sync it in one request, or left out and added one at a time.
    """

    title: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=2000)
    # Defaults to now. Sent explicitly when logging a past session.
    performed_at: datetime | None = None
    is_private: bool = True
    sets: list[SetCreate] = Field(default_factory=list, max_length=200)


class WorkoutUpdate(BaseModel):
    """Partial update of the session's own fields, not its sets."""

    title: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=2000)
    performed_at: datetime | None = None
    is_private: bool | None = None


class WorkoutSummary(BaseModel):
    """List-view shape.

    total_volume_kg and total_sets are stored on the row rather than computed
    per request, so the history screen renders without touching the sets
    table. Both exclude warmups.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str | None
    performed_at: datetime
    total_volume_kg: Decimal
    total_sets: int
    is_private: bool
    # Which template this session was started from, if any. Free logging
    # (no template) leaves this null; the client uses it to decide whether
    # to fetch and display target goals alongside logged sets.
    template_id: UUID | None


class WorkoutDetail(WorkoutSummary):
    notes: str | None
    sets: list[SetRead]


class WorkoutListResponse(BaseModel):
    items: list[WorkoutSummary]
    total: int
    limit: int
    offset: int


class WorkoutQuery(BaseModel):
    limit: int = Field(default=20, ge=1, le=100)
    offset: int = Field(default=0, ge=0)