"""Idempotent set writes using real transactions, including concurrent retries."""

import asyncio
import runpy
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import func, select, text

from alembic.migration import MigrationContext
from alembic.operations import Operations
from app.domains.workouts import service
from app.models import Set, SetSaveRequest


async def test_migration_roundtrip_preserves_workouts_and_sets(
    client, auth_headers, bench_press_id, db
):
    own = await workout(client, auth_headers)
    await client.put(endpoint(own, uuid4()), headers=auth_headers, json=payload(bench_press_id))
    migration = runpy.run_path(
        str(
            Path(__file__).resolve().parents[1]
            / "alembic/versions/a31d92f0c683_set_save_requests.py"
        )
    )

    def migrate(connection, direction):
        with Operations.context(MigrationContext.configure(connection)):
            migration[direction]()

    connection = await db.connection()
    await connection.run_sync(migrate, "downgrade")
    assert await db.scalar(text("SELECT count(*) FROM workouts")) == 1
    assert await db.scalar(text("SELECT count(*) FROM sets")) == 1
    await connection.run_sync(migrate, "upgrade")
    assert await db.scalar(select(func.count()).select_from(SetSaveRequest)) == 0
    assert await db.scalar(text("SELECT count(*) FROM sets")) == 1
    # DDL is transactional in PostgreSQL; restore receipts for fixture cleanup.
    await db.rollback()


async def workout(client, headers):
    response = await client.post("/workouts", headers=headers, json={})
    assert response.status_code == 201
    return response.json()["id"]


def endpoint(workout_id, request_id):
    return f"/workouts/{workout_id}/sets/requests/{request_id}"


def payload(exercise_id, **changes):
    return {
        "exercise_id": exercise_id,
        "weight_kg": 20,
        "reps": 8,
        "rir": 0,
        "is_warmup": False,
        **changes,
    }


async def test_retries_create_one_set_and_preserve_totals(client, auth_headers, bench_press_id, db):
    own = await workout(client, auth_headers)
    url = endpoint(own, uuid4())
    body = payload(bench_press_id)
    first = await client.put(url, headers=auth_headers, json=body)
    replay = await client.put(url, headers=auth_headers, json=body)
    assert first.status_code == replay.status_code == 200
    assert replay.json() == first.json()
    assert replay.json()["total_sets"] == 1
    assert replay.json()["total_volume_kg"] == "160.00"
    assert replay.json()["sets"][0]["rir"] == 0
    assert await db.scalar(select(func.count()).select_from(SetSaveRequest)) == 1


async def test_concurrent_same_and_distinct_requests_number_each_intent_once(
    client,
    auth_headers,
    bench_press_id,
):
    own = await workout(client, auth_headers)
    ids = [uuid4(), uuid4(), uuid4()]
    results = await asyncio.gather(
        *[
            client.put(
                endpoint(own, request_id), headers=auth_headers, json=payload(bench_press_id)
            )
            for request_id in ids * 3
        ]
    )
    assert all(response.status_code == 200 for response in results)
    detail = (await client.get(f"/workouts/{own}", headers=auth_headers)).json()
    assert detail["total_sets"] == 3
    assert detail["total_volume_kg"] == "480.00"
    assert [s["set_number"] for s in detail["sets"]] == [1, 2, 3]


@pytest.mark.parametrize(
    "changes",
    [
        {"weight_kg": 25},
        {"reps": 9},
        {"rir": None},
        {"rpe": 8},
        {"is_warmup": True},
    ],
)
async def test_same_id_different_payload_conflicts(client, auth_headers, bench_press_id, changes):
    own = await workout(client, auth_headers)
    url = endpoint(own, uuid4())
    assert (
        await client.put(url, headers=auth_headers, json=payload(bench_press_id))
    ).status_code == 200
    conflict = await client.put(url, headers=auth_headers, json=payload(bench_press_id, **changes))
    assert conflict.status_code == 409


async def test_equivalent_decimal_and_default_fields_are_same_intent(
    client, auth_headers, bench_press_id
):
    own = await workout(client, auth_headers)
    url = endpoint(own, uuid4())
    body = {"exercise_id": bench_press_id, "weight_kg": "20.00", "reps": 8}
    first = await client.put(url, headers=auth_headers, json=body)
    replay = await client.put(
        url, headers=auth_headers, json={**body, "weight_kg": 20, "rir": None, "is_warmup": False}
    )
    assert first.status_code == replay.status_code == 200
    assert first.json() == replay.json()


async def test_retry_returns_current_log_after_edit_and_does_not_resurrect_deleted_set(
    client,
    auth_headers,
    bench_press_id,
    db,
):
    own = await workout(client, auth_headers)
    url = endpoint(own, uuid4())
    body = payload(bench_press_id)
    first = (await client.put(url, headers=auth_headers, json=body)).json()
    set_id = first["sets"][0]["id"]
    await client.patch(f"/workouts/{own}/sets/{set_id}", headers=auth_headers, json={"reps": 10})
    replay = await client.put(url, headers=auth_headers, json=body)
    assert replay.json()["sets"][0]["reps"] == 10
    assert replay.json()["total_volume_kg"] == "200.00"
    await client.delete(f"/workouts/{own}/sets/{set_id}", headers=auth_headers)
    replay = await client.put(url, headers=auth_headers, json=body)
    assert replay.status_code == 200
    assert replay.json()["sets"] == []
    assert replay.json()["total_sets"] == 0
    assert await db.scalar(select(func.count()).select_from(SetSaveRequest)) == 1


async def test_ownership_checked_before_receipts_and_ids_scoped_to_workout(
    client,
    auth_headers,
    other_auth_headers,
    bench_press_id,
):
    own = await workout(client, auth_headers)
    other = await workout(client, other_auth_headers)
    request_id = uuid4()
    url = endpoint(own, request_id)
    assert (
        await client.put(url, headers=auth_headers, json=payload(bench_press_id))
    ).status_code == 200
    assert (
        await client.put(url, headers=other_auth_headers, json=payload(bench_press_id))
    ).status_code == 404
    assert (await client.put(url, json=payload(bench_press_id))).status_code == 401
    assert (
        await client.put(
            endpoint(other, request_id), headers=other_auth_headers, json=payload(bench_press_id)
        )
    ).status_code == 200
    await client.delete(f"/workouts/{own}", headers=auth_headers)
    assert (
        await client.put(url, headers=auth_headers, json=payload(bench_press_id))
    ).status_code == 404


async def test_failure_before_commit_rolls_back_receipt_and_set(
    client,
    auth_headers,
    bench_press_id,
    db,
    monkeypatch,
):
    own = await workout(client, auth_headers)
    url = endpoint(own, uuid4())
    original = service._to_detail

    async def fail(*args):
        raise RuntimeError("Before commit")

    monkeypatch.setattr(service, "_to_detail", fail)
    with pytest.raises(RuntimeError, match="Before commit"):
        await client.put(url, headers=auth_headers, json=payload(bench_press_id))
    assert await db.scalar(select(func.count()).select_from(SetSaveRequest)) == 0
    assert await db.scalar(select(func.count()).select_from(Set)) == 0
    monkeypatch.setattr(service, "_to_detail", original)
    retry = await client.put(url, headers=auth_headers, json=payload(bench_press_id))
    assert retry.status_code == 200
    assert retry.json()["total_sets"] == 1


async def test_validation_rejection_does_not_reserve_key(client, auth_headers, bench_press_id, db):
    own = await workout(client, auth_headers)
    url = endpoint(own, uuid4())
    for body in [payload(bench_press_id, reps=-1), payload(str(uuid4()))]:
        assert (await client.put(url, headers=auth_headers, json=body)).status_code == 422
    assert await db.scalar(select(func.count()).select_from(SetSaveRequest)) == 0
    assert (
        await client.put(url, headers=auth_headers, json=payload(bench_press_id))
    ).status_code == 200


async def test_warmup_and_finished_workout_retry(client, auth_headers, bench_press_id):
    own = await workout(client, auth_headers)
    url = endpoint(own, uuid4())
    body = payload(bench_press_id, is_warmup=True)
    first = await client.put(url, headers=auth_headers, json=body)
    assert first.json()["total_sets"] == 0
    await client.post(f"/workouts/{own}/finish", headers=auth_headers)
    replay = await client.put(url, headers=auth_headers, json=body)
    assert len(replay.json()["sets"]) == 1
    assert replay.json()["finished_at"] is not None
