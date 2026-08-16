"""Response models for training analytics."""

from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

VolumeStatus = Literal["untrained", "below_mev", "optimal", "high", "above_mrv"]


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