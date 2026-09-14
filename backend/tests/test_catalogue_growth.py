"""Adım 24 (PROJE_1_CODEX_INCELEME.md): the user asked for the catalogue to
keep growing, pointed at fitnessprogramer.com/exercises/ as a source, and
asked for 50 more. Mirrors test_catalogue_coverage.py (Adım 4) and
test_catalogue_expansion.py (Adım 22)'s approach for the migration that adds
them (254456be6d79): every muscle now has at least four official primary
exercises, a representative sample of the new ones round-trips through
search → logging → weekly-volume the same way the rest of the catalogue
does, and the migration itself is a safe, reversible, FK-respecting data
change.
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
    "alembic/versions/254456be6d79_add_50_more_exercises_sourced_from_a_.py"
)


async def test_every_muscle_has_at_least_four_official_direct_exercises(
    db: AsyncSession,
) -> None:
    """946401aa1328 (Adım 22) only guaranteed two."""
    short = await db.execute(
        text("""
        SELECT m.name, count(*) FILTER (WHERE em.role = 'primary') AS primary_count
        FROM muscle_groups m
        LEFT JOIN exercise_muscle_groups em ON em.muscle_group_id = m.id
        LEFT JOIN exercises e ON e.id = em.exercise_id AND e.created_by IS NULL
        GROUP BY m.name
        HAVING count(*) FILTER (WHERE em.role = 'primary' AND e.id IS NOT NULL) < 4
    """)
    )
    assert short.all() == []


@pytest.mark.parametrize(
    "muscle,query,name,equipment",
    [
        ("chest", "pec deck", "Pec Deck Fly", "machine"),
        ("lats", "straight-arm", "Straight-Arm Pulldown", "cable"),
        ("front_delts", "landmine press", "Landmine Press", "barbell"),
        ("triceps", "skull crusher", "Barbell Skull Crusher", "barbell"),
        ("quads", "hack squat", "Hack Squat", "machine"),
        ("obliques", "woodchop", "Cable Woodchop", "cable"),
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
    # Per the user's request this round, name_tr is the same English string
    # (see the migration's docstring) rather than a Turkish translation.
    assert exercise["name_tr"] == name
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
        assert await db.scalar(text("SELECT count(*) FROM exercises")) == 46
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
    exercise_id = "84a8250e-35ff-4aba-aa1a-7cbc7b1873a5"  # Pec Deck Fly
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
    # 96 seeded at head; the failed downgrade above changes nothing.
    assert await db.scalar(text("SELECT count(*) FROM exercises")) == 96
    assert await db.scalar(text("SELECT count(*) FROM sets")) == 1
    assert (
        await db.scalar(
            text(f"""
        SELECT count(*) FROM exercise_muscle_groups
        WHERE exercise_id = '{exercise_id}'
    """)
        )
        == 1
    )
