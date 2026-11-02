"""Athlete-specific program preparation: lineages and versioned offers.

Revision ID: a9c4e1f72b35
Revises: f7b2d4e91a36

Additive and data-preserving. A new table (program_lineages) and four new
NULLABLE columns on program_offers (lineage_id, version, superseded_at,
activated_on_accept). Every existing offer keeps NULL in all of them and so
stays a legacy standalone offer with exactly its old behaviour. The only
existing object that changes is the status CHECK, which is widened to allow
'superseded'; every stored value still satisfies it. No row is rewritten.
"""

import sqlalchemy as sa

from alembic import op

revision: str = "a9c4e1f72b35"
down_revision: str | None = "f7b2d4e91a36"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.create_table(
        "program_lineages",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("link_id", sa.UUID(),
                  sa.ForeignKey("coach_athlete_links.id", ondelete="CASCADE"), nullable=False),
        sa.Column("coach_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("draft_program_id", sa.UUID(),
                  sa.ForeignKey("programs.id", ondelete="SET NULL"), nullable=True, unique=True),
        sa.Column("create_request_id", sa.UUID(), nullable=False),
        sa.Column("create_hash", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.UniqueConstraint("coach_id", "create_request_id",
                            name="program_lineages_create_receipt"),
    )
    op.create_index(
        "idx_program_lineages_link", "program_lineages", ["link_id", sa.text("created_at DESC")]
    )

    op.add_column("program_offers", sa.Column("activated_on_accept", sa.Boolean(), nullable=True))
    op.add_column("program_offers", sa.Column(
        "lineage_id", sa.UUID(), sa.ForeignKey("program_lineages.id", ondelete="CASCADE"),
        nullable=True))
    op.add_column("program_offers", sa.Column("version", sa.Integer(), nullable=True))
    op.add_column("program_offers",
                  sa.Column("superseded_at", sa.DateTime(timezone=True), nullable=True))

    op.drop_constraint("program_offers_status_check", "program_offers", type_="check")
    op.create_check_constraint(
        "program_offers_status_check", "program_offers",
        "status IN ('pending', 'accepted', 'declined', 'superseded')")
    op.create_check_constraint(
        "program_offers_lineage_version_check", "program_offers",
        "(lineage_id IS NULL) = (version IS NULL) AND (version IS NULL OR version >= 1)")
    op.create_check_constraint(
        "program_offers_superseded_check", "program_offers",
        "(status = 'superseded') = (superseded_at IS NOT NULL) "
        "AND (status <> 'superseded' OR lineage_id IS NOT NULL)")
    op.create_check_constraint(
        "program_offers_activated_check", "program_offers",
        "activated_on_accept IS NULL OR status = 'accepted'")
    op.create_unique_constraint(
        "program_offers_lineage_version", "program_offers", ["lineage_id", "version"])
    op.create_index(
        "idx_program_offers_lineage_one_pending", "program_offers", ["lineage_id"],
        unique=True, postgresql_where=sa.text("status = 'pending' AND lineage_id IS NOT NULL"))


def downgrade() -> None:
    # Superseded and versioned offers have no representation in the old schema:
    # versioned ones are removed with their lineage, which is why this is only
    # meant for a development database.
    op.drop_index("idx_program_offers_lineage_one_pending", table_name="program_offers")
    op.execute("DELETE FROM program_offers WHERE lineage_id IS NOT NULL")
    op.drop_constraint("program_offers_lineage_version", "program_offers", type_="unique")
    op.drop_constraint("program_offers_activated_check", "program_offers", type_="check")
    op.drop_constraint("program_offers_superseded_check", "program_offers", type_="check")
    op.drop_constraint("program_offers_lineage_version_check", "program_offers", type_="check")
    op.drop_constraint("program_offers_status_check", "program_offers", type_="check")
    op.create_check_constraint(
        "program_offers_status_check", "program_offers",
        "status IN ('pending', 'accepted', 'declined')")
    op.drop_column("program_offers", "superseded_at")
    op.drop_column("program_offers", "version")
    op.drop_column("program_offers", "lineage_id")
    op.drop_column("program_offers", "activated_on_accept")
    op.drop_index("idx_program_lineages_link", table_name="program_lineages")
    op.drop_table("program_lineages")
