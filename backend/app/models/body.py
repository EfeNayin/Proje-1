"""Body measurement model.

Maps to body_measurements_schema.sql -> body_measurements
"""

from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Numeric,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at, updated_at


class BodyMeasurement(Base):
    """One day's weigh-in.

    Kept as its own table rather than a users.current_weight column: the
    latest row by measured_on already IS the current weight, but the weight
    history screen also needs every prior row for its trend. Named
    body_measurements, not weight_logs, because body fat percentage and
    circumference measurements will land in this same table later without a
    rename.
    """

    __tablename__ = "body_measurements"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    user_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # The user's own local calendar day (users.timezone), never accepted from
    # the client — same reasoning as readiness_logs.log_date: a weigh-in
    # logged at 01:00 in Istanbul must land on that day, not UTC's previous one.
    measured_on: Mapped[date] = mapped_column(Date, nullable=False)

    weight_kg: Mapped[Decimal] = mapped_column(Numeric(5, 1), nullable=False)
    body_fat_pct: Mapped[Decimal | None] = mapped_column(Numeric(4, 1))
    notes: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[created_at]
    updated_at: Mapped[updated_at]

    __table_args__ = (
        CheckConstraint(
            "weight_kg BETWEEN 20 AND 400", name="body_measurements_weight_kg_check"
        ),
        CheckConstraint(
            "body_fat_pct BETWEEN 1 AND 70", name="body_measurements_body_fat_pct_check"
        ),
        UniqueConstraint(
            "user_id", "measured_on", name="body_measurements_user_id_measured_on_key"
        ),
        # "This user's history, most recent first" — the weight history screen's
        # one query. DESC matters so Postgres can read the index in order.
        Index("idx_body_measurements_user_date", "user_id", text("measured_on DESC")),
    )

    def __repr__(self) -> str:
        return f"<BodyMeasurement user_id={self.user_id} measured_on={self.measured_on}>"
