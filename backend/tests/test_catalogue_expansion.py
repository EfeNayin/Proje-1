"""Adım 22 (PROJE_1_CODEX_INCELEME.md): the user asked for more exercise
variety — most muscles had exactly one primary-work option in the seed
catalogue, which meant no equipment alternative and no real choice. This
mirrors test_catalogue_coverage.py's approach for the migration that fixed
the analogous gap (c6a42e8b91df, Adım 4), but for
946401aa1328_expand_exercise_catalogue_with_more_per_.py: every muscle now
has at least two official primary exercises, a representative sample of the
newly added ones round-trips through search → logging → weekly-volume the
same way the rest of the catalogue does, and the migration itself is a safe,
reversible, FK-respecting data change.
"""

import runpy
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from alembic.migration import MigrationContext
from alembic.operations import Operations

MIGRATION = Path(__file__).resolve().parents[1] / (
    "alembic/versions/946401aa1328_expand_exercise_catalogue_with_more_per_.py"
)


async def test_every_muscle_has_at_least_two_official_direct_exercises(
    db: AsyncSession,
) -> None:
    """Adım 4 only guaranteed one; a single option is still no real choice."""
    short = await db.execute(
        text("""
        SELECT m.name, count(*) FILTER (WHERE em.role = 'primary') AS primary_count
        FROM muscle_groups m
        LEFT JOIN exercise_muscle_groups em ON em.muscle_group_id = m.id
        LEFT JOIN exercises e ON e.id = em.exercise_id AND e.created_by IS NULL
        GROUP BY m.name
        HAVING count(*) FILTER (WHERE em.role = 'primary' AND e.id IS NOT NULL) < 2
    """)
    )
    assert short.all() == []


@pytest.mark.parametrize(
    "muscle,query,name,equipment",
    [
        ("glutes", "hip thrust", "Hip Thrust", "barbell"),
        ("chest", "sinav", "Push-Up", "bodyweight"),
        ("biceps", "barbell curl", "Barbell Curl", "barbell"),
        ("rear_delts", "face pull", "Face Pull", "cable"),
        ("abs", "asili bacak", "Hanging Leg Raise", "bodyweight"),
        ("traps", "barbell omuz silkme", "Barbell Shrug", "barbell"),
    ],
)
async def test_new_exercise_can_be_found_logged_and_counted(
    client: AsyncClient,
    auth_headers: dict[str, str],
    muscle: str,
    query: str,
    name: str,
    equipment: str,
) -> None:
    response = await client.get(
        "/exercises",
        headers=auth_headers,
        params={"q": query, "muscle": muscle, "equipment": equipment},
    )
    assert response.status_code == 200
    assert response.json()["total"] == 1
    exercise = response.json()["items"][0]
    assert exercise["name"] == name
    detail = await client.get(f"/exercises/{exercise['id']}", headers=auth_headers)
    assert any(m["name"] == muscle and m["role"] == "primary" for m in detail.json()["muscles"])
    logged = await client.post(
        "/workouts",
        headers=auth_headers,
        json={
            "sets": [
                {"exercise_id": exercise["id"], "weight_kg": 0, "reps": 12, "is_warmup": False}
                for _ in range(3)
            ]
        },
    )
    assert logged.status_code == 201, logged.text
    volume = await client.get("/analytics/weekly-volume?weeks=1", headers=auth_headers)
    assert volume.status_code == 200
    muscles = {m["name"]: m for m in volume.json()["weeks"][0]["muscles"]}
    assert muscles[muscle]["direct_sets"] == 3
    assert muscles[muscle]["status"] != "untrained"


def _migrate(connection: Connection, direction: str) -> None:
    migration = runpy.run_path(str(MIGRATION))
    with Operations.context(MigrationContext.configure(connection)):
        migration[direction]()


async def test_catalogue_migration_roundtrip_preserves_original_entries(db: AsyncSession) -> None:
    connection = await db.connection()
    before = (await db.execute(text("SELECT id, name, name_tr FROM exercises ORDER BY id"))).all()
    async with connection.begin_nested():
        await connection.run_sync(_migrate, "downgrade")
        assert await db.scalar(text("SELECT count(*) FROM exercises")) == 25
        await connection.run_sync(_migrate, "upgrade")
        after = (
            await db.execute(text("SELECT id, name, name_tr FROM exercises ORDER BY id"))
        ).all()
        assert after == before
    await db.rollback()


async def test_downgrade_refuses_to_remove_logged_exercises(
    db: AsyncSession,
    client: AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    exercise_id = "134e6937-828e-41e4-aa94-002eb8b5ff93"  # Hip Thrust
    logged = await client.post(
        "/workouts",
        headers=auth_headers,
        json={"sets": [{"exercise_id": exercise_id, "weight_kg": 0, "reps": 12}]},
    )
    assert logged.status_code == 201, logged.text
    connection = await db.connection()
    with pytest.raises(IntegrityError):
        async with connection.begin_nested():
            await connection.run_sync(_migrate, "downgrade")
    assert await db.scalar(text("SELECT count(*) FROM exercises")) == 46
    assert await db.scalar(text("SELECT count(*) FROM sets")) == 1
    assert (
        await db.scalar(
            text(f"""
        SELECT count(*) FROM exercise_muscle_groups
        WHERE exercise_id = '{exercise_id}'
    """)
        )
        == 2
    )
