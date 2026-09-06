"""Tests for programs, templates, template exercises and starting from a template.

Three things get disproportionate attention:

- The single-active-program invariant, because it is backed by a real
  database constraint (idx_programs_one_active) that the service layer must
  respect with the right transaction order, not just "usually work".
- Ownership through templates and their exercises, which carry no user_id
  of their own and prove ownership only by joining through their program.
- Starting a workout from a template, because it is the one place this
  domain reaches into workouts: template_id must be set and no sets created.
"""

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Program, TemplateExercise, WorkoutTemplate


async def _create_program(
    client: AsyncClient, headers: dict[str, str], **kwargs: Any
) -> dict[str, Any]:
    response = await client.post("/programs", headers=headers, json=kwargs or {"name": "PPL"})
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def _create_template(
    client: AsyncClient, headers: dict[str, str], program_id: str, **kwargs: Any
) -> dict[str, Any]:
    response = await client.post(
        f"/programs/{program_id}/templates", headers=headers, json=kwargs or {"name": "Push A"}
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


class TestCreateProgram:
    async def test_creates_an_active_program_with_no_templates(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        body = await _create_program(client, auth_headers, name="PPL")

        assert body["name"] == "PPL"
        assert body["is_active"] is True
        assert body["templates"] == []

    async def test_creating_a_second_program_deactivates_the_first(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        first = await _create_program(client, auth_headers, name="PPL")
        await _create_program(client, auth_headers, name="5/3/1")

        response = await client.get("/programs", headers=auth_headers)
        by_name = {p["name"]: p for p in response.json()}

        assert by_name["PPL"]["is_active"] is False
        assert by_name["5/3/1"]["is_active"] is True
        assert by_name["PPL"]["id"] == first["id"]


class TestListPrograms:
    async def test_lists_only_this_users_programs(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        other_auth_headers: dict[str, str],
    ) -> None:
        await _create_program(client, auth_headers, name="Mine")
        await _create_program(client, other_auth_headers, name="Theirs")

        response = await client.get("/programs", headers=auth_headers)
        names = [p["name"] for p in response.json()]

        assert names == ["Mine"]


class TestGetProgram:
    async def test_returns_program_with_nested_templates_and_exercises(
        self, client: AsyncClient, auth_headers: dict[str, str], bench_press_id: str
    ) -> None:
        program = await _create_program(client, auth_headers, name="PPL")
        template = await _create_template(
            client, auth_headers, program["id"], name="Push A", day_order=1
        )
        await client.put(
            f"/templates/{template['id']}/exercises",
            headers=auth_headers,
            json={
                "exercises": [
                    {
                        "exercise_id": bench_press_id,
                        "target_sets": 4,
                        "target_reps_min": 6,
                        "target_reps_max": 8,
                    }
                ]
            },
        )

        response = await client.get(f"/programs/{program['id']}", headers=auth_headers)

        assert response.status_code == 200, response.text
        body = response.json()
        assert len(body["templates"]) == 1
        assert body["templates"][0]["name"] == "Push A"
        assert body["templates"][0]["exercises"][0]["exercise_name"] == "Barbell Bench Press"
        assert body["templates"][0]["exercises"][0]["target_reps_min"] == 6

    async def test_other_users_program_is_404(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        other_auth_headers: dict[str, str],
    ) -> None:
        program = await _create_program(client, other_auth_headers, name="Theirs")

        response = await client.get(f"/programs/{program['id']}", headers=auth_headers)

        assert response.status_code == 404, response.text


class TestUpdateProgram:
    async def test_updates_name_and_notes(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        program = await _create_program(client, auth_headers, name="PPL")

        response = await client.patch(
            f"/programs/{program['id']}",
            headers=auth_headers,
            json={"name": "PPL v2", "notes": "deload week 4"},
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["name"] == "PPL v2"
        assert body["notes"] == "deload week 4"


class TestActivateProgram:
    async def test_activating_an_old_program_deactivates_the_current_one(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """The "switch programs, then revert to the old one" scenario end to end."""
        old = await _create_program(client, auth_headers, name="Old System")
        await _create_program(client, auth_headers, name="New System")

        response = await client.post(f"/programs/{old['id']}/activate", headers=auth_headers)

        assert response.status_code == 200, response.text
        assert response.json()["is_active"] is True

        listing = {
            p["name"]: p["is_active"]
            for p in (await client.get("/programs", headers=auth_headers)).json()
        }
        assert listing["Old System"] is True
        assert listing["New System"] is False

    async def test_other_users_program_cannot_be_activated(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        other_auth_headers: dict[str, str],
    ) -> None:
        program = await _create_program(client, other_auth_headers, name="Theirs")

        response = await client.post(f"/programs/{program['id']}/activate", headers=auth_headers)

        assert response.status_code == 404, response.text

    async def test_database_rejects_two_active_programs_for_one_user(
        self, client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        """Proves the partial unique index itself, not just the service code
        that is supposed to respect it."""
        first = await _create_program(client, auth_headers, name="A")
        await _create_program(client, auth_headers, name="B")  # deactivates A

        with pytest.raises(IntegrityError):
            await db.execute(
                update(Program).where(Program.id == first["id"]).values(is_active=True)
            )
            await db.commit()


class TestDeleteProgram:
    async def test_deletes_program_and_cascades_templates_and_exercises(
        self,
        client: AsyncClient,
        db: AsyncSession,
        auth_headers: dict[str, str],
        bench_press_id: str,
    ) -> None:
        program = await _create_program(client, auth_headers, name="PPL")
        template = await _create_template(client, auth_headers, program["id"])
        await client.put(
            f"/templates/{template['id']}/exercises",
            headers=auth_headers,
            json={"exercises": [{"exercise_id": bench_press_id, "target_sets": 3}]},
        )

        response = await client.delete(f"/programs/{program['id']}", headers=auth_headers)
        assert response.status_code == 204, response.text

        assert await db.scalar(select(func.count()).select_from(WorkoutTemplate)) == 0
        assert await db.scalar(select(func.count()).select_from(TemplateExercise)) == 0

    async def test_other_users_program_delete_is_404(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        other_auth_headers: dict[str, str],
    ) -> None:
        program = await _create_program(client, other_auth_headers, name="Theirs")

        response = await client.delete(f"/programs/{program['id']}", headers=auth_headers)

        assert response.status_code == 404, response.text


class TestTemplates:
    async def test_update_template_name_and_day_order(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        program = await _create_program(client, auth_headers, name="PPL")
        template = await _create_template(
            client, auth_headers, program["id"], name="Push A", day_order=1
        )

        response = await client.patch(
            f"/templates/{template['id']}",
            headers=auth_headers,
            json={"name": "Push B", "day_order": 2},
        )

        assert response.status_code == 200, response.text
        assert response.json()["name"] == "Push B"
        assert response.json()["day_order"] == 2

    async def test_delete_template(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        program = await _create_program(client, auth_headers, name="PPL")
        template = await _create_template(client, auth_headers, program["id"])

        response = await client.delete(f"/templates/{template['id']}", headers=auth_headers)
        assert response.status_code == 204, response.text

        follow_up = await client.get(f"/templates/{template['id']}", headers=auth_headers)
        assert follow_up.status_code == 404, follow_up.text

    async def test_template_ownership_is_proven_through_its_program(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        other_auth_headers: dict[str, str],
    ) -> None:
        program = await _create_program(client, other_auth_headers, name="Theirs")
        template = await _create_template(client, other_auth_headers, program["id"])

        get_response = await client.get(f"/templates/{template['id']}", headers=auth_headers)
        patch_response = await client.patch(
            f"/templates/{template['id']}", headers=auth_headers, json={"name": "Hijacked"}
        )
        delete_response = await client.delete(f"/templates/{template['id']}", headers=auth_headers)

        assert get_response.status_code == 404
        assert patch_response.status_code == 404
        assert delete_response.status_code == 404


class TestTemplateExercises:
    async def test_set_exercises_replaces_the_previous_set(
        self,
        client: AsyncClient,
        db: AsyncSession,
        auth_headers: dict[str, str],
        bench_press_id: str,
        squat_id: str,
    ) -> None:
        program = await _create_program(client, auth_headers, name="PPL")
        template = await _create_template(client, auth_headers, program["id"])

        await client.put(
            f"/templates/{template['id']}/exercises",
            headers=auth_headers,
            json={"exercises": [{"exercise_id": bench_press_id, "target_sets": 4}]},
        )
        second = await client.put(
            f"/templates/{template['id']}/exercises",
            headers=auth_headers,
            json={"exercises": [{"exercise_id": squat_id, "target_sets": 5}]},
        )

        assert second.status_code == 200, second.text
        assert len(second.json()["exercises"]) == 1
        assert second.json()["exercises"][0]["exercise_id"] == squat_id

        count = await db.scalar(select(func.count()).select_from(TemplateExercise))
        assert count == 1

    async def test_exercise_order_follows_payload_order(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        bench_press_id: str,
        squat_id: str,
    ) -> None:
        program = await _create_program(client, auth_headers, name="PPL")
        template = await _create_template(client, auth_headers, program["id"])

        response = await client.put(
            f"/templates/{template['id']}/exercises",
            headers=auth_headers,
            json={
                "exercises": [
                    {"exercise_id": squat_id, "target_sets": 5},
                    {"exercise_id": bench_press_id, "target_sets": 4},
                ]
            },
        )

        ids = [e["exercise_id"] for e in response.json()["exercises"]]
        assert ids == [squat_id, bench_press_id]

    async def test_rejects_unknown_exercise_id(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        program = await _create_program(client, auth_headers, name="PPL")
        template = await _create_template(client, auth_headers, program["id"])

        response = await client.put(
            f"/templates/{template['id']}/exercises",
            headers=auth_headers,
            json={
                "exercises": [
                    {"exercise_id": "00000000-0000-0000-0000-000000000000", "target_sets": 4}
                ]
            },
        )

        assert response.status_code == 422, response.text

    async def test_reps_min_greater_than_max_is_422(
        self, client: AsyncClient, auth_headers: dict[str, str], bench_press_id: str
    ) -> None:
        program = await _create_program(client, auth_headers, name="PPL")
        template = await _create_template(client, auth_headers, program["id"])

        response = await client.put(
            f"/templates/{template['id']}/exercises",
            headers=auth_headers,
            json={
                "exercises": [
                    {
                        "exercise_id": bench_press_id,
                        "target_sets": 4,
                        "target_reps_min": 10,
                        "target_reps_max": 6,
                    }
                ]
            },
        )

        assert response.status_code == 422, response.text


class TestStartWorkoutFromTemplate:
    async def test_creates_a_linked_workout_with_no_sets(
        self, client: AsyncClient, auth_headers: dict[str, str], bench_press_id: str
    ) -> None:
        program = await _create_program(client, auth_headers, name="PPL")
        template = await _create_template(client, auth_headers, program["id"], name="Push A")
        await client.put(
            f"/templates/{template['id']}/exercises",
            headers=auth_headers,
            json={
                "exercises": [{"exercise_id": bench_press_id, "target_sets": 4, "target_rir": 2}]
            },
        )

        start = await client.post(f"/templates/{template['id']}/start", headers=auth_headers)
        assert start.status_code == 201, start.text
        assert start.json()["template_id"] == template["id"]
        assert start.json()["targets"][0]["target_sets"] == 4

        workout = await client.get(f"/workouts/{start.json()['workout_id']}", headers=auth_headers)
        assert workout.status_code == 200, workout.text
        assert workout.json()["template_id"] == template["id"]
        assert workout.json()["sets"] == []
        assert workout.json()["title"] == "Push A"

    async def test_other_users_template_cannot_be_started(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        other_auth_headers: dict[str, str],
    ) -> None:
        program = await _create_program(client, other_auth_headers, name="Theirs")
        template = await _create_template(client, other_auth_headers, program["id"])

        response = await client.post(f"/templates/{template['id']}/start", headers=auth_headers)

        assert response.status_code == 404, response.text

    async def test_free_logging_without_a_template_is_unaffected(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """The existing flow: POST /workouts with no template still works."""
        response = await client.post("/workouts", headers=auth_headers, json={"title": "Freestyle"})

        assert response.status_code == 201, response.text
        assert response.json()["template_id"] is None
