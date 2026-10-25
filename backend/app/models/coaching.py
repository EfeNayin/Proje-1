"""Coach invites and coach-athlete links.

A link is the only thing that will ever authorise one account to see another's
data, and it is created only after the athlete explicitly accepts an invite.
Nothing in this phase exposes training, weight or nutrition data through it.
"""

from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at


class CoachInvite(Base):
    """A single-use, expiring invite created by a coach.

    Only the SHA-256 hash of the code is stored: the code itself is shown to
    the coach once, at creation, and cannot be read back from the database.
    """

    __tablename__ = "coach_invites"

    id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )
    coach_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    code_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # Set exactly once, by a conditional UPDATE (`WHERE accepted_at IS NULL`),
    # which is what makes the code single-use under concurrent accepts.
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    accepted_by_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    created_at: Mapped[created_at]

    __table_args__ = (Index("idx_coach_invites_coach_id", "coach_id"),)


class CoachAthleteLink(Base):
    """An accepted coach-athlete connection.

    Ending a link sets `ended_at`; the row stays, so history is not lost and
    the invite it came from can never be replayed to reconnect (invite_id is
    unique and the invite is already accepted).
    """

    __tablename__ = "coach_athlete_links"

    id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )
    coach_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    athlete_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    invite_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("coach_invites.id"), nullable=False, unique=True
    )
    created_at: Mapped[created_at]
    # The athlete's per-link consent to let this coach read their completed
    # workout history. Off for every new link and for links that predate the
    # flag; only the athlete can change it, and it ends with the link.
    shares_workouts: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_by_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    __table_args__ = (
        CheckConstraint("coach_id <> athlete_id", name="coach_athlete_links_not_self_check"),
        # At most one ACTIVE link per pair; ended ones may repeat.
        Index(
            "idx_coach_athlete_links_one_active",
            "coach_id",
            "athlete_id",
            unique=True,
            postgresql_where=text("ended_at IS NULL"),
        ),
        Index("idx_coach_athlete_links_athlete_id", "athlete_id"),
    )


class ProgramOffer(Base):
    """A coach's program, frozen at the moment it was sent, waiting for the athlete.

    The offer belongs to ONE connection (link_id). Ending that connection makes
    it unavailable for good, and a later reconnection is a new link, so old
    offers are never revived. `snapshot` is a deep copy of the program as the
    coach had it; editing or deleting the source afterwards changes nothing the
    athlete sees. Accepting copies the snapshot into programs the athlete owns
    (accepted_program_id points at that copy); the offer never grants the coach
    access to it.

    (coach_id, request_id) is the send receipt: repeating the same send returns
    this row instead of creating a second one.
    """

    __tablename__ = "program_offers"

    id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )
    link_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("coach_athlete_links.id", ondelete="CASCADE"),
        nullable=False,
    )
    coach_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    request_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    request_hash: Mapped[str] = mapped_column(Text, nullable=False)
    # Informational only; the coach deleting the source must not touch the offer.
    source_program_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("programs.id", ondelete="SET NULL")
    )
    program_name: Mapped[str] = mapped_column(Text, nullable=False)
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'pending'"))
    # Set when accepted; goes NULL (offer stays "accepted") if the athlete later
    # deletes their copy, so a retry can never create a second one.
    accepted_program_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("programs.id", ondelete="SET NULL")
    )
    created_at: Mapped[created_at]
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'accepted', 'declined')", name="program_offers_status_check"
        ),
        CheckConstraint(
            "accepted_program_id IS NULL OR status = 'accepted'",
            name="program_offers_accepted_program_check",
        ),
        UniqueConstraint("coach_id", "request_id", name="program_offers_send_receipt"),
        # One waiting offer per program per connection: a second device or a
        # double tap with a fresh request id cannot queue a duplicate.
        Index(
            "idx_program_offers_one_pending",
            "link_id",
            "source_program_id",
            unique=True,
            postgresql_where=text("status = 'pending'"),
        ),
        Index("idx_program_offers_link", "link_id", text("created_at DESC")),
    )
