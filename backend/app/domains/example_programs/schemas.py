"""Response and request models for the example-program library."""

from pydantic import BaseModel, Field

from app.domains.example_programs.catalogue import Level


class ExampleSource(BaseModel):
    title: str
    citation: str
    url: str
    # What the source found. Aures's own choices are in `authored`, never here.
    finding: str


class ExampleSummary(BaseModel):
    id: str
    version: int
    level: Level
    name: str
    summary: str
    sessions_per_week: int
    schedule: str
    day_count: int
    exercise_count: int
    weekly_working_sets: int


class ExampleExercise(BaseModel):
    exercise_name: str
    exercise_order: int
    target_sets: int
    target_reps_min: int
    target_reps_max: int
    target_rir: int
    notes: str | None


class ExampleDay(BaseModel):
    name: str
    day_order: int
    notes: str | None
    exercises: list[ExampleExercise]


class ExampleDetail(ExampleSummary):
    sequence: list[str]
    days: list[ExampleDay]
    sources: list[ExampleSource]
    authored: list[str]


class ExampleList(BaseModel):
    examples: list[ExampleSummary]


class ExampleCopyRequest(BaseModel):
    """What the client previewed. The server checks it against the current content."""

    example_id: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9-]*$")
    version: int = Field(ge=1, le=1000)
