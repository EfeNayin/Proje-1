"""Request and response models for daily readiness logs."""

from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ReadinessUpsert(BaseModel):
    """Today's check-in. Every field is optional.

    A mandatory field here would be friction repeated before every workout;
    the point of this endpoint is that a user can submit their sleep hours
    and leave everything else blank.
    """

    sleep_hours: Decimal | None = Field(default=None, ge=0, le=24, decimal_places=1)
    sleep_quality: int | None = Field(default=None, ge=1, le=5)
    energy: int | None = Field(default=None, ge=1, le=5)
    mood: int | None = Field(default=None, ge=1, le=5)

    # Muscle group name -> soreness (1-5), e.g. {"chest": 3, "quads": 5}.
    # Keys are checked against muscle_groups.name in the service layer: the
    # database has no CHECK for this (it would need a trigger), so this is
    # the only place the constraint is enforced.
    soreness: dict[str, int] | None = None

    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("soreness")
    @classmethod
    def soreness_severities_in_range(cls, value: dict[str, int] | None) -> dict[str, int] | None:
        if value is None:
            return value
        for muscle, severity in value.items():
            if not isinstance(severity, int) or not (1 <= severity <= 5):
                raise ValueError(f"soreness[{muscle!r}] must be an integer between 1 and 5")
        return value


class ReadinessPatch(ReadinessUpsert):
    """A partial update of today's check-in: only the fields that are sent change.

    PUT replaces the whole row (an omitted field becomes empty); this does not. A field
    sent as null is cleared on purpose, a field left out is left alone, which is what a
    screen that edits only sleep needs: mood, notes, soreness and the rest are not its
    to touch. `expected_log_date` is the day the client was looking at: if the user's
    local day has changed since, nothing is written (409) rather than putting yesterday's
    draft on today.
    """

    expected_log_date: date | None = None


class ReadinessLogRead(BaseModel):
    """Today's log, or an empty shell if nothing has been submitted yet.

    id is None exactly when there is no row for today: the client uses that
    to decide whether the check-in screen has already been answered today.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int | None
    log_date: date
    sleep_hours: Decimal | None
    sleep_quality: int | None
    energy: int | None
    mood: int | None
    soreness: dict[str, int] | None
    notes: str | None


class ReadinessHistoryQuery(BaseModel):
    days: int = Field(
        default=30,
        ge=1,
        le=365,
        description="How many days back to include, counting today.",
    )


class ReadinessHistoryResponse(BaseModel):
    """Newest first, matching idx_readiness_user_date."""

    items: list[ReadinessLogRead]
