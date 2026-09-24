"""Workout session and individual set models.

Maps to schema_v1.sql -> workouts, sets
"""

from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, created_at, updated_at

if TYPE_CHECKING:
    from app.models.exercise import Exercise
    from app.models.program import WorkoutTemplate
    from app.models.user import User


class SetSaveRequest(Base):
    """Receipts survive set deletion; retries must never resurrect deleted sets."""

    __tablename__ = "set_save_requests"

    workout_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("workouts.id", ondelete="CASCADE"), primary_key=True
    )
    request_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    request_hash: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[created_at]


class Workout(Base):
    """One training session.

    total_volume_kg and total_sets are denormalised: they are recomputed in
    the application layer whenever sets are added or removed, so feed and
    profile screens can read them without aggregating every child row.
    """

    __tablename__ = "workouts"

    id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    user_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    title: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)

    # When the session actually happened, which may differ from created_at
    # if the user logs it retroactively.
    performed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    # Sum of weight_kg * reps across non-warmup sets. Denormalised.
    total_volume_kg: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, server_default=text("0")
    )
    # Number of working (non-warmup) sets. Denormalised.
    total_sets: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))

    is_private: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))

    # Which template this session was started from, if any. Nullable: free
    # logging without a program is still fully supported and unaffected.
    # ON DELETE SET NULL — deleting a template must never delete the
    # workouts logged against it.
    template_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("workout_templates.id", ondelete="SET NULL"),
    )

    # Immutable plan at session start; survives template edits and deletion.
    # NULL means no snapshot was captured, not an empty planned exercise list.
    template_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSONB(none_as_null=True))

    # When the session was finished. NULL = still in progress. Device-only
    # "finished" state used to mean a lost device made every workout look
    # unfinished forever; this also makes real session duration computable
    # (finished_at - performed_at).
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # NULL: unknown for older records (or not finished). False: explicit
    # finish action. True: closed when the next workout was started.
    finished_automatically: Mapped[bool | None] = mapped_column(Boolean)

    created_at: Mapped[created_at]
    updated_at: Mapped[updated_at]

    user: Mapped["User"] = relationship(back_populates="workouts")
    template: Mapped["WorkoutTemplate | None"] = relationship(back_populates="workouts")
    sets: Mapped[list["Set"]] = relationship(
        back_populates="workout",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="Set.set_number",
    )

    # Composite index for the most common query: "this user's workouts,
    # newest first". DESC matters — it lets Postgres read the index in
    # order instead of sorting. Name matches schema_v1.sql.
    __table_args__ = (
        Index("idx_workouts_user_performed", "user_id", text("performed_at DESC")),
        Index(
            "idx_workouts_template", "template_id", postgresql_where=text("template_id IS NOT NULL")
        ),
        Index("idx_workouts_unfinished", "user_id", postgresql_where=text("finished_at IS NULL")),
    )

    def __repr__(self) -> str:
        return f"<Workout {self.id} performed_at={self.performed_at:%Y-%m-%d}>"


class Set(Base):
    """A single set performed within a workout.

    The highest-volume table in the schema (tens of thousands of rows per
    active user), and never exposed in a URL, so BIGSERIAL keeps indexes
    small and inserts fast.

    RIR and RPE are two different effort scales; both are optional and the
    user typically fills in only one.
    """

    __tablename__ = "sets"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    workout_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("workouts.id", ondelete="CASCADE"),
        nullable=False,
    )
    # RESTRICT, not CASCADE: an exercise that is already referenced by logged
    # sets must not be deletable, otherwise training history would vanish.
    exercise_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("exercises.id", ondelete="RESTRICT"),
        nullable=False,
    )

    # Order of this set within its exercise (1, 2, 3, ...).
    set_number: Mapped[int] = mapped_column(SmallInteger, nullable=False)

    weight_kg: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    reps: Mapped[int] = mapped_column(SmallInteger, nullable=False)

    # Reps In Reserve: how many more reps could have been done.
    rir: Mapped[int | None] = mapped_column(SmallInteger)
    # Rate of Perceived Exertion, 1-10.
    rpe: Mapped[Decimal | None] = mapped_column(Numeric(3, 1))

    # Warmup sets are excluded from volume analytics.
    is_warmup: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))

    created_at: Mapped[created_at]

    workout: Mapped["Workout"] = relationship(back_populates="sets")
    exercise: Mapped["Exercise"] = relationship()

    __table_args__ = (
        CheckConstraint("weight_kg >= 0", name="sets_weight_kg_check"),
        CheckConstraint("reps >= 0", name="sets_reps_check"),
        CheckConstraint("rir BETWEEN 0 AND 10", name="sets_rir_check"),
        CheckConstraint("rpe BETWEEN 1 AND 10", name="sets_rpe_check"),
        # Fetching every set of a workout (workout detail screen).
        Index("idx_sets_workout", "workout_id"),
        # Volume analytics: time series per exercise / muscle.
        Index("idx_sets_exercise", "exercise_id"),
    )

    def __repr__(self) -> str:
        return f"<Set #{self.set_number} {self.weight_kg}kg x {self.reps}>"
