"""Receipts for copying an example program into a user's own programs.

Revision ID: f4a8c21d7b93
Revises: c7d9f3a2b6e1
"""

import sqlalchemy as sa

from alembic import op

revision: str = "f4a8c21d7b93"
down_revision: str | None = "c7d9f3a2b6e1"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.create_table(
        "example_program_copy_requests",
        sa.Column(
            "user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("request_id", sa.UUID(), primary_key=True),
        sa.Column("example_id", sa.Text(), nullable=False),
        sa.Column("example_version", sa.SmallInteger(), nullable=False),
        sa.Column(
            "program_id", sa.UUID(), sa.ForeignKey("programs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint("example_version > 0", name="example_copy_requests_version_check"),
    )
    # Deleting a program sets program_id to NULL here; without an index that is a scan.
    op.create_index(
        "idx_example_copy_requests_program",
        "example_program_copy_requests",
        ["program_id"],
        postgresql_where=sa.text("program_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("idx_example_copy_requests_program", table_name="example_program_copy_requests")
    op.drop_table("example_program_copy_requests")
