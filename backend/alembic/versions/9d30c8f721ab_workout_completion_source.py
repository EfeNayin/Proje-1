"""Record whether workout closure was automatic, preserving unknown legacy data.

Revision ID: 9d30c8f721ab
Revises: 82c7336cad06
"""

import sqlalchemy as sa

from alembic import op

revision: str = "9d30c8f721ab"
down_revision: str | None = "82c7336cad06"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    # No backfill: old finished_at values cannot reveal how a session closed.
    op.add_column("workouts", sa.Column("finished_automatically", sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column("workouts", "finished_automatically")
