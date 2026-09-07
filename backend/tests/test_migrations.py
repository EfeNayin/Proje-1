"""Regression tests for data-migrating Alembic revisions.

These test the exact SQL expression a migration uses to transform existing
data, run against real PostgreSQL — not the migration machinery itself
(upgrade/downgrade cycles for that are exercised manually, see
alembic/versions/*.py docstrings for what was verified by hand).
"""

from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


class TestDisplayNameSplit:
    """alembic/versions/6ad6922ce3aa_*.py splits users.display_name into
    first_name/last_name on the first space, leaving last_name NULL for a
    single word. Keep this expression identical to the one in that
    migration's upgrade() — that's what is actually verified here."""

    _SPLIT_SQL = (
        "SELECT split_part(:name, ' ', 1) AS first_name, "
        "NULLIF(substring(:name FROM position(' ' IN :name) + 1), :name) AS last_name"
    )

    async def test_splits_a_full_name(self, db: AsyncSession) -> None:
        result = await db.execute(text(self._SPLIT_SQL), {"name": "Efe Nayın"})
        row = result.one()
        assert row.first_name == "Efe"
        assert row.last_name == "Nayın"

    async def test_single_word_name_leaves_last_name_null(self, db: AsyncSession) -> None:
        result = await db.execute(text(self._SPLIT_SQL), {"name": "Efe"})
        row = result.one()
        assert row.first_name == "Efe"
        assert row.last_name is None

    async def test_extra_spaces_go_into_last_name(self, db: AsyncSession) -> None:
        """Only the FIRST space splits; a middle name lands in last_name
        whole, rather than being dropped or causing an error."""
        result = await db.execute(text(self._SPLIT_SQL), {"name": "Efe Can Nayın"})
        row = result.one()
        assert row.first_name == "Efe"
        assert row.last_name == "Can Nayın"


class TestDisplayNameGone:
    """The API must never expose or accept display_name again — a lingering
    reference would mean the two representations drifted back out of sync."""

    async def test_profile_response_has_no_display_name(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.get("/users/me", headers=auth_headers)
        assert "display_name" not in response.json()
