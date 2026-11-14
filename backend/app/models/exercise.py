"""Exercise catalogue and muscle group models.

Maps to schema_v1.sql -> muscle_groups, exercises, exercise_muscle_groups
"""

from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    SmallInteger,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, created_at

if TYPE_CHECKING:
    from app.models.user import User


class MuscleGroup(Base):
    """A muscle group plus its weekly volume landmarks.

    A small, fixed reference table (17 rows), so SMALLSERIAL is plenty.

    MEV / MAV / MRV are weekly SET count thresholds (Renaissance
    Periodization):
      MEV - Minimum Effective Volume:   lower bound for growth
      MAV - Maximum Adaptive Volume:    most productive range
      MRV - Maximum Recoverable Volume: above this, recovery fails
    The analytics layer compares a user's weekly volume against these to
    report "below / within / above" per muscle.
    """

    __tablename__ = "muscle_groups"

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, autoincrement=True)

    # Stable code used in application logic, e.g. 'chest'.
    name: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    # Turkish label shown in the UI, e.g. 'Göğüs' (Turkey-first product).
    name_tr: Mapped[str] = mapped_column(Text, nullable=False)

    # Groups muscles in the UI: 'upper' / 'lower' / 'core'.
    region: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'upper'")
    )

    # NULL means no published landmark for this muscle.
    mev: Mapped[int | None] = mapped_column(SmallInteger)
    mav: Mapped[int | None] = mapped_column(SmallInteger)
    mrv: Mapped[int | None] = mapped_column(SmallInteger)

    created_at: Mapped[created_at]

    exercise_links: Mapped[list["ExerciseMuscleGroup"]] = relationship(
        back_populates="muscle_group"
    )

    __table_args__ = (
        CheckConstraint(
            "region IN ('upper', 'lower', 'core')", name="muscle_groups_region_check"
        ),
        Index(
            "idx_muscle_groups_name_tr",
            func.lower(func.immutable_unaccent(name_tr)),
            postgresql_using="gin",
            postgresql_ops={"lower_1": "gin_trgm_ops"},
        ),
    )

    def __repr__(self) -> str:
        return f"<MuscleGroup {self.name}>"


class Exercise(Base):
    """A movement in the catalogue.

    created_by IS NULL  -> official, system-seeded exercise
    created_by IS NOT NULL -> custom exercise added by that user (later phase)
    """

    __tablename__ = "exercises"

    id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    name: Mapped[str] = mapped_column(Text, nullable=False)
    name_tr: Mapped[str | None] = mapped_column(Text)

    # 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight'
    equipment: Mapped[str | None] = mapped_column(Text)

    # True for multi-joint movements (bench press), False for single-joint
    # isolation work (curl).
    is_compound: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )

    created_by: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
    )

    created_at: Mapped[created_at]

    muscle_links: Mapped[list["ExerciseMuscleGroup"]] = relationship(
        back_populates="exercise",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    creator: Mapped["User | None"] = relationship()

    # Search indexes. Two things combine here: immutable_unaccent + lower so
    # that "gogus" finds "Göğüs", and a GIN trigram index so that the
    # "%term%" match the API performs can actually use an index — a btree
    # cannot serve a leading wildcard.
    # The expression must stay identical to _normalise() in
    # exercises/service.py, otherwise the planner silently falls back to a
    # sequential scan.
    __table_args__ = (
        Index(
            "idx_exercises_name",
            func.lower(func.immutable_unaccent(name)),
            postgresql_using="gin",
            postgresql_ops={"lower_1": "gin_trgm_ops"},
        ),
        Index(
            "idx_exercises_name_tr",
            func.lower(func.immutable_unaccent(name_tr)),
            postgresql_using="gin",
            postgresql_ops={"lower_1": "gin_trgm_ops"},
        ),
    )

    def __repr__(self) -> str:
        return f"<Exercise {self.name}>"


class ExerciseMuscleGroup(Base):
    """How much a given exercise loads a given muscle. The heart of analytics.

    Primary links count each working set once toward direct weekly volume.
    Secondary links describe involvement but do not add direct sets.
    Effectiveness is a 1-5 catalogue rating, not a fractional set multiplier.
    """

    __tablename__ = "exercise_muscle_groups"

    exercise_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("exercises.id", ondelete="CASCADE"),
        primary_key=True,
    )
    muscle_group_id: Mapped[int] = mapped_column(
        SmallInteger,
        ForeignKey("muscle_groups.id", ondelete="RESTRICT"),
        primary_key=True,
    )

    # 'primary' -> trained directly; counts toward weekly volume
    # 'secondary' -> involved, but not the target; excluded from the count
    role: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'primary'")
    )

    effectiveness: Mapped[int] = mapped_column(SmallInteger, nullable=False)

    exercise: Mapped["Exercise"] = relationship(back_populates="muscle_links")
    muscle_group: Mapped["MuscleGroup"] = relationship(back_populates="exercise_links")

    __table_args__ = (
        CheckConstraint(
            "role IN ('primary', 'secondary')", name="exercise_muscle_groups_role_check"
        ),
        CheckConstraint(
            "effectiveness BETWEEN 1 AND 5",
            name="exercise_muscle_groups_effectiveness_check",
        ),
        # Supports the reverse lookup: "which exercises train this muscle?"
        Index("idx_emg_muscle_group", "muscle_group_id"),
    )

    def __repr__(self) -> str:
        return f"<ExerciseMuscleGroup ex={self.exercise_id} mg={self.muscle_group_id}>"