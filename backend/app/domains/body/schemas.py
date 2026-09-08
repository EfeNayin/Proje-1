"""Request and response models for body measurements."""

from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class BodyMeasurementUpsert(BaseModel):
    """Today's weigh-in. weight_kg is mandatory: unlike the readiness
    check-in, there is no meaningful "empty" submission here — the whole
    point of this endpoint is recording a weight."""

    weight_kg: Decimal = Field(ge=20, le=400, decimal_places=1)
    body_fat_pct: Decimal | None = Field(default=None, ge=1, le=70, decimal_places=1)
    notes: str | None = Field(default=None, max_length=2000)


class BodyMeasurementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    measured_on: date
    weight_kg: Decimal
    body_fat_pct: Decimal | None
    notes: str | None


class BodyMeasurementQuery(BaseModel):
    limit: int = Field(default=50, ge=1, le=200)


class BodyMeasurementHistoryResponse(BaseModel):
    """Newest first, matching idx_body_measurements_user_date."""

    items: list[BodyMeasurementRead]


class BodySummary(BaseModel):
    """The weight history screen's header: current weight, last weigh-in
    date, and the change since the very first recorded measurement.

    Every field is None when the user has no measurements at all — there is
    no "0 kg" to fall back to.
    """

    current_weight_kg: Decimal | None
    last_measured_on: date | None
    first_weight_kg: Decimal | None
    first_measured_on: date | None
    change_kg: Decimal | None
