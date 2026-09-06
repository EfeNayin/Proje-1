"""Daily readiness log model.

Maps to schema_v1.sql -> readiness_logs
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
    SmallInteger,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at, updated_at


class ReadinessLog(Base):
    """One day's recovery check-in for a user.

    Diagnostic companion to weekly volume: volume answers "did you train
    enough", this answers "could you recover". Keyed on (user_id, log_date)
    rather than workout_id because sleep and mood belong to the day, not to a
    session — logging twice on a two-a-day should update the same row, and a
    rest day's answer is still worth keeping.

    Every field but log_date is nullable: the check-in is entirely optional,
    and a mandatory field would be friction repeated before every workout.
    """

    __tablename__ = "readiness_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    user_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # The user's own local calendar day (users.timezone), never UTC and never
    # accepted from the client — computed server-side the same way weekly
    # volume cuts its week boundary.
    log_date: Mapped[date] = mapped_column(Date, nullable=False)

    sleep_hours: Mapped[Decimal | None] = mapped_column(Numeric(3, 1))
    sleep_quality: Mapped[int | None] = mapped_column(SmallInteger)
    energy: Mapped[int | None] = mapped_column(SmallInteger)
    mood: Mapped[int | None] = mapped_column(SmallInteger)

    # Muscle group name -> soreness (1-5), e.g. {"chest": 3, "quads": 5}.
    # Keys and value range are validated in the service layer against
    # muscle_groups.name; enforcing that in the database would need a
    # trigger, which is more machinery than this data warrants.
    soreness: Mapped[dict[str, int] | None] = mapped_column(JSONB)

    notes: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[created_at]
    updated_at: Mapped[updated_at]

    __table_args__ = (
        CheckConstraint(
            "sleep_hours >= 0 AND sleep_hours <= 24", name="readiness_logs_sleep_hours_check"
        ),
        CheckConstraint("sleep_quality BETWEEN 1 AND 5", name="readiness_logs_sleep_quality_check"),
        CheckConstraint("energy BETWEEN 1 AND 5", name="readiness_logs_energy_check"),
        CheckConstraint("mood BETWEEN 1 AND 5", name="readiness_logs_mood_check"),
        UniqueConstraint("user_id", "log_date", name="readiness_logs_user_id_log_date_key"),
        # "Son N günün kaydı, yeniden eskiye" — the diagnostic screen's one query.
        Index("idx_readiness_user_date", "user_id", text("log_date DESC")),
    )

    def __repr__(self) -> str:
        return f"<ReadinessLog user_id={self.user_id} log_date={self.log_date}>"
