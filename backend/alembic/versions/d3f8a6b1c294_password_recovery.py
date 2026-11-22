"""Password recovery: credential version and recovery challenges.

Revision ID: d3f8a6b1c294
Revises: a9c4e1f72b35

Additive only; no existing row is changed or removed.

* users.credential_version: every existing account starts at 0, which is also what a
  token issued before this migration counts as (it carries no version), so nothing is
  signed out by applying it. A completed password recovery bumps it, which ends every
  access token issued before.
* password_reset_challenges: at most one outstanding recovery code per account (unique
  user_id), holding a keyed hash of the code, never the code. Deleted with the account.
"""

import sqlalchemy as sa

from alembic import op

revision: str = "d3f8a6b1c294"
down_revision: str | None = "a9c4e1f72b35"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("credential_version", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    op.create_table(
        "password_reset_challenges",
        sa.Column(
            "id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("code_hash", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.SmallInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("attempts >= 0", name="password_reset_attempts_check"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )


def downgrade() -> None:
    op.drop_table("password_reset_challenges")
    op.drop_column("users", "credential_version")
