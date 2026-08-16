"""User account and JWT refresh token models.

Maps to schema_v1.sql -> users, refresh_tokens
"""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
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

    display_name: Mapped[str | None] = mapped_column(Text)
    bio: Mapped[str | None] = mapped_column(Text)

    # Privacy defaults to private: social features are opt-in.
    is_private: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )

    weight_unit: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'kg'")
    )

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