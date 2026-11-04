"""Password recovery challenge.

Maps to the password_reset_challenges table (migration d3f8a6b1c294).
"""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, SmallInteger, Text, text
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at


class PasswordResetChallenge(Base):
    """The one outstanding recovery code of an account.

    One row per account (`user_id` is unique): asking for a new code replaces the row,
    which is what invalidates the previous code, and a completed reset deletes it, which
    is what makes a code single-use. Only a keyed hash of the code is stored
    (app/domains/auth/recovery.py); the code itself exists only in the email.
    """

    __tablename__ = "password_reset_challenges"

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
        unique=True,
    )
    code_hash: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # Guesses spent on this code. Spent before the code is compared, so parallel
    # guesses cannot overshoot the limit.
    attempts: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default=text("0"))
    created_at: Mapped[created_at]

    __table_args__ = (CheckConstraint("attempts >= 0", name="password_reset_attempts_check"),)
