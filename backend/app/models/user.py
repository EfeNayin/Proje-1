"""User account and JWT refresh token models.

Maps to schema_v1.sql -> users, refresh_tokens
Personal fields (height_cm, date_of_birth, gender, goal_weight_kg) added by
body_measurements_schema.sql via a later migration. Nutrition goal fields
(activity_level, nutrition_goal, calorie_goal, protein/carb/fat_goal_g) added
by nutrition_goals_schema.sql via a later migration still.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, created_at, updated_at

if TYPE_CHECKING:
    # Imported only for type checking to avoid a circular import at runtime
    # (user -> workout -> user).
    from app.models.workout import Workout


class User(Base):
    """A registered account.

    Exposed through the API (appears in URLs), so the primary key is a UUID
    rather than a guessable sequential id.
    """

    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )

    # CITEXT = case-insensitive text. "Efe@x.com" and "efe@x.com" are treated
    # as the same value, so no manual lower() is needed on lookups.
    email: Mapped[str] = mapped_column(CITEXT, nullable=False, unique=True)
    username: Mapped[str] = mapped_column(CITEXT, nullable=False, unique=True)

    # bcrypt hash. The plaintext password is never stored.
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)

    first_name: Mapped[str | None] = mapped_column(Text)
    last_name: Mapped[str | None] = mapped_column(Text)
    bio: Mapped[str | None] = mapped_column(Text)

    # Privacy defaults to private: social features are opt-in.
    is_private: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )

    weight_unit: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'kg'")
    )

    # IANA timezone name, e.g. "Europe/Istanbul".
    # Required by the weekly volume analytics: performed_at is stored in UTC,
    # so a workout at 01:00 Monday in Istanbul is 22:00 Sunday UTC and would
    # fall into the previous week if the week boundary were computed in UTC.
    # Cannot be reconstructed after the fact, so it is captured at signup.
    timezone: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'Europe/Istanbul'")
    )

    # BCP 47 language tag, e.g. "tr" or "en". Allowed values are constrained
    # in the application layer, not the database, so that adding a language
    # does not require a migration.
    locale: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'tr'")
    )

    # Personal details. All nullable: a user who never opens Personal Details
    # still has a working account. height_cm and date_of_birth are also the
    # calorie/macro feature's prerequisite (a later, separate task).
    height_cm: Mapped[Decimal | None] = mapped_column(Numeric(5, 1))
    date_of_birth: Mapped[date | None] = mapped_column(Date)
    gender: Mapped[str | None] = mapped_column(Text)
    goal_weight_kg: Mapped[Decimal | None] = mapped_column(Numeric(5, 1))

    # Nutrition goals (calorie/macro targets). All nullable: a user who never
    # opens the Nutrition Goals screen still has a working account. Stored
    # rather than always-derived because the formula only produces a
    # SUGGESTION — the user can overwrite it, and that override must survive
    # until they explicitly regenerate it. activity_level and nutrition_goal
    # double as both a profile preference (also settable via PATCH /users/me)
    # and required inputs to the calorie formula.
    activity_level: Mapped[str | None] = mapped_column(Text)
    nutrition_goal: Mapped[str | None] = mapped_column(Text)
    calorie_goal: Mapped[int | None] = mapped_column(Integer)
    protein_goal_g: Mapped[int | None] = mapped_column(SmallInteger)
    carb_goal_g: Mapped[int | None] = mapped_column(SmallInteger)
    fat_goal_g: Mapped[int | None] = mapped_column(SmallInteger)

    created_at: Mapped[created_at]
    updated_at: Mapped[updated_at]

    # ── Relationships ────────────────────────────────────────────────────
    workouts: Mapped[list["Workout"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,  # let the DB's ON DELETE CASCADE do the work
    )
    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    __table_args__ = (
        CheckConstraint("weight_unit IN ('kg', 'lb')", name="users_weight_unit_check"),
        CheckConstraint("height_cm BETWEEN 50 AND 300", name="users_height_cm_check"),
        CheckConstraint(
            "gender IN ('male', 'female', 'other', 'prefer_not_to_say')",
            name="users_gender_check",
        ),
        CheckConstraint(
            "goal_weight_kg BETWEEN 20 AND 400", name="users_goal_weight_kg_check"
        ),
        CheckConstraint(
            "activity_level IN ('sedentary','light','moderate','active','very_active')",
            name="users_activity_level_check",
        ),
        CheckConstraint(
            "nutrition_goal IN ('cut','maintain','bulk')", name="users_nutrition_goal_check"
        ),
        CheckConstraint("calorie_goal BETWEEN 800 AND 8000", name="users_calorie_goal_check"),
        CheckConstraint(
            "protein_goal_g BETWEEN 0 AND 500", name="users_protein_goal_g_check"
        ),
        CheckConstraint("carb_goal_g BETWEEN 0 AND 1000", name="users_carb_goal_g_check"),
        CheckConstraint("fat_goal_g BETWEEN 0 AND 400", name="users_fat_goal_g_check"),
    )

    def __repr__(self) -> str:
        return f"<User {self.username}>"


class RefreshToken(Base):
    """A long-lived token used to obtain new access tokens.

    Internal-only (never appears in a URL) and high-volume, so BIGSERIAL is
    a better fit than UUID here.

    Only the SHA-256 hash of the token is stored. If the database leaks, the
    tokens themselves are still unusable. `revoked_at` enables logout and
    "sign out of all devices".
    """

    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    user_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    token_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)

    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # NULL means the token is still valid.
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[created_at]

    user: Mapped["User"] = relationship(back_populates="refresh_tokens")

    # Indexes are declared explicitly with the same names used in
    # schema_v1.sql. Using index=True on the column instead would make
    # SQLAlchemy invent its own name (ix_refresh_tokens_user_id) and Alembic
    # would then try to drop the real index and create a duplicate.
    __table_args__ = (Index("idx_refresh_tokens_user_id", "user_id"),)

    def __repr__(self) -> str:
        state = "revoked" if self.revoked_at else "active"
        return f"<RefreshToken id={self.id} {state}>"