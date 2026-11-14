"""Remember set creation requests atomically with their workout mutations."""

import sqlalchemy as sa

from alembic import op

revision: str = "a31d92f0c683"
down_revision: str | None = "254456be6d79"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.create_table(
        "set_save_requests",
        sa.Column(
            "workout_id",
            sa.UUID(),
            sa.ForeignKey("workouts.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("request_id", sa.UUID(), primary_key=True),
        sa.Column("request_hash", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )


def downgrade() -> None:
    op.drop_table("set_save_requests")
