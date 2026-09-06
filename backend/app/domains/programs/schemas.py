"""Request and response models for programs, templates and their exercise targets."""

from datetime import datetime
from decimal import Decimal
from typing import Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class TemplateExerciseCreate(BaseModel):
    """One exercise's targets within a template.

    target_reps_min/max express a RANGE (hypertrophy training is rarely
    programmed to a single fixed rep count); min=max is how a client asks
    for a fixed number instead. Both may be omitted, but if both are given,
    min must not exceed max — checked here so a bad range comes back as a
    422, not a 500 from the database's own CHECK constraint.
    """

    exercise_id: UUID
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


class TemplateExerciseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    exercise_id: UUID
    exercise_name: str
    exercise_order: int
    target_sets: int
    target_reps_min: int | None
    target_reps_max: int | None
    target_rir: int | None
    target_rpe: Decimal | None
    notes: str | None


class TemplateExercisesSet(BaseModel):
    """Replaces every exercise in a template in one request.

    Simpler than a partial-edit API: the builder screen always holds the
    full, reordered list in memory anyway, so a partial PATCH would not
    save the client anything.
    """

    exercises: list[TemplateExerciseCreate] = Field(max_length=50)


class WorkoutTemplateCreate(BaseModel):
    name: str = Field(max_length=200)
    day_order: int = Field(default=0, ge=0, le=100)
    notes: str | None = Field(default=None, max_length=1000)


class WorkoutTemplateUpdate(BaseModel):
    """Partial update. Omitted fields keep their value."""

    name: str | None = Field(default=None, max_length=200)
    day_order: int | None = Field(default=None, ge=0, le=100)
    notes: str | None = Field(default=None, max_length=1000)


class WorkoutTemplateRead(BaseModel):
    id: UUID
    name: str
    day_order: int
    notes: str | None
    exercises: list[TemplateExerciseRead]


class ProgramCreate(BaseModel):
    name: str = Field(max_length=200)
    notes: str | None = Field(default=None, max_length=1000)


class ProgramUpdate(BaseModel):
    """Name and notes only. is_active changes exclusively through
    POST /programs/{id}/activate, the only place the single-active-program
    invariant is enforced."""

    name: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=1000)


class ProgramSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    is_active: bool


class ProgramDetail(ProgramSummary):
    notes: str | None
    templates: list[WorkoutTemplateRead]


class TemplateStart(BaseModel):
    """What starting a workout from a template hands back.

    No sets are created — only an empty workout linked to the template.
    Targets are returned too so the client can prefill goals on the spot;
    on resume (app reopened mid-session) the client re-fetches them via
    GET /templates/{id} instead of relying on this one-time response.
    """

    workout_id: UUID
    template_id: UUID
    performed_at: datetime
    targets: list[TemplateExerciseRead]
