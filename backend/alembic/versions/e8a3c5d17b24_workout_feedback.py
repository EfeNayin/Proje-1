"""Coach feedback on completed workouts.

Revision ID: e8a3c5d17b24
Revises: d5e92b7f3a18

Additive only: a new table. No existing workout, link or offer is touched.
"""

import sqlalchemy as sa

from alembic import op

revision: str = "e8a3c5d17b24"
down_revision: str | None = "d5e92b7f3a18"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.create_table(
        "workout_feedback",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column(
            "link_id",
            sa.UUID(),
            sa.ForeignKey("coach_athlete_links.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "workout_id",
            sa.UUID(),
            sa.ForeignKey("workouts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("create_request_id", sa.UUID(), nullable=False),
        sa.Column("create_hash", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "char_length(body) <= 2000 AND body ~ '\\S'", name="workout_feedback_body_check"
        ),
        sa.CheckConstraint("version >= 1", name="workout_feedback_version_check"),
        sa.UniqueConstraint("link_id", "workout_id", name="workout_feedback_one_per_link_workout"),
        sa.UniqueConstraint("link_id", "create_request_id", name="workout_feedback_create_receipt"),
    )
    op.create_index(
        "idx_workout_feedback_workout", "workout_feedback", ["workout_id", "created_at"]
    )


def downgrade() -> None:
    op.drop_table("workout_feedback")
