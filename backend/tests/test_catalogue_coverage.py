"""Catalogue coverage must be usable through search, logging and volume analytics."""

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
    "alembic/versions/c6a42e8b91df_complete_primary_catalogue.py"
)


async def test_every_muscle_has_an_official_direct_exercise(db: AsyncSession) -> None:
    missing = await db.execute(
        text("""
        SELECT m.name FROM muscle_groups m WHERE NOT EXISTS (
            SELECT 1 FROM exercise_muscle_groups em JOIN exercises e ON e.id = em.exercise_id
            WHERE em.muscle_group_id = m.id AND em.role = 'primary' AND e.created_by IS NULL
        )
    """)
    )
    assert missing.scalars().all() == []


@pytest.mark.parametrize(
    "muscle,query,name,equipment",
    [
        ("abs", "karin sikistirma", "Crunch", "bodyweight"),
        ("obliques", "yan egilme", "Dumbbell Side Bend", "dumbbell"),
        ("forearms", "bilek bukme", "Dumbbell Wrist Curl", "dumbbell"),
        ("rear_delts", "ters acis", "Dumbbell Reverse Fly", "dumbbell"),
        ("traps", "omuz silkme", "Dumbbell Shrug", "dumbbell"),
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
    assert all(m["direct_sets"] == 0 for key, m in muscles.items() if key != muscle)


def _migrate(connection: Connection, direction: str) -> None:
    migration = runpy.run_path(str(MIGRATION))
    with Operations.context(MigrationContext.configure(connection)):
        migration[direction]()


async def test_catalogue_migration_roundtrip_preserves_original_entries(db: AsyncSession) -> None:
    connection = await db.connection()
    before = (await db.execute(text("SELECT id, name, name_tr FROM exercises ORDER BY id"))).all()
    async with connection.begin_nested():
        await connection.run_sync(_migrate, "downgrade")
        assert await db.scalar(text("SELECT count(*) FROM exercises")) == 20
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
    exercise_id = "670ce4cd-34be-4ab9-bf34-221d55fe4101"
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
    assert await db.scalar(text("SELECT count(*) FROM exercises")) == 25
    assert await db.scalar(text("SELECT count(*) FROM sets")) == 1
    assert (
        await db.scalar(
            text("""
        SELECT count(*) FROM exercise_muscle_groups
        WHERE exercise_id = '670ce4cd-34be-4ab9-bf34-221d55fe4101'
    """)
        )
        == 1
    )
