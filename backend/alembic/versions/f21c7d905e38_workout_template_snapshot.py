"""Preserve the template used when a workout starts.

Revision ID: f21c7d905e38
Revises: d87b19c4a620
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "f21c7d905e38"
down_revision: str | None = "d87b19c4a620"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    # Existing workouts cannot reveal their original targets; never backfill
    # historical plans from today's mutable templates.
    op.add_column("workouts", sa.Column("template_snapshot", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("workouts", "template_snapshot")
