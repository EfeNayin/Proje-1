"""Per-link consent to share completed workouts with a coach.

Revision ID: c4d81f6a2b90
Revises: b7e3a91c5d24

Additive only. Every existing link gets shares_workouts = false, so nobody's
training becomes visible to a coach without the athlete turning it on.
"""

import sqlalchemy as sa

from alembic import op

revision: str = "c4d81f6a2b90"
down_revision: str | None = "b7e3a91c5d24"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.add_column(
        "coach_athlete_links",
        sa.Column("shares_workouts", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("coach_athlete_links", "shares_workouts")
