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
    Integer,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at, updated_at


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


class ProgramLineage(Base):
    """A program a coach prepares for ONE connection and publishes in numbered versions.

    The coach edits `draft_program_id`, an ordinary program they own (inactive,
    hidden from their own program list while the connection lasts). Publishing
    freezes it into a ProgramOffer with the next version number; later edits of
    the draft change nothing already published. A lineage belongs to one link,
    so a reconnection starts with none.

    (coach_id, create_request_id) is the create receipt and `create_hash` ties it
    to what it created, so a repeat returns this row and a reused id with other
    details is refused.
    """

    __tablename__ = "program_lineages"

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
    # NULL only after the coach deleted the draft once the connection had ended
    # (it cannot be deleted while the connection lasts); the lineage and its
    # published versions stay as history.
    draft_program_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("programs.id", ondelete="SET NULL"), unique=True
    )
    create_request_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    create_hash: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[created_at]

    __table_args__ = (
        UniqueConstraint("coach_id", "create_request_id", name="program_lineages_create_receipt"),
        Index("idx_program_lineages_link", "link_id", text("created_at DESC")),
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

    An offer is either a LEGACY standalone one (lineage_id and version are NULL;
    behaves exactly as before) or one published version of a ProgramLineage
    (both set). A lineage has at most one pending version; publishing a newer one
    marks the waiting one `superseded`, which can never be accepted.
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
    # Whether accepting this version made the new copy the athlete's active
    # program. Stored so a repeated accept reports what really happened then.
    activated_on_accept: Mapped[bool | None] = mapped_column(Boolean)
    # The coach's program lineage this offer is a published version of, and its
    # number within it (1, 2, ...). NULL for a legacy standalone offer.
    lineage_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("program_lineages.id", ondelete="CASCADE")
    )
    version: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[created_at]
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    superseded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'accepted', 'declined', 'superseded')",
            name="program_offers_status_check",
        ),
        CheckConstraint(
            "accepted_program_id IS NULL OR status = 'accepted'",
            name="program_offers_accepted_program_check",
        ),
        CheckConstraint(
            "(lineage_id IS NULL) = (version IS NULL) AND (version IS NULL OR version >= 1)",
            name="program_offers_lineage_version_check",
        ),
        # Only a versioned offer can be replaced, and exactly then superseded_at is set.
        CheckConstraint(
            "(status = 'superseded') = (superseded_at IS NOT NULL) "
            "AND (status <> 'superseded' OR lineage_id IS NOT NULL)",
            name="program_offers_superseded_check",
        ),
        CheckConstraint(
            "activated_on_accept IS NULL OR status = 'accepted'",
            name="program_offers_activated_check",
        ),
        UniqueConstraint("lineage_id", "version", name="program_offers_lineage_version"),
        # One actionable version per lineage: a second device or a double tap
        # cannot leave two versions waiting.
        Index(
            "idx_program_offers_lineage_one_pending",
            "lineage_id",
            unique=True,
            postgresql_where=text("status = 'pending' AND lineage_id IS NOT NULL"),
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


class WorkoutFeedback(Base):
    """A coach's feedback on one completed workout, written for the athlete to read.

    It belongs to ONE connection (link_id) and one workout, at most one per pair.
    Only that connection's coach may read or change it, and only while the link
    is active and the athlete shares workouts. A reconnection is a new link, so
    it never reaches this row. The athlete reads it as long as the workout
    exists, whatever happens to the link afterwards; deleting the workout
    deletes it.

    `version` is the concurrency token: an edit or delete must name the version
    it saw. (link_id, create_request_id) is the create receipt, and
    `create_hash` ties that receipt to the text it created, so a repeat of the
    same create returns this row and a reused id with other text is refused.
    """

    __tablename__ = "workout_feedback"

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
    workout_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("workouts.id", ondelete="CASCADE"), nullable=False
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    create_request_id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    create_hash: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[created_at]
    updated_at: Mapped[updated_at]

    __table_args__ = (
        CheckConstraint(
            "char_length(body) <= 2000 AND body ~ '\\S'", name="workout_feedback_body_check"
        ),
        CheckConstraint("version >= 1", name="workout_feedback_version_check"),
        UniqueConstraint("link_id", "workout_id", name="workout_feedback_one_per_link_workout"),
        UniqueConstraint("link_id", "create_request_id", name="workout_feedback_create_receipt"),
        Index("idx_workout_feedback_workout", "workout_id", "created_at"),
    )
