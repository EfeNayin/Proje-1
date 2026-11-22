"""Response models for training analytics."""

from datetime import date
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field

VolumeStatus = Literal["untrained", "below_mev", "optimal", "high", "above_mrv", "no_reference"]
"""no_reference: no published MEV/MAV/MRV for this muscle, so direct_sets has
nothing to be judged against. Distinct from "optimal" — that means "the count
sits inside a real published range", not "there is no range at all". Every
current seed muscle has all three landmarks, so this only fires once a muscle
is added without them (see PROJE_1_CODEX_INCELEME.md Adım 17)."""


class MuscleWeeklyVolume(BaseModel):
    """One muscle's week.

    direct_sets is the number to read against the landmarks. It counts only
    sets whose exercise trains this muscle directly (role = primary), because
    MEV/MAV/MRV are published for direct work — indirect volume from pressing
    and pulling is already accounted for in those numbers.

    involved_sets additionally counts sets where the muscle assists. It is
    context, not a target: "your triceps also took load from bench" rather
    than something to compare against a landmark.
    """

    muscle_group_id: int
    name: str
    name_tr: str
    region: str

    direct_sets: int
    involved_sets: int

    # Mean effectiveness (1-5) of the direct sets. Answers "is the work you
    # did for this muscle any good", not just "how much". None when there was
    # no direct work to average.
    avg_effectiveness: float | None

    # Tonnage from direct sets only, in kg.
    volume_kg: Decimal

    mev: int | None
    mav: int | None
    mrv: int | None

    status: VolumeStatus


class WeeklyVolume(BaseModel):
    """Every muscle for one week.

    week_start is the Monday of that week in the user's own timezone. A
    session logged at 01:00 Monday in Istanbul belongs to that week, even
    though it is still Sunday in UTC.
    """

    week_start: date
    muscles: list[MuscleWeeklyVolume]


class WeeklyVolumeResponse(BaseModel):
    """Most recent week first. Weeks with no training are still listed, so a
    gap in the data reads as "you did not train" rather than disappearing."""

    weeks: list[WeeklyVolume]
    timezone: str


class WeeklyVolumeQuery(BaseModel):
    weeks: int = Field(
        default=4,
        ge=1,
        le=52,
        description="How many weeks back to include, counting the current one.",
    )


FindingCode = Literal[
    "volume_below_mev",
    "volume_above_mrv",
    "muscles_untrained",
    "sleep_low",
    "sleep_very_low",
    "readiness_no_data",
    "weight_stalled_bulk",
    "weight_stalled_cut",
    "weight_on_track",
    "weight_no_data",
    "training_infrequent",
    "training_consistent",
]

FindingSeverity = Literal["critical", "warning", "good", "info"]


class Finding(BaseModel):
    """One diagnosis finding.

    `data` is a plain object rather than a per-code typed model on purpose:
    the client renders the message text (translation is coming later and
    must not force a rewrite of this endpoint), so the server's only job is
    to hand over the code plus whatever numbers that code's message needs.
    """

    code: FindingCode
    severity: FindingSeverity
    data: dict[str, Any]


class DiagnosisQuery(BaseModel):
    weeks: int = Field(
        default=4,
        ge=1,
        le=52,
        description="Maximum completed training weeks to evaluate; excludes the current week.",
    )


class TrainingCoverage(BaseModel):
    period_start: date | None
    period_end: date
    completed_weeks: int
    weeks_with_work: int
    sessions: int
    required_weeks_with_work: int = 2


DomainState = Literal["sufficient", "insufficient", "stale", "missing", "not_applicable"]
"""How much a domain's records can support, kept apart on purpose:

- sufficient: enough records, recent enough, for the comparison this domain makes.
- insufficient: some records exist, but too few (or spanning too short a time).
- stale: enough records, but the latest one is too old to describe the present.
- missing: no records at all in the evaluated window. This says nothing about what
  happened: an empty log is not evidence of no training, zero hours of sleep or no
  change in weight.
- not_applicable: the comparison does not apply (weight without a directional goal).
"""

DomainReason = Literal[
    "no_working_sets",
    "no_completed_week",
    "too_few_weeks_with_work",
    "no_sleep_records",
    "too_few_nights",
    "stale_records",
    "no_measurements",
    "too_few_measurements",
    "short_span",
    "stale_measurements",
    "no_goal",
    "goal_maintain",
]


class DomainCoverage(BaseModel):
    """What one domain's evaluation rests on: its own window and its own records.

    The windows differ: training covers whole completed local weeks, sleep and weight
    cover the selected number of days up to today. `period_*` is the window that was
    searched; `first_recorded_on` / `last_recorded_on` are the dates of the records
    actually found in it (training: the days with recorded working sets).
    `latest_age_days` is the age of the newest record (sleep and weight only).
    """

    state: DomainState
    reason: DomainReason | None
    period_start: date | None
    period_end: date | None
    record_count: int
    first_recorded_on: date | None
    last_recorded_on: date | None
    latest_age_days: int | None


class DiagnosisDomains(BaseModel):
    training: DomainCoverage
    sleep: DomainCoverage
    weight: DomainCoverage


class DiagnosisResponse(BaseModel):
    """Structural findings across volume, recovery, weight trend and
    consistency. Capped at a handful of findings — see analytics/service.py's
    diagnosis() for why: showing everything is the same as showing nothing.

    `has_enough_data` is about TRAINING records only (the gate for the volume and
    consistency findings). It does not say the whole assessment is complete: sleep and
    weight are judged on their own records, and their findings are returned even when
    training is insufficient. `domains` states what each one rests on.
    """

    period_weeks: int
    has_enough_data: bool
    training_coverage: TrainingCoverage
    findings: list[Finding]
    today: date
    timezone: str
    domains: DiagnosisDomains
