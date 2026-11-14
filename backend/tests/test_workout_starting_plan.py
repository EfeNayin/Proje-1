"""Historical targets come from the session, never the mutable template."""

import asyncio
from uuid import UUID

import pytest
from sqlalchemy import update

from app.domains.programs import service
from app.models import Workout


async def make_plan(client, headers, bench, squat):
    program = await client.post("/programs", headers=headers, json={"name": "PPL"})
    program_id = program.json()["id"]
    template = await client.post(
        f"/programs/{program_id}/templates/with-exercises", headers=headers,
        json={"name": "Original", "day_order": 2, "notes": "Original notes", "exercises": [
            {"exercise_id": squat, "target_sets": 4, "target_reps_min": 6,
             "target_reps_max": 8, "target_rir": 2, "notes": "Slow lowering"},
            {"exercise_id": bench, "target_sets": 3, "target_rpe": 8.5},
        ]},
    )
    assert template.status_code == 201, template.text
    return program_id, template.json()


async def start(client, headers, template_id):
    response = await client.post(f"/templates/{template_id}/start", headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


async def test_old_plan_survives_edits_and_new_session_gets_new_targets(
    client, auth_headers, bench_press_id, squat_id
):
    _, original = await make_plan(client, auth_headers, bench_press_id, squat_id)
    first = await start(client, auth_headers, original["id"])
    assert first["targets"] == original["exercises"]
    await client.patch(f"/templates/{original['id']}", headers=auth_headers,
                       json={"name": "Changed", "notes": "Changed notes", "day_order": 3})
    changed = await client.put(f"/templates/{original['id']}/exercises", headers=auth_headers,
                               json={"exercises": [{"exercise_id": bench_press_id,
                                                    "target_sets": 1}]})
    second = await start(client, auth_headers, original["id"])
    old = await client.get(f"/workouts/{first['workout_id']}", headers=auth_headers)
    new = await client.get(f"/workouts/{second['workout_id']}", headers=auth_headers)
    assert old.json()["template_snapshot"] == original
    assert new.json()["template_snapshot"] == changed.json()
    assert old.json()["sets"] == new.json()["sets"] == []
    assert old.json()["finished_automatically"] is True
    assert old.json()["total_sets"] == 0
    history = await client.get("/workouts", headers=auth_headers)
    assert "template_snapshot" not in history.json()["items"][0]


@pytest.mark.parametrize("delete_parent", [False, True])
async def test_snapshot_survives_template_or_program_deletion(
    client, auth_headers, bench_press_id, squat_id, delete_parent
):
    program_id, original = await make_plan(client, auth_headers, bench_press_id, squat_id)
    session = await start(client, auth_headers, original["id"])
    endpoint = f"/programs/{program_id}" if delete_parent else f"/templates/{original['id']}"
    response = await client.delete(endpoint, headers=auth_headers)
    assert response.status_code == 204
    detail = await client.get(f"/workouts/{session['workout_id']}", headers=auth_headers)
    assert detail.json()["template_id"] is None
    assert detail.json()["template_snapshot"] == original


async def test_workout_and_set_edits_do_not_rewrite_snapshot(
    client, auth_headers, bench_press_id, squat_id
):
    _, original = await make_plan(client, auth_headers, bench_press_id, squat_id)
    session = await start(client, auth_headers, original["id"])
    endpoint = f"/workouts/{session['workout_id']}"
    added = await client.post(f"{endpoint}/sets", headers=auth_headers,
                              json={"exercise_id": bench_press_id, "weight_kg": 40, "reps": 8})
    assert added.status_code == 201, added.text
    assert added.json()["template_snapshot"] == original
    updated = await client.patch(endpoint, headers=auth_headers,
                                 json={"title": "My session", "template_snapshot": None})
    assert updated.json()["template_snapshot"] == original
    finished = await client.post(f"{endpoint}/finish", headers=auth_headers)
    assert finished.json()["template_snapshot"] == original


async def test_legacy_missing_snapshot_is_not_reconstructed(
    client, auth_headers, bench_press_id, squat_id, db
):
    _, original = await make_plan(client, auth_headers, bench_press_id, squat_id)
    session = await start(client, auth_headers, original["id"])
    await db.execute(update(Workout).where(Workout.id == UUID(session["workout_id"])).values(
        template_snapshot=None
    ))
    await db.commit()
    detail = await client.get(f"/workouts/{session['workout_id']}", headers=auth_headers)
    assert detail.json()["template_id"] == original["id"]
    assert detail.json()["template_snapshot"] is None


async def test_empty_plan_is_distinct_from_free_workout(client, auth_headers):
    program = await client.post("/programs", headers=auth_headers, json={"name": "Empty plan"})
    template = await client.post(f"/programs/{program.json()['id']}/templates",
                                 headers=auth_headers, json={"name": "Empty day"})
    session = await start(client, auth_headers, template.json()["id"])
    detail = await client.get(f"/workouts/{session['workout_id']}", headers=auth_headers)
    assert detail.json()["template_snapshot"]["exercises"] == []
    free = await client.post("/workouts", headers=auth_headers, json={
        "title": "Free", "template_snapshot": template.json(),
    })
    assert free.json()["template_snapshot"] is None


async def test_other_user_cannot_read_snapshot(
    client, auth_headers, other_auth_headers, bench_press_id, squat_id
):
    _, original = await make_plan(client, auth_headers, bench_press_id, squat_id)
    session = await start(client, auth_headers, original["id"])
    detail = await client.get(f"/workouts/{session['workout_id']}", headers=other_auth_headers)
    assert detail.status_code == 404


async def test_target_replacement_waits_for_start_snapshot(
    client, auth_headers, bench_press_id, squat_id, monkeypatch
):
    _, original = await make_plan(client, auth_headers, bench_press_id, squat_id)
    snapshot_started = asyncio.Event()
    edit_started = asyncio.Event()
    to_detail = service._to_template_detail
    load_template = service._load_owned_template

    async def pause_snapshot(db, template):
        if not snapshot_started.is_set():
            snapshot_started.set()
            await asyncio.wait_for(edit_started.wait(), timeout=5)
        return await to_detail(db, template)

    async def announce_edit(db, template_id, user_id, *, lock=False):
        if snapshot_started.is_set():
            edit_started.set()
        return await load_template(db, template_id, user_id, lock=lock)

    monkeypatch.setattr(service, "_to_template_detail", pause_snapshot)
    monkeypatch.setattr(service, "_load_owned_template", announce_edit)

    async def edit():
        await asyncio.wait_for(snapshot_started.wait(), timeout=5)
        return await client.put(f"/templates/{original['id']}/exercises", headers=auth_headers,
                                json={"exercises": [{"exercise_id": bench_press_id,
                                                     "target_sets": 1}]})

    session, edited = await asyncio.wait_for(asyncio.gather(
        start(client, auth_headers, original["id"]), edit()
    ), timeout=10)
    assert edited.status_code == 200
    detail = await client.get(f"/workouts/{session['workout_id']}", headers=auth_headers)
    assert detail.json()["template_snapshot"] == original
