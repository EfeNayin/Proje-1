"""Users: optional phone number (unverified contact information).

Revision ID: b3c7e9a1d452
Revises: d3f8a6b1c294

Additive only; no existing row is changed or removed.

* users.phone_number: nullable E.164 text ("+905321234567"). Every existing account starts
  with NULL, and an older client that never sends the field keeps working.
* users_phone_number_check: the stored value is always "+", a non-zero digit and 7 to 14
  more digits (at most 15 in total, ITU-T E.164), so a client that skips the API's
  normalization cannot store a free-form string. NULL passes a CHECK, which is what lets
  the column stay optional.

Deliberately no unique index: the number is unverified contact information, not an
identifier, and two accounts may legitimately share one (a family phone).
"""

import sqlalchemy as sa

from alembic import op

revision: str = "b3c7e9a1d452"
down_revision: str | None = "d3f8a6b1c294"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("phone_number", sa.Text(), nullable=True))
    op.create_check_constraint(
        "users_phone_number_check", "users", r"phone_number ~ '^\+[1-9][0-9]{7,14}$'"
    )


def downgrade() -> None:
    op.drop_constraint("users_phone_number_check", "users", type_="check")
    op.drop_column("users", "phone_number")
