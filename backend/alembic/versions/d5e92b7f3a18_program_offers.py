"""Coach-to-athlete program offers.

Revision ID: d5e92b7f3a18
Revises: c4d81f6a2b90

Additive only: a new table. No existing row, program or link is touched.
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "d5e92b7f3a18"
down_revision: str | None = "c4d81f6a2b90"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.create_table(
        "program_offers",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("link_id", sa.UUID(),
                  sa.ForeignKey("coach_athlete_links.id", ondelete="CASCADE"), nullable=False),
        sa.Column("coach_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("request_id", sa.UUID(), nullable=False),
        sa.Column("request_hash", sa.Text(), nullable=False),
        sa.Column("source_program_id", sa.UUID(),
                  sa.ForeignKey("programs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("program_name", sa.Text(), nullable=False),
        sa.Column("snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("accepted_program_id", sa.UUID(),
                  sa.ForeignKey("programs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('pending', 'accepted', 'declined')",
                           name="program_offers_status_check"),
        sa.CheckConstraint("accepted_program_id IS NULL OR status = 'accepted'",
                           name="program_offers_accepted_program_check"),
        sa.UniqueConstraint("coach_id", "request_id", name="program_offers_send_receipt"),
    )
    op.create_index(
        "idx_program_offers_one_pending",
        "program_offers",
        ["link_id", "source_program_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_index(
        "idx_program_offers_link", "program_offers", ["link_id", sa.text("created_at DESC")]
    )


def downgrade() -> None:
    op.drop_table("program_offers")
