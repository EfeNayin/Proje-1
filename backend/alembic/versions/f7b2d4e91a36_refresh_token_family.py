"""Group refresh tokens into the session they rotate within.

Revision ID: f7b2d4e91a36
Revises: e8a3c5d17b24

Additive only. A session is the chain of tokens one sign-in produces: every
refresh revokes its token and issues a successor, and the successor shares the
family. Logout needs that link to end the whole chain, including a successor
issued while the sign-out was on its way.

Existing rows each receive a family of their own (the chain they belonged to was
never recorded, and no row is changed or removed). That is exact for a token still
live: its next rotation carries the family forward. The column has a server
default, so code that does not set it yet keeps working and simply starts a new
family per token.
"""

import sqlalchemy as sa

from alembic import op

revision: str = "f7b2d4e91a36"
down_revision: str | None = "e8a3c5d17b24"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.add_column(
        "refresh_tokens",
        sa.Column(
            "family_id",
            sa.UUID(),
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
    )
    op.create_index("idx_refresh_tokens_family_id", "refresh_tokens", ["family_id"])


def downgrade() -> None:
    op.drop_index("idx_refresh_tokens_family_id", table_name="refresh_tokens")
    op.drop_column("refresh_tokens", "family_id")
