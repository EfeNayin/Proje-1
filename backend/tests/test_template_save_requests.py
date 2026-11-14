"""Retry receipts are committed with the template, using real concurrent transactions."""

import asyncio
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.domains.programs import service
from app.models import TemplateSaveRequest


async def program(client, headers):
    response = await client.post("/programs", headers=headers, json={"name": "PPL"})
    assert response.status_code == 201
    return response.json()["id"]


def url(program_id, request_id):
    return f"/programs/{program_id}/templates/requests/{request_id}"


def payload(exercise_id):
    return {"name": "Push", "day_order": 1, "exercises": [
        {"exercise_id": exercise_id, "target_sets": 3, "target_reps_min": 6,
         "target_reps_max": 8},
    ]}


async def test_lost_response_replays_original_receipt_after_template_edit(
    client, auth_headers, bench_press_id, db
):
    program_id = await program(client, auth_headers)
    endpoint = url(program_id, uuid4())
    body = payload(bench_press_id)
    first = await client.put(endpoint, headers=auth_headers, json=body)
    assert first.status_code == 201, first.text
    await client.patch(f"/templates/{first.json()['id']}", headers=auth_headers,
                       json={"name": "Edited later"})
    replay = await client.put(endpoint, headers=auth_headers, json=body)
    assert replay.status_code == 201
    assert replay.json() == first.json()
    detail = await client.get(f"/programs/{program_id}", headers=auth_headers)
    assert len(detail.json()["templates"]) == 1
    assert detail.json()["templates"][0]["name"] == "Edited later"
    assert await db.scalar(select(func.count()).select_from(TemplateSaveRequest)) == 1


async def test_concurrent_retries_create_one_template(client, auth_headers, bench_press_id):
    program_id = await program(client, auth_headers)
    endpoint = url(program_id, uuid4())
    responses = await asyncio.gather(*[
        client.put(endpoint, headers=auth_headers, json=payload(bench_press_id))
        for _ in range(5)
    ])
    assert [response.status_code for response in responses] == [201] * 5
    assert all(response.json() == responses[0].json() for response in responses)
    detail = await client.get(f"/programs/{program_id}", headers=auth_headers)
    assert len(detail.json()["templates"]) == 1
    assert len(detail.json()["templates"][0]["exercises"]) == 1


@pytest.mark.parametrize("change", ["name", "targets", "program"])
async def test_reused_key_with_different_intent_is_rejected(
    client, auth_headers, bench_press_id, change
):
    program_id = await program(client, auth_headers)
    request_id = uuid4()
    body = payload(bench_press_id)
    first = await client.put(url(program_id, request_id), headers=auth_headers, json=body)
    assert first.status_code == 201
    if change == "name":
        body["name"] = "Changed"
    elif change == "targets":
        body["exercises"][0]["target_sets"] = 4
    else:
        program_id = await program(client, auth_headers)
    response = await client.put(url(program_id, request_id), headers=auth_headers, json=body)
    assert response.status_code == 409


async def test_keys_are_account_scoped_and_ownership_is_checked_before_replay(
    client, auth_headers, other_auth_headers, bench_press_id
):
    own = await program(client, auth_headers)
    other = await program(client, other_auth_headers)
    request_id = uuid4()
    first = await client.put(url(own, request_id), headers=auth_headers,
                             json=payload(bench_press_id))
    assert first.status_code == 201
    forbidden = await client.put(url(own, request_id), headers=other_auth_headers,
                                 json=payload(bench_press_id))
    assert forbidden.status_code == 404
    allowed = await client.put(url(other, request_id), headers=other_auth_headers,
                               json=payload(bench_press_id))
    assert allowed.status_code == 201
    assert allowed.json()["id"] != first.json()["id"]


async def test_deleted_template_is_not_recreated_on_retry(client, auth_headers, bench_press_id):
    program_id = await program(client, auth_headers)
    endpoint = url(program_id, uuid4())
    first = await client.put(endpoint, headers=auth_headers, json=payload(bench_press_id))
    await client.delete(f"/templates/{first.json()['id']}", headers=auth_headers)
    retry = await client.put(endpoint, headers=auth_headers, json=payload(bench_press_id))
    assert retry.status_code == 404
    detail = await client.get(f"/programs/{program_id}", headers=auth_headers)
    assert detail.json()["templates"] == []


async def test_rollback_releases_receipt_and_retry_succeeds(
    client, auth_headers, bench_press_id, monkeypatch, db
):
    program_id = await program(client, auth_headers)
    endpoint = url(program_id, uuid4())
    original = service._to_template_detail

    async def fail(db, template):
        raise RuntimeError("Before commit")

    monkeypatch.setattr(service, "_to_template_detail", fail)
    with pytest.raises(RuntimeError, match="Before commit"):
        await client.put(endpoint, headers=auth_headers, json=payload(bench_press_id))
    assert await db.scalar(select(func.count()).select_from(TemplateSaveRequest)) == 0
    monkeypatch.setattr(service, "_to_template_detail", original)
    retry = await client.put(endpoint, headers=auth_headers, json=payload(bench_press_id))
    assert retry.status_code == 201
    detail = await client.get(f"/programs/{program_id}", headers=auth_headers)
    assert len(detail.json()["templates"]) == 1


async def test_invalid_exercise_does_not_consume_key(client, auth_headers, bench_press_id):
    program_id = await program(client, auth_headers)
    endpoint = url(program_id, uuid4())
    invalid = await client.put(endpoint, headers=auth_headers, json=payload(str(uuid4())))
    assert invalid.status_code == 422
    valid = await client.put(endpoint, headers=auth_headers, json=payload(bench_press_id))
    assert valid.status_code == 201
