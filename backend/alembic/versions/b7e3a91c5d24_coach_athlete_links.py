"""Coach mode flag, coach invites and coach-athlete links.

Revision ID: b7e3a91c5d24
Revises: a31d92f0c683

Additive only: existing users get coach_enabled = false and keep everything
they had.
"""

import sqlalchemy as sa

from alembic import op

revision: str = "b7e3a91c5d24"
down_revision: str | None = "a31d92f0c683"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("coach_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )

    op.create_table(
        "coach_invites",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("coach_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("code_hash", sa.Text(), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("accepted_by_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )
    op.create_index("idx_coach_invites_coach_id", "coach_invites", ["coach_id"])

    op.create_table(
        "coach_athlete_links",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("coach_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("athlete_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("invite_id", sa.UUID(), sa.ForeignKey("coach_invites.id"), nullable=False,
                  unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_by_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="SET NULL"),
                  nullable=True),
        sa.CheckConstraint("coach_id <> athlete_id", name="coach_athlete_links_not_self_check"),
    )
    op.create_index(
        "idx_coach_athlete_links_one_active",
        "coach_athlete_links",
        ["coach_id", "athlete_id"],
        unique=True,
        postgresql_where=sa.text("ended_at IS NULL"),
    )
    op.create_index("idx_coach_athlete_links_athlete_id", "coach_athlete_links", ["athlete_id"])


def downgrade() -> None:
    op.drop_table("coach_athlete_links")
    op.drop_table("coach_invites")
    op.drop_column("users", "coach_enabled")
