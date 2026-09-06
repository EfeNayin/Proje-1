"""Program, template and template-exercise models.

Maps to schema_v1.sql -> programs, workout_templates, template_exercises
"""

from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Numeric,
    SmallInteger,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, created_at, updated_at

if TYPE_CHECKING:
    from app.models.exercise import Exercise
    from app.models.workout import Workout


class Program(Base):
    """A user's named collection of training-day templates.

    Grouped rather than a flat template list because deload, switching
    programs, and reverting to an old one are all decisions made at the
    program level, not the template level. Old programs are archived
    (is_active=False), never deleted, so reverting has something to revert
    to.
    """

    __tablename__ = "programs"

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

    name: Mapped[str] = mapped_column(Text, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)

    # Exactly one active program per user. Enforced by idx_programs_one_active
    # (a partial unique index) at the database level, not by this flag alone.
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))

    created_at: Mapped[created_at]
    updated_at: Mapped[updated_at]

    templates: Mapped[list["WorkoutTemplate"]] = relationship(
        back_populates="program",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="WorkoutTemplate.day_order",
    )

    __table_args__ = (
        Index(
            "idx_programs_one_active",
            "user_id",
            unique=True,
            postgresql_where=text("is_active"),
        ),
        Index("idx_programs_user", "user_id", text("created_at DESC")),
    )

    def __repr__(self) -> str:
        return f"<Program {self.name!r} active={self.is_active}>"


class WorkoutTemplate(Base):
    """One training day within a program, e.g. "Push A".

    day_order is a position within the program, not a calendar day: users
    train on their own schedule (three days one week, five the next), so
    which template is "today" is always the user's own choice, never
    derived from a fixed weekday.
    """

    __tablename__ = "workout_templates"

    id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    program_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("programs.id", ondelete="CASCADE"),
        nullable=False,
    )

    name: Mapped[str] = mapped_column(Text, nullable=False)
    day_order: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default=text("0"))
    notes: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[created_at]
    updated_at: Mapped[updated_at]

    program: Mapped["Program"] = relationship(back_populates="templates")
    exercises: Mapped[list["TemplateExercise"]] = relationship(
        back_populates="template",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="TemplateExercise.exercise_order",
    )
    # Workouts logged from this template. ON DELETE SET NULL happens at the
    # database level (see Workout.template_id), so deleting a template never
    # deletes the training history logged against it.
    workouts: Mapped[list["Workout"]] = relationship(
        back_populates="template", passive_deletes=True
    )

    __table_args__ = (Index("idx_templates_program", "program_id", "day_order"),)

    def __repr__(self) -> str:
        return f"<WorkoutTemplate {self.name!r} day_order={self.day_order}>"


class TemplateExercise(Base):
    """One exercise's targets within a template: "Bench Press, 4x6-8 @RIR2".

    A target, not a measurement — the user sees this in the gym and logs
    what actually happened into `sets`. Reps are a range because hypertrophy
    programming rarely calls for a single fixed number; min=max is how a
    fixed count is expressed.
    """

    __tablename__ = "template_exercises"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    template_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("workout_templates.id", ondelete="CASCADE"),
        nullable=False,
    )
    # RESTRICT, matching sets.exercise_id: an exercise already referenced by a
    # template must not be deletable out from under it.
    exercise_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("exercises.id", ondelete="RESTRICT"),
        nullable=False,
    )
    exercise_order: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, server_default=text("0")
    )

    target_sets: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    target_reps_min: Mapped[int | None] = mapped_column(SmallInteger)
    target_reps_max: Mapped[int | None] = mapped_column(SmallInteger)
    target_rir: Mapped[int | None] = mapped_column(SmallInteger)
    target_rpe: Mapped[Decimal | None] = mapped_column(Numeric(3, 1))

    notes: Mapped[str | None] = mapped_column(Text)

    template: Mapped["WorkoutTemplate"] = relationship(back_populates="exercises")
    exercise: Mapped["Exercise"] = relationship()

    __table_args__ = (
        CheckConstraint("target_sets > 0", name="template_exercises_target_sets_check"),
        CheckConstraint("target_reps_min > 0", name="template_exercises_target_reps_min_check"),
        CheckConstraint("target_reps_max > 0", name="template_exercises_target_reps_max_check"),
        CheckConstraint("target_rir BETWEEN 0 AND 10", name="template_exercises_target_rir_check"),
        CheckConstraint("target_rpe BETWEEN 1 AND 10", name="template_exercises_target_rpe_check"),
        CheckConstraint(
            "target_reps_min IS NULL OR target_reps_max IS NULL "
            "OR target_reps_min <= target_reps_max",
            name="template_exercises_reps_range",
        ),
        Index("idx_template_exercises", "template_id", "exercise_order"),
    )

    def __repr__(self) -> str:
        return (
            f"<TemplateExercise exercise_id={self.exercise_id} "
            f"{self.target_sets}x{self.target_reps_min}-{self.target_reps_max}>"
        )
