"""Request and response models for the exercise catalogue."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

Equipment = Literal["barbell", "dumbbell", "machine", "cable", "bodyweight"]


class MuscleGroupSummary(BaseModel):
    """A muscle group with its weekly volume landmarks.

    MEV / MAV / MRV are weekly working-set counts:
      mev - below this, little growth stimulus
      mav - the productive range
      mrv - above this, recovery starts failing
    The client compares actual weekly volume against these.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    name_tr: str
    region: str
    mev: int | None
    mav: int | None
    mrv: int | None


class MuscleContribution(BaseModel):
    """How much one exercise loads one muscle.

    contribution_pct drives the volume split: a bench press set counts as 0.65
    chest sets rather than a whole one.
    """

    name: str
    name_tr: str
    role: Literal["primary", "secondary"]
    contribution_pct: int


class ExerciseSummary(BaseModel):
    """List-view shape. No muscle breakdown, to keep list responses small."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    name_tr: str | None
    equipment: str | None
    is_compound: bool


class ExerciseDetail(ExerciseSummary):
    """Single-exercise view, including which muscles it trains."""

    muscles: list[MuscleContribution]


class ExerciseListResponse(BaseModel):
    """Paginated list.

    `total` is the count matching the filters, not the page size, so the
    client can render "showing 20 of 137" and decide whether to fetch more.
    """

    items: list[ExerciseSummary]
    total: int
    limit: int
    offset: int


class ExerciseQuery(BaseModel):
    """Filters for GET /exercises, validated as a group."""

    q: str | None = Field(
        default=None,
        max_length=100,
        description="Search in both names. Accent-insensitive: 'gogus' matches 'Göğüs'.",
    )
    equipment: Equipment | None = None
    muscle: str | None = Field(
        default=None,
        max_length=30,
        description="Muscle group code, e.g. 'chest'.",
    )
    limit: int = Field(default=50, ge=1, le=100)
    offset: int = Field(default=0, ge=0)