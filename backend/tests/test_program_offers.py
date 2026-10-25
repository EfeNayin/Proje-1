"""A coach sends a program; the athlete accepts it as their own independent copy.

Everything runs against the real test database. The tests that matter most are
about ownership and time: who may touch an offer, what the athlete receives
after the coach edits or deletes the original, and what happens to an offer
when the connection ends.
"""

import asyncio
from typing import Any
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domains.coaching import offers
from app.domains.coaching.ratelimit import invite_code_limiter
from app.models import Exercise, Program, ProgramOffer
from tests.test_coaching import Headers, _connect, _register


@pytest.fixture(autouse=True)
def _fresh_limiter() -> None:
    invite_code_limiter.reset()


@pytest.fixture
async def coach(client: AsyncClient, auth_headers: Headers) -> Headers:
    assert (await client.post("/coaching/enable", headers=auth_headers)).status_code == 200
    return auth_headers


@pytest.fixture
async def athlete(other_auth_headers: Headers) -> Headers:
    return other_auth_headers


@pytest.fixture
async def link(client: AsyncClient, coach: Headers, athlete: Headers) -> str:
    return await _connect(client, coach, athlete)


@pytest.fixture
async def exercise_ids(client: AsyncClient, coach: Headers) -> list[str]:
    response = await client.get("/exercises?limit=5", headers=coach)
    assert response.status_code == 200, response.text
    return [item["id"] for item in response.json()["items"]]


async def _program(
    client: AsyncClient,
    headers: Headers,
    exercises: list[str],
    name: str = "Upper Lower",
    notes: str | None = "Eight weeks, then reassess.",
) -> str:
    created = await client.post("/programs", headers=headers, json={"name": name, "notes": notes})
    assert created.status_code == 201, created.text
    program_id = str(created.json()["id"])
    days: list[dict[str, Any]] = [
        {
            "name": "Upper A",
            "day_order": 0,
            "notes": "Start with the press.",
            "exercises": [
                {
                    "exercise_id": exercises[0],
                    "target_sets": 4,
                    "target_reps_min": 6,
                    "target_reps_max": 8,
                    "target_rir": 0,
                    "notes": "Pause on the chest.",
                },
                {
                    "exercise_id": exercises[1],
                    "target_sets": 3,
                    "target_reps_min": 10,
                    "target_reps_max": 12,
                    "target_rpe": "8.5",
                },
            ],
        },
        {
            "name": "Lower A",
            "day_order": 1,
            "notes": None,
            "exercises": [{"exercise_id": exercises[2], "target_sets": 5, "target_reps_min": 5}],
        },
    ]
    for day in days:
        response = await client.post(
            f"/programs/{program_id}/templates/with-exercises", headers=headers, json=day
        )
        assert response.status_code == 201, response.text
    return program_id


async def _preview(client: AsyncClient, headers: Headers, link_id: str, program_id: str) -> Any:
    return await client.get(
        f"/coaching/athletes/{link_id}/program-preview/{program_id}", headers=headers
    )


async def _send(
    client: AsyncClient,
    headers: Headers,
    link_id: str,
    program_id: str,
    request_id: str | None = None,
    fingerprint: str | None = None,
) -> Any:
    """Send what the coach just previewed, unless a fingerprint is given explicitly."""
    if fingerprint is None:
        preview = await _preview(client, headers, link_id, program_id)
        fingerprint = preview.json()["fingerprint"] if preview.status_code == 200 else "0" * 64
    return await client.put(
        f"/coaching/athletes/{link_id}/program-offers/{request_id or uuid4()}",
        headers=headers,
        json={"program_id": program_id, "fingerprint": fingerprint},
    )


async def _offer(client: AsyncClient, coach: Headers, link_id: str, program_id: str) -> str:
    response = await _send(client, coach, link_id, program_id)
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def _accept(client: AsyncClient, headers: Headers, offer_id: str) -> Any:
    return await client.post(f"/coaching/program-offers/{offer_id}/accept", headers=headers)


async def _decline(client: AsyncClient, headers: Headers, offer_id: str) -> Any:
    return await client.post(f"/coaching/program-offers/{offer_id}/decline", headers=headers)


async def _programs(client: AsyncClient, headers: Headers) -> list[dict[str, Any]]:
    response = await client.get("/programs", headers=headers)
    assert response.status_code == 200, response.text
    return list(response.json())


def _shape(program: dict[str, Any]) -> dict[str, Any]:
    """What a program prescribes, without ids, so a copy can be compared to its source."""
    return {
        "name": program["name"],
        "notes": program["notes"],
        "templates": [
            {
                "name": template["name"],
                "day_order": template["day_order"],
                "notes": template["notes"],
                "exercises": [
                    {
                        key: row[key]
                        for key in (
                            "exercise_id",
                            "exercise_name",
                            "exercise_order",
                            "target_sets",
                            "target_reps_min",
                            "target_reps_max",
                            "target_rir",
                            "target_rpe",
                            "notes",
                        )
                    }
                    for row in template["exercises"]
                ],
            }
            for template in program["templates"]
        ],
    }


class TestAuthorisation:
    async def test_every_endpoint_needs_a_token(self, client: AsyncClient, link: str) -> None:
        some = uuid4()
        calls = [
            ("PUT", f"/coaching/athletes/{link}/program-offers/{some}"),
            ("GET", f"/coaching/athletes/{link}/program-offers"),
            ("GET", "/coaching/program-offers"),
            ("GET", f"/coaching/program-offers/{some}"),
            ("POST", f"/coaching/program-offers/{some}/accept"),
            ("POST", f"/coaching/program-offers/{some}/decline"),
        ]
        for method, path in calls:
            response = await client.request(method, path, json={"program_id": str(some)})
            assert response.status_code == 401, (method, path)

    async def test_the_coach_sends_only_a_program_they_own(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        theirs = await _program(client, athlete, exercise_ids, name="Athlete's own")

        response = await _send(client, coach, link, theirs)

        assert response.status_code == 404
        assert (await client.get("/coaching/program-offers", headers=athlete)).json()["total"] == 0

    async def test_an_unknown_program_is_not_found(
        self, client: AsyncClient, coach: Headers, link: str
    ) -> None:
        assert (await _send(client, coach, link, str(uuid4()))).status_code == 404

    async def test_only_the_coach_of_the_link_can_send(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        stranger = await _register(client, "stranger")
        await client.post("/coaching/enable", headers=stranger)
        mine = await _program(client, athlete, exercise_ids)
        theirs = await _program(client, stranger, exercise_ids, name="Stranger's")

        # Without coach tools the athlete is refused outright; with them, they still
        # are not the coach of this connection.
        assert (await _send(client, athlete, link, mine)).status_code == 403
        await client.post("/coaching/enable", headers=athlete)
        assert (await _send(client, athlete, link, mine)).status_code == 404
        assert (await _send(client, stranger, link, theirs)).status_code == 404

    async def test_another_coaches_connection_does_not_open_this_one(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        other_coach = await _register(client, "othercoach")
        await client.post("/coaching/enable", headers=other_coach)
        their_link = await _connect(client, other_coach, athlete)
        program = await _program(client, other_coach, exercise_ids, name="Theirs")

        # Their program through MY link, and my link id with their program, both fail.
        assert (await _send(client, other_coach, link, program)).status_code == 404
        assert (await _send(client, coach, their_link, program)).status_code == 404

    async def test_the_athlete_alone_sees_and_answers_an_offer(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        offer = await _offer(client, coach, link, await _program(client, coach, exercise_ids))
        third = await _register(client, "third")

        for headers in (coach, third):
            assert (await client.get("/coaching/program-offers", headers=headers)).json()[
                "items"
            ] == []
            assert (await client.get(f"/coaching/program-offers/{offer}", headers=headers)
                    ).status_code == 404
            assert (await _accept(client, headers, offer)).status_code == 404
            assert (await _decline(client, headers, offer)).status_code == 404
        assert (await client.get(f"/coaching/program-offers/{offer}", headers=athlete)
                ).status_code == 200

    async def test_an_athlete_cannot_use_the_coach_listing(
        self, client: AsyncClient, athlete: Headers, link: str
    ) -> None:
        url = f"/coaching/athletes/{link}/program-offers"
        assert (await client.get(url, headers=athlete)).status_code == 403
        await client.post("/coaching/enable", headers=athlete)
        assert (await client.get(url, headers=athlete)).status_code == 404

    async def test_coach_tools_must_be_on(
        self, client: AsyncClient, auth_headers: Headers
    ) -> None:
        response = await client.get(
            f"/coaching/athletes/{uuid4()}/program-offers", headers=auth_headers
        )
        assert response.status_code == 403

    async def test_the_coach_cannot_reach_the_athletes_programs(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        offer = await _offer(client, coach, link, await _program(client, coach, exercise_ids))
        copy = (await _accept(client, athlete, offer)).json()["program_id"]

        assert (await client.get(f"/programs/{copy}", headers=coach)).status_code == 404
        assert (await client.post(f"/programs/{copy}/activate", headers=coach)).status_code == 404
        assert (await client.delete(f"/programs/{copy}", headers=coach)).status_code == 404
        assert (await client.patch(f"/programs/{copy}", headers=coach, json={"name": "x"})
                ).status_code == 404
        listed = await client.get(f"/coaching/athletes/{link}/program-offers", headers=coach)
        assert "program_id" not in str(listed.json())
        assert copy not in str(listed.json())

    async def test_responses_carry_no_private_profile_data(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        await _offer(client, coach, link, await _program(client, coach, exercise_ids))

        received = (await client.get("/coaching/program-offers", headers=athlete)).json()
        item = received["items"][0]

        assert set(item) == {
            "id", "status", "program_name", "template_count", "exercise_count", "sent_at",
            "responded_at", "coach", "program_id",
        }
        assert set(item["coach"]) == {"username", "first_name", "last_name"}
        assert "example.com" not in str(received)

    async def test_bad_input_is_a_validation_error(
        self, client: AsyncClient, coach: Headers, link: str
    ) -> None:
        url = f"/coaching/athletes/{link}/program-offers/{uuid4()}"
        assert (await client.put(url, headers=coach, json={})).status_code == 422
        assert (await client.put(url, headers=coach, json={"program_id": "nope"})
                ).status_code == 422
        assert (await client.put(url, headers=coach, json={"program_id": str(uuid4())})
                ).status_code == 422  # a confirmation without a fingerprint is not accepted
        assert (await client.put(
            url, headers=coach, json={"program_id": str(uuid4()), "fingerprint": "abc"}
        )).status_code == 422
        bad = f"/coaching/athletes/{link}/program-offers/not-a-uuid"
        assert (await client.put(bad, headers=coach, json={"program_id": str(uuid4())})
                ).status_code == 422


class TestProgramReceiptIsIndependentOfWorkoutSharing:
    async def test_receiving_works_with_workout_sharing_off(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        sharing = (await client.get("/coaching/athletes", headers=coach)).json()["items"][0]
        assert sharing["shares_workouts"] is False
        blocked = await client.get(f"/coaching/athletes/{link}/workouts", headers=coach)
        assert blocked.status_code == 403

        offer = await _offer(client, coach, link, await _program(client, coach, exercise_ids))
        accepted = await _accept(client, athlete, offer)

        assert accepted.status_code == 200, accepted.text
        # Accepting did not switch workout sharing on.
        still = (await client.get("/coaching/athletes", headers=coach)).json()["items"][0]
        assert still["shares_workouts"] is False

    async def test_workout_sharing_does_not_grant_program_access(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str
    ) -> None:
        await client.put(
            f"/coaching/links/{link}/workout-sharing", headers=athlete, json={"enabled": True}
        )
        athletes_program = await client.post("/programs", headers=athlete, json={"name": "Mine"})

        assert (await client.get(f"/programs/{athletes_program.json()['id']}", headers=coach)
                ).status_code == 404


class TestSnapshot:
    async def test_the_athlete_sees_what_the_coach_confirmed_after_the_source_changes(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        source = await _program(client, coach, exercise_ids)
        offer = await _offer(client, coach, link, source)
        before = (await client.get(f"/coaching/program-offers/{offer}", headers=athlete)).json()

        detail = (await client.get(f"/programs/{source}", headers=coach)).json()
        await client.patch(
            f"/programs/{source}", headers=coach, json={"name": "Renamed", "notes": "x"}
        )
        await client.patch(
            f"/templates/{detail['templates'][0]['id']}", headers=coach, json={"name": "Edited"}
        )
        await client.put(
            f"/templates/{detail['templates'][0]['id']}/exercises", headers=coach,
            json={"exercises": [{"exercise_id": exercise_ids[3], "target_sets": 1}]},
        )
        await client.delete(f"/templates/{detail['templates'][1]['id']}", headers=coach)
        after = (await client.get(f"/coaching/program-offers/{offer}", headers=athlete)).json()

        assert after == before
        assert after["program_name"] == "Upper Lower"

    async def test_deleting_the_source_leaves_the_offer_and_its_acceptance_intact(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        source = await _program(client, coach, exercise_ids)
        original = _shape((await client.get(f"/programs/{source}", headers=coach)).json())
        offer = await _offer(client, coach, link, source)

        assert (await client.delete(f"/programs/{source}", headers=coach)).status_code == 204
        accepted = await _accept(client, athlete, offer)

        assert accepted.status_code == 200, accepted.text
        copy_id = accepted.json()["program_id"]
        copy = (await client.get(f"/programs/{copy_id}", headers=athlete)).json()
        assert _shape(copy) == original

    async def test_the_coach_sees_the_frozen_content_they_sent(
        self, client: AsyncClient, coach: Headers, link: str, exercise_ids: list[str]
    ) -> None:
        source = await _program(client, coach, exercise_ids)
        sent = await _send(client, coach, link, source)

        assert sent.status_code == 201
        body = sent.json()
        assert body["status"] == "pending"
        assert body["template_count"] == 2 and body["exercise_count"] == 3
        assert body["program"]["templates"][0]["exercises"][0]["exercise_name"]

    async def test_a_program_without_exercises_is_not_sent(
        self, client: AsyncClient, coach: Headers, link: str
    ) -> None:
        empty = (await client.post("/programs", headers=coach, json={"name": "Empty"})).json()["id"]
        await client.post(
            f"/programs/{empty}/templates", headers=coach, json={"name": "Day", "day_order": 0}
        )

        assert (await _send(client, coach, link, empty)).status_code == 422
        assert (await client.get(f"/coaching/athletes/{link}/program-offers", headers=coach)
                ).json()["total"] == 0


class TestAcceptance:
    async def test_the_copy_is_complete_owned_by_the_athlete_and_inactive(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        source = await _program(client, coach, exercise_ids)
        original = _shape((await client.get(f"/programs/{source}", headers=coach)).json())
        offer = await _offer(client, coach, link, source)

        accepted = await _accept(client, athlete, offer)

        assert accepted.status_code == 200, accepted.text
        body = accepted.json()
        assert body["status"] == "accepted" and body["responded_at"] is not None
        copy = (await client.get(f"/programs/{body['program_id']}", headers=athlete)).json()
        assert copy["is_active"] is False
        assert _shape(copy) == original
        # Prescriptions that are easy to lose: reps range, RIR 0, RPE, per-exercise notes, order.
        first = copy["templates"][0]["exercises"]
        assert [row["exercise_order"] for row in first] == [0, 1]
        assert first[0]["target_rir"] == 0 and first[0]["notes"] == "Pause on the chest."
        assert first[1]["target_rpe"] == "8.5" and first[1]["target_rir"] is None
        assert copy["templates"][1]["exercises"][0]["target_reps_max"] is None
        # The coach's original is untouched and is a different row.
        assert copy["id"] != source
        assert (await client.get(f"/programs/{source}", headers=coach)).json()["is_active"] is True

    async def test_the_athletes_active_program_stays_active(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        current = (await client.post("/programs", headers=athlete, json={"name": "Current"})).json()
        offer = await _offer(client, coach, link, await _program(client, coach, exercise_ids))

        copy = (await _accept(client, athlete, offer)).json()["program_id"]

        by_id = {row["id"]: row for row in await _programs(client, athlete)}
        assert by_id[current["id"]]["is_active"] is True
        assert by_id[copy]["is_active"] is False
        assert len(by_id) == 2

    async def test_the_copy_activates_and_starts_a_workout_through_the_existing_flow(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        current = (await client.post("/programs", headers=athlete, json={"name": "Current"})).json()
        offer = await _offer(client, coach, link, await _program(client, coach, exercise_ids))
        copy = (await _accept(client, athlete, offer)).json()["program_id"]

        activated = await client.post(f"/programs/{copy}/activate", headers=athlete)
        assert activated.status_code == 200 and activated.json()["is_active"] is True
        by_id = {row["id"]: row for row in await _programs(client, athlete)}
        assert by_id[current["id"]]["is_active"] is False
        template = activated.json()["templates"][0]
        started = await client.post(f"/templates/{template['id']}/start", headers=athlete)
        assert started.status_code == 201, started.text
        assert len(started.json()["targets"]) == 2

    async def test_the_copy_is_independent_of_the_offer_and_the_coach(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        source = await _program(client, coach, exercise_ids)
        offer = await _offer(client, coach, link, source)
        copy = (await _accept(client, athlete, offer)).json()["program_id"]
        detail = (await client.get(f"/programs/{copy}", headers=athlete)).json()

        edited = await client.patch(f"/programs/{copy}", headers=athlete, json={"name": "My take"})
        await client.put(
            f"/templates/{detail['templates'][0]['id']}/exercises", headers=athlete,
            json={"exercises": [{"exercise_id": exercise_ids[4], "target_sets": 2}]},
        )
        await client.patch(f"/programs/{source}", headers=coach, json={"name": "Coach v2"})

        assert edited.status_code == 200
        again = (await client.get(f"/coaching/program-offers/{offer}", headers=athlete)).json()
        assert again["program_name"] == "Upper Lower"
        assert (await client.get(f"/programs/{copy}", headers=athlete)).json()["name"] == "My take"
        assert (await client.get(f"/programs/{source}", headers=coach)).json()["name"] == "Coach v2"

    async def test_accepting_twice_returns_the_same_program(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        offer = await _offer(client, coach, link, await _program(client, coach, exercise_ids))

        first = await _accept(client, athlete, offer)
        second = await _accept(client, athlete, offer)

        assert first.status_code == second.status_code == 200
        assert first.json()["program_id"] == second.json()["program_id"]
        assert len(await _programs(client, athlete)) == 1

    async def test_concurrent_accepts_create_one_copy(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        offer = await _offer(client, coach, link, await _program(client, coach, exercise_ids))

        results = await asyncio.gather(*[_accept(client, athlete, offer) for _ in range(6)])

        assert {r.status_code for r in results} == {200}
        assert len({r.json()["program_id"] for r in results}) == 1
        assert len(await _programs(client, athlete)) == 1

    async def test_deleting_the_copy_does_not_let_a_retry_create_another(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        offer = await _offer(client, coach, link, await _program(client, coach, exercise_ids))
        copy = (await _accept(client, athlete, offer)).json()["program_id"]
        await client.delete(f"/programs/{copy}", headers=athlete)

        again = await _accept(client, athlete, offer)

        assert again.status_code == 200
        assert again.json()["status"] == "accepted" and again.json()["program_id"] is None
        assert await _programs(client, athlete) == []

    async def test_accepting_adds_next_to_a_same_named_program(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        mine = (
            await client.post("/programs", headers=athlete, json={"name": "Upper Lower"})
        ).json()
        offer = await _offer(client, coach, link, await _program(client, coach, exercise_ids))

        copy = (await _accept(client, athlete, offer)).json()["program_id"]

        names = {row["id"]: row["name"] for row in await _programs(client, athlete)}
        assert names == {mine["id"]: "Upper Lower", copy: "Upper Lower"}
        own = await client.get(f"/programs/{mine['id']}", headers=athlete)
        assert own.json()["templates"] == []


class TestInvalidExercises:
    async def _vanishing_offer(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, link: str,
        exercise_ids: list[str],
    ) -> tuple[str, str]:
        """An offer whose last exercise is later removed from the catalogue."""
        gone = Exercise(name="Temporary press")
        db.add(gone)
        await db.commit()
        source = await _program(client, coach, exercise_ids)
        template = (await client.get(f"/programs/{source}", headers=coach)).json()["templates"][0]
        await client.put(
            f"/templates/{template['id']}/exercises", headers=coach,
            json={"exercises": [
                {"exercise_id": exercise_ids[0], "target_sets": 3},
                {"exercise_id": str(gone.id), "target_sets": 3},
            ]},
        )
        offer = await _offer(client, coach, link, source)
        # Take it out of the coach's program first (the foreign key refuses otherwise).
        await client.put(
            f"/templates/{template['id']}/exercises", headers=coach,
            json={"exercises": [{"exercise_id": exercise_ids[0], "target_sets": 3}]},
        )
        await db.execute(text("DELETE FROM exercises WHERE id = :id"), {"id": gone.id})
        await db.commit()
        return offer, str(gone.id)

    async def test_an_unavailable_exercise_creates_nothing(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, athlete: Headers,
        link: str, exercise_ids: list[str],
    ) -> None:
        offer, _ = await self._vanishing_offer(client, db, coach, link, exercise_ids)

        response = await _accept(client, athlete, offer)

        assert response.status_code == 409
        assert "Temporary press" in response.json()["detail"]
        assert await _programs(client, athlete) == []
        still = (await client.get(f"/coaching/program-offers/{offer}", headers=athlete)).json()
        assert still["status"] == "pending" and still["program_id"] is None
        assert (await _decline(client, athlete, offer)).status_code == 200

    async def test_a_failure_part_way_through_rolls_back_everything(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, athlete: Headers,
        link: str, exercise_ids: list[str], monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        offer = await _offer(client, coach, link, await _program(client, coach, exercise_ids))
        real = offers._copy_template
        calls = 0

        def explode_on_second(db_: AsyncSession, program: Program, template: Any) -> Any:
            nonlocal calls
            calls += 1
            if calls == 2:
                raise RuntimeError("disk full")
            return real(db_, program, template)

        monkeypatch.setattr(offers, "_copy_template", explode_on_second)
        with pytest.raises(RuntimeError):
            await _accept(client, athlete, offer)
        monkeypatch.undo()

        assert await db.scalar(select(func.count()).select_from(Program)
                               .where(Program.name == "Upper Lower",
                                      Program.is_active.is_(False))) == 0
        assert await _programs(client, athlete) == []
        again = await _accept(client, athlete, offer)
        assert again.status_code == 200 and len(await _programs(client, athlete)) == 1

    async def test_a_coach_cannot_send_an_exercise_the_athlete_cannot_use(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        me = (await client.get("/users/me", headers=coach)).json()["id"]
        custom = Exercise(name="Coach-only lift", created_by=me)
        db.add(custom)
        await db.commit()
        source = (await client.post("/programs", headers=coach, json={"name": "P"})).json()["id"]
        await client.post(
            f"/programs/{source}/templates/with-exercises", headers=coach,
            json={"name": "D", "exercises": [{"exercise_id": str(custom.id), "target_sets": 3}]},
        )

        response = await _send(client, coach, link, source)

        assert response.status_code == 422
        assert "Coach-only lift" in response.json()["detail"]


class TestRetriesAndDuplicates:
    async def test_repeating_a_send_returns_the_same_offer(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        source = await _program(client, coach, exercise_ids)
        request_id = str(uuid4())
        fingerprint = (await _preview(client, coach, link, source)).json()["fingerprint"]

        first = await _send(client, coach, link, source, request_id, fingerprint)
        # A lost response, a retry — even after the source is gone.
        await client.delete(f"/programs/{source}", headers=coach)
        second = await _send(client, coach, link, source, request_id, fingerprint)

        assert first.status_code == 201 and second.status_code == 200
        assert first.json() == second.json()
        assert (await client.get("/coaching/program-offers", headers=athlete)).json()["total"] == 1

    async def test_concurrent_identical_sends_make_one_offer(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        source = await _program(client, coach, exercise_ids)
        request_id = str(uuid4())
        fingerprint = (await _preview(client, coach, link, source)).json()["fingerprint"]

        results = await asyncio.gather(
            *[_send(client, coach, link, source, request_id, fingerprint) for _ in range(5)]
        )

        assert sorted(r.status_code for r in results) == [200, 200, 200, 200, 201]
        assert len({r.json()["id"] for r in results}) == 1
        assert (await client.get("/coaching/program-offers", headers=athlete)).json()["total"] == 1

    async def test_a_request_id_cannot_be_reused_for_another_program(
        self, client: AsyncClient, coach: Headers, link: str, exercise_ids: list[str]
    ) -> None:
        one = await _program(client, coach, exercise_ids, name="One")
        two = await _program(client, coach, exercise_ids, name="Two")
        request_id = str(uuid4())
        await _send(client, coach, link, one, request_id)

        assert (await _send(client, coach, link, two, request_id)).status_code == 409

    async def test_a_second_pending_offer_of_the_same_program_is_refused(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        source = await _program(client, coach, exercise_ids)
        offer = await _offer(client, coach, link, source)

        assert (await _send(client, coach, link, source)).status_code == 409
        # Once answered, the coach may send it again.
        await _decline(client, athlete, offer)
        assert (await _send(client, coach, link, source)).status_code == 201

    async def test_two_different_programs_can_wait_together(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        await _offer(client, coach, link, await _program(client, coach, exercise_ids, name="A"))
        await _offer(client, coach, link, await _program(client, coach, exercise_ids, name="B"))

        listed = (await client.get("/coaching/program-offers", headers=athlete)).json()
        assert [row["program_name"] for row in listed["items"]] == ["B", "A"]

    async def test_declining_twice_is_harmless(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        offer = await _offer(client, coach, link, await _program(client, coach, exercise_ids))

        assert (await _decline(client, athlete, offer)).json()["status"] == "declined"
        assert (await _decline(client, athlete, offer)).status_code == 200


class TestDeclining:
    async def test_declined_offers_create_nothing_and_cannot_be_accepted(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        offer = await _offer(client, coach, link, await _program(client, coach, exercise_ids))

        declined = await _decline(client, athlete, offer)

        assert declined.status_code == 200 and declined.json()["status"] == "declined"
        assert (await _accept(client, athlete, offer)).status_code == 409
        assert await _programs(client, athlete) == []
        sent = (await client.get(f"/coaching/athletes/{link}/program-offers", headers=coach)).json()
        assert [row["status"] for row in sent["items"]] == ["declined"]

    async def test_an_accepted_offer_cannot_be_declined(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        offer = await _offer(client, coach, link, await _program(client, coach, exercise_ids))
        await _accept(client, athlete, offer)

        assert (await _decline(client, athlete, offer)).status_code == 409
        assert len(await _programs(client, athlete)) == 1


class TestConnectionLifecycle:
    async def test_ending_the_connection_makes_a_pending_offer_unavailable(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        offer = await _offer(client, coach, link, await _program(client, coach, exercise_ids))

        assert (await client.delete(f"/coaching/links/{link}", headers=athlete)).status_code == 204

        assert (await client.get(f"/coaching/program-offers/{offer}", headers=athlete)
                ).status_code == 404
        assert (await _accept(client, athlete, offer)).status_code == 404
        assert (await _decline(client, athlete, offer)).status_code == 404
        assert (await client.get("/coaching/program-offers", headers=athlete)).json()["items"] == []
        assert await _programs(client, athlete) == []
        assert (await client.get(f"/coaching/athletes/{link}/program-offers", headers=coach)
                ).status_code == 404

    async def test_the_coach_ending_it_does_the_same(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        source = await _program(client, coach, exercise_ids)
        offer = await _offer(client, coach, link, source)

        await client.delete(f"/coaching/links/{link}", headers=coach)

        assert (await _accept(client, athlete, offer)).status_code == 404
        assert (await _send(client, coach, link, source)).status_code == 404

    async def test_reconnecting_does_not_revive_old_offers(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        source = await _program(client, coach, exercise_ids)
        old_offer = await _offer(client, coach, link, source)
        await client.delete(f"/coaching/links/{link}", headers=athlete)

        new_link = await _connect(client, coach, athlete)

        assert new_link != link
        assert (await client.get("/coaching/program-offers", headers=athlete)).json()["items"] == []
        assert (await _accept(client, athlete, old_offer)).status_code == 404
        assert (await client.get(f"/coaching/athletes/{new_link}/program-offers", headers=coach)
                ).json()["items"] == []
        # The same program can be offered again on the new connection.
        assert (await _send(client, coach, new_link, source)).status_code == 201

    async def test_an_accepted_program_survives_disconnection_and_source_deletion(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        source = await _program(client, coach, exercise_ids)
        original = _shape((await client.get(f"/programs/{source}", headers=coach)).json())
        copy = (await _accept(client, athlete, await _offer(client, coach, link, source))
                ).json()["program_id"]

        await client.delete(f"/coaching/links/{link}", headers=coach)
        await client.delete(f"/programs/{source}", headers=coach)

        kept = await client.get(f"/programs/{copy}", headers=athlete)
        assert kept.status_code == 200 and _shape(kept.json()) == original
        assert (await client.post(f"/programs/{copy}/activate", headers=athlete)).status_code == 200

    async def test_a_stale_accept_cannot_outlive_the_connection(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        # Whichever of the two wins, accepting never succeeds after the end, and a
        # refused accept never leaves a program behind.
        for attempt in range(4):
            source = await _program(client, coach, exercise_ids, name=f"Race {attempt}")
            offer = await _offer(client, coach, link, source)
            ended, accepted = await asyncio.gather(
                client.delete(f"/coaching/links/{link}", headers=athlete),
                _accept(client, athlete, offer),
            )
            assert ended.status_code == 204
            programs = await _programs(client, athlete)
            if accepted.status_code == 200:
                assert len([p for p in programs if p["name"] == f"Race {attempt}"]) == 1
            else:
                assert accepted.status_code == 404
                assert [p for p in programs if p["name"] == f"Race {attempt}"] == []
            assert (await _accept(client, athlete, offer)).status_code == 404
            link = await _connect(client, coach, athlete)

    async def test_a_connection_ended_between_the_read_and_the_lock_is_still_refused(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, athlete: Headers,
        link: str, exercise_ids: list[str], monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        offer = await _offer(client, coach, link, await _program(client, coach, exercise_ids))
        real = offers._offer_of_athlete

        async def ended_right_after_the_read(
            session: AsyncSession, user: Any, offer_id: Any
        ) -> Any:
            found = await real(session, user, offer_id)
            # Another request ends the connection after this one looked, before it locks.
            await db.execute(
                text("UPDATE coach_athlete_links SET ended_at = now() WHERE id = :id"),
                {"id": link},
            )
            await db.commit()
            return found

        monkeypatch.setattr(offers, "_offer_of_athlete", ended_right_after_the_read)

        response = await _accept(client, athlete, offer)

        assert response.status_code == 404
        monkeypatch.undo()
        assert await _programs(client, athlete) == []
        status = await db.scalar(select(ProgramOffer.status).where(ProgramOffer.id == offer))
        assert status == "pending"

    async def test_the_offer_row_goes_with_its_connection_but_the_copy_stays(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, athlete: Headers,
        link: str, exercise_ids: list[str],
    ) -> None:
        offer = await _offer(client, coach, link, await _program(client, coach, exercise_ids))
        copy = (await _accept(client, athlete, offer)).json()["program_id"]

        # A coach account deleted outright cascades links and offers, not the athlete's copy.
        await db.execute(text("DELETE FROM users WHERE username = 'efe'"))
        await db.commit()

        assert await db.scalar(select(func.count()).select_from(ProgramOffer)) == 0
        assert (await client.get(f"/programs/{copy}", headers=athlete)).status_code == 200


class TestListing:
    async def test_received_offers_page_with_waiting_ones_first(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        ids = []
        for name in ("One", "Two", "Three"):
            program = await _program(client, coach, exercise_ids, name=name)
            ids.append(await _offer(client, coach, link, program))
        await _decline(client, athlete, ids[2])

        first = (await client.get("/coaching/program-offers?limit=2", headers=athlete)).json()
        second = (
            await client.get("/coaching/program-offers?limit=2&offset=2", headers=athlete)
        ).json()

        assert first["total"] == 3
        assert [r["program_name"] for r in first["items"]] == ["Two", "One"]
        assert [r["program_name"] for r in second["items"]] == ["Three"]
        assert (await client.get("/coaching/program-offers?limit=0", headers=athlete)
                ).status_code == 422

    async def test_the_coach_sees_status_but_not_the_athletes_copy(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        offer = await _offer(client, coach, link, await _program(client, coach, exercise_ids))
        await _accept(client, athlete, offer)

        sent = (await client.get(f"/coaching/athletes/{link}/program-offers", headers=coach)).json()

        assert sent["total"] == 1
        assert set(sent["items"][0]) == {
            "id", "status", "program_name", "template_count", "exercise_count", "sent_at",
            "responded_at",
        }
        assert sent["items"][0]["status"] == "accepted"


class TestExistingFlowsStillWork:
    async def test_the_athlete_can_still_manage_programs_and_log_workouts(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        offer = await _offer(client, coach, link, await _program(client, coach, exercise_ids))
        await _accept(client, athlete, offer)

        created = await client.post("/programs", headers=athlete, json={"name": "Own"})
        workout = await client.post("/workouts", headers=athlete, json={"title": "Push"})

        assert created.status_code == 201 and created.json()["is_active"] is True
        assert workout.status_code == 201
        assert len(await _programs(client, athlete)) == 2
        assert sum(p["is_active"] for p in await _programs(client, athlete)) == 1

    async def test_the_coach_keeps_their_own_programs_when_offers_are_answered(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        source = await _program(client, coach, exercise_ids)
        offer = await _offer(client, coach, link, source)
        await _accept(client, athlete, offer)

        programs = await _programs(client, coach)

        assert [p["id"] for p in programs] == [source]
        assert (await client.delete(f"/programs/{source}", headers=coach)).status_code == 204


async def _edit_with(client: AsyncClient, coach: Headers, source: str, how: str,
                     exercise_ids: list[str]) -> None:
    """One kind of change a coach could make from another device after previewing."""
    detail = (await client.get(f"/programs/{source}", headers=coach)).json()
    first, second = detail["templates"][0], detail["templates"][1]
    if how == "program name":
        response = await client.patch(f"/programs/{source}", headers=coach, json={"name": "New"})
    elif how == "program note":
        response = await client.patch(f"/programs/{source}", headers=coach, json={"notes": "x"})
    elif how == "day name":
        response = await client.patch(
            f"/templates/{first['id']}", headers=coach, json={"name": "X"}
        )
    elif how == "day note":
        response = await client.patch(
            f"/templates/{first['id']}", headers=coach, json={"notes": "Changed note"}
        )
    elif how == "day order":
        response = await client.patch(
            f"/templates/{first['id']}", headers=coach, json={"day_order": 5}
        )
    elif how == "prescription":
        rows = [
            {"exercise_id": r["exercise_id"], "target_sets": r["target_sets"] + 1,
             "target_reps_min": r["target_reps_min"], "target_reps_max": r["target_reps_max"],
             "target_rir": r["target_rir"], "notes": r["notes"]}
            for r in first["exercises"]
        ]
        response = await client.put(
            f"/templates/{first['id']}/exercises", headers=coach, json={"exercises": rows}
        )
    elif how == "exercise order":
        rows = [
            {"exercise_id": r["exercise_id"], "target_sets": r["target_sets"],
             "target_reps_min": r["target_reps_min"], "target_reps_max": r["target_reps_max"],
             "target_rir": r["target_rir"], "notes": r["notes"]}
            for r in reversed(first["exercises"])
        ]
        response = await client.put(
            f"/templates/{first['id']}/exercises", headers=coach, json={"exercises": rows}
        )
    elif how == "exercise note":
        rows = [
            {"exercise_id": r["exercise_id"], "target_sets": r["target_sets"],
             "target_reps_min": r["target_reps_min"], "target_reps_max": r["target_reps_max"],
             "target_rir": r["target_rir"], "notes": "A different cue"}
            for r in first["exercises"]
        ]
        response = await client.put(
            f"/templates/{first['id']}/exercises", headers=coach, json={"exercises": rows}
        )
    elif how == "swap exercise":
        response = await client.put(
            f"/templates/{first['id']}/exercises", headers=coach,
            json={"exercises": [{"exercise_id": exercise_ids[4], "target_sets": 3}]},
        )
    elif how == "delete day":
        response = await client.delete(f"/templates/{second['id']}", headers=coach)
    elif how == "add day":
        response = await client.post(
            f"/programs/{source}/templates/with-exercises", headers=coach,
            json={"name": "Extra", "day_order": 9,
                  "exercises": [{"exercise_id": exercise_ids[3], "target_sets": 2}]},
        )
    else:  # pragma: no cover
        raise AssertionError(how)
    assert response.status_code in (200, 201, 204), response.text


CHANGES = [
    "program name", "program note", "day name", "day note", "day order", "prescription",
    "exercise order", "exercise note", "swap exercise", "delete day", "add day",
]


class TestPreview:
    async def test_the_preview_is_exactly_what_would_be_offered_notes_included(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        source = await _program(client, coach, exercise_ids)

        preview = (await _preview(client, coach, link, source)).json()
        offer = await _offer(client, coach, link, source)
        received = (await client.get(f"/coaching/program-offers/{offer}", headers=athlete)).json()

        assert received["program"] == preview["program"]
        assert preview["program"]["notes"] == "Eight weeks, then reassess."
        assert preview["program"]["templates"][0]["notes"] == "Start with the press."
        assert preview["program"]["templates"][0]["exercises"][0]["notes"] == "Pause on the chest."
        assert set(preview) == {"program", "fingerprint"}

    async def test_the_fingerprint_is_stable_until_something_changes(
        self, client: AsyncClient, coach: Headers, link: str, exercise_ids: list[str]
    ) -> None:
        source = await _program(client, coach, exercise_ids)

        first = (await _preview(client, coach, link, source)).json()["fingerprint"]
        again = (await _preview(client, coach, link, source)).json()["fingerprint"]
        await client.patch(f"/programs/{source}", headers=coach, json={"name": "Other"})
        changed = (await _preview(client, coach, link, source)).json()["fingerprint"]

        assert first == again and first != changed

    async def test_only_the_owning_coach_of_an_active_link_can_preview(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        source = await _program(client, coach, exercise_ids)
        stranger = await _register(client, "stranger")
        await client.post("/coaching/enable", headers=stranger)
        url = f"/coaching/athletes/{link}/program-preview/{source}"

        assert (await client.get(url)).status_code == 401
        assert (await client.get(url, headers=athlete)).status_code == 403  # no coach tools
        assert (await client.get(url, headers=stranger)).status_code == 404
        mine = await _program(client, athlete, exercise_ids, name="Athlete's")
        assert (await _preview(client, coach, link, mine)).status_code == 404  # not the coach's
        assert (await _preview(client, coach, link, str(uuid4()))).status_code == 404
        await client.delete(f"/coaching/links/{link}", headers=athlete)
        assert (await client.get(url, headers=coach)).status_code == 404

    async def test_previewing_creates_nothing_and_needs_no_workout_sharing(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        source = await _program(client, coach, exercise_ids)

        assert (await _preview(client, coach, link, source)).status_code == 200
        assert await db.scalar(select(func.count()).select_from(ProgramOffer)) == 0


class TestStalePreview:
    @pytest.mark.parametrize("how", CHANGES)
    async def test_a_change_after_the_preview_is_refused_and_nothing_is_sent(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str], how: str,
    ) -> None:
        source = await _program(client, coach, exercise_ids)
        shown = (await _preview(client, coach, link, source)).json()["fingerprint"]

        await _edit_with(client, coach, source, how, exercise_ids)
        response = await _send(client, coach, link, source, fingerprint=shown)

        assert response.status_code == 412, how
        assert "reviewed" in response.json()["detail"]
        listed = await client.get("/coaching/program-offers", headers=athlete)
        assert listed.json()["total"] == 0
        sent = await client.get(f"/coaching/athletes/{link}/program-offers", headers=coach)
        assert sent.json()["total"] == 0

    async def test_refreshing_the_preview_and_confirming_again_sends_the_new_version(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        source = await _program(client, coach, exercise_ids)
        old = (await _preview(client, coach, link, source)).json()
        await client.patch(f"/programs/{source}", headers=coach, json={"name": "Version two"})
        stale_id = str(uuid4())
        assert (
            await _send(client, coach, link, source, stale_id, old["fingerprint"])
        ).status_code == 412

        fresh = (await _preview(client, coach, link, source)).json()
        assert fresh["program"]["name"] == "Version two"
        sent = await _send(client, coach, link, source, str(uuid4()), fresh["fingerprint"])

        assert sent.status_code == 201
        assert sent.json()["program"] == fresh["program"]
        received = (await client.get("/coaching/program-offers", headers=athlete)).json()
        assert [row["program_name"] for row in received["items"]] == ["Version two"]

    async def test_the_old_confirmation_stays_refused_even_with_a_new_request_id(
        self, client: AsyncClient, coach: Headers, link: str, exercise_ids: list[str]
    ) -> None:
        source = await _program(client, coach, exercise_ids)
        old = (await _preview(client, coach, link, source)).json()["fingerprint"]
        await client.patch(f"/programs/{source}", headers=coach, json={"name": "Version two"})

        for _ in range(2):
            assert (
                await _send(client, coach, link, source, str(uuid4()), old)
            ).status_code == 412

    async def test_a_successful_send_can_be_retried_after_the_source_changed(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        source = await _program(client, coach, exercise_ids)
        shown = (await _preview(client, coach, link, source)).json()
        request_id = str(uuid4())
        first = await _send(client, coach, link, source, request_id, shown["fingerprint"])
        await client.patch(f"/programs/{source}", headers=coach, json={"name": "Version two"})

        retry = await _send(client, coach, link, source, request_id, shown["fingerprint"])

        assert first.status_code == 201 and retry.status_code == 200
        assert retry.json() == first.json()
        assert retry.json()["program"]["name"] == "Upper Lower"
        assert (await client.get("/coaching/program-offers", headers=athlete)).json()["total"] == 1

    async def test_a_new_confirmation_never_replays_an_earlier_offer(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        source = await _program(client, coach, exercise_ids)
        v1 = (await _preview(client, coach, link, source)).json()["fingerprint"]
        request_id = str(uuid4())
        first = await _send(client, coach, link, source, request_id, v1)
        await _decline(client, athlete, first.json()["id"])
        await client.patch(f"/programs/{source}", headers=coach, json={"name": "Version two"})
        v2 = (await _preview(client, coach, link, source)).json()["fingerprint"]

        # Reusing the earlier operation for the new content is refused, not replayed.
        assert (await _send(client, coach, link, source, request_id, v2)).status_code == 409
        second = await _send(client, coach, link, source, str(uuid4()), v2)

        assert second.status_code == 201
        assert second.json()["id"] != first.json()["id"]
        assert second.json()["program"]["name"] == "Version two"

    async def test_a_source_deleted_after_the_preview_cannot_be_sent(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        source = await _program(client, coach, exercise_ids)
        shown = (await _preview(client, coach, link, source)).json()["fingerprint"]
        await client.delete(f"/programs/{source}", headers=coach)

        response = await _send(client, coach, link, source, fingerprint=shown)

        assert response.status_code == 404
        assert (await client.get("/coaching/program-offers", headers=athlete)).json()["total"] == 0

    async def test_a_connection_ended_after_the_preview_cannot_be_sent_on(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        source = await _program(client, coach, exercise_ids)
        shown = (await _preview(client, coach, link, source)).json()["fingerprint"]
        await client.delete(f"/coaching/links/{link}", headers=athlete)

        response = await _send(client, coach, link, source, fingerprint=shown)

        assert response.status_code == 404
        # The same confirmation does not carry over to a new connection either.
        new_link = await _connect(client, coach, athlete)
        assert (await _send(client, coach, new_link, source, fingerprint=shown)
                ).status_code == 412
        assert (await client.get("/coaching/program-offers", headers=athlete)).json()["total"] == 0

    async def test_a_confirmation_cannot_be_used_for_another_program(
        self, client: AsyncClient, coach: Headers, link: str, exercise_ids: list[str]
    ) -> None:
        one = await _program(client, coach, exercise_ids, name="One")
        two = await _program(client, coach, exercise_ids, name="One")  # identical content
        shown = (await _preview(client, coach, link, one)).json()["fingerprint"]

        assert (await _send(client, coach, link, two, fingerprint=shown)).status_code == 412

    async def test_a_client_cannot_make_the_server_send_content_it_did_not_build(
        self, client: AsyncClient, coach: Headers, link: str, exercise_ids: list[str]
    ) -> None:
        source = await _program(client, coach, exercise_ids)
        shown = (await _preview(client, coach, link, source)).json()["fingerprint"]

        response = await client.put(
            f"/coaching/athletes/{link}/program-offers/{uuid4()}",
            headers=coach,
            json={
                "program_id": source,
                "fingerprint": shown,
                "program": {"name": "Forged", "notes": None, "templates": []},
            },
        )

        assert response.status_code == 201
        assert response.json()["program"]["name"] == "Upper Lower"

    async def test_a_send_waits_for_an_edit_in_progress_and_then_refuses_it(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        source = await _program(client, coach, exercise_ids)
        shown = (await _preview(client, coach, link, source)).json()["fingerprint"]
        template = (await client.get(f"/programs/{source}", headers=coach)).json()["templates"][0]

        # Another device is part-way through editing a day (the edit has not committed).
        await db.execute(
            text("UPDATE workout_templates SET notes = 'edited mid-send' WHERE id = :id"),
            {"id": template["id"]},
        )
        sending = asyncio.create_task(_send(client, coach, link, source, fingerprint=shown))
        await asyncio.sleep(0.5)
        assert not sending.done(), "the send must wait for the edit instead of reading around it"
        await db.commit()

        response = await sending
        assert response.status_code == 412
        assert await db.scalar(select(func.count()).select_from(ProgramOffer)) == 0

    async def test_a_send_waits_for_a_rename_or_delete_in_progress(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        source = await _program(client, coach, exercise_ids)
        shown = (await _preview(client, coach, link, source)).json()["fingerprint"]

        await db.execute(
            text("UPDATE programs SET name = 'renamed mid-send' WHERE id = :id"), {"id": source}
        )
        renaming = asyncio.create_task(_send(client, coach, link, source, fingerprint=shown))
        await asyncio.sleep(0.5)
        assert not renaming.done()
        await db.commit()
        assert (await renaming).status_code == 412

        shown = (await _preview(client, coach, link, source)).json()["fingerprint"]
        await db.execute(text("DELETE FROM programs WHERE id = :id"), {"id": source})
        deleting = asyncio.create_task(_send(client, coach, link, source, fingerprint=shown))
        await asyncio.sleep(0.5)
        assert not deleting.done()
        await db.commit()
        assert (await deleting).status_code == 404
        assert await db.scalar(select(func.count()).select_from(ProgramOffer)) == 0

    async def test_an_edit_started_during_a_send_waits_until_it_is_finished(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, athlete: Headers,
        link: str, exercise_ids: list[str],
    ) -> None:
        source = await _program(client, coach, exercise_ids)
        shown = (await _preview(client, coach, link, source)).json()["fingerprint"]
        # Rename and send together: whichever comes first, the offer holds a version that
        # was previewed or the send is refused. It is never a blend of the two.
        results = await asyncio.gather(
            client.patch(f"/programs/{source}", headers=coach, json={"name": "Renamed"}),
            _send(client, coach, link, source, fingerprint=shown),
        )

        renamed, sent = results
        assert renamed.status_code == 200
        assert sent.status_code in (201, 412)
        if sent.status_code == 201:
            assert sent.json()["program"]["name"] == "Upper Lower"
        received = (await client.get("/coaching/program-offers", headers=athlete)).json()
        assert received["total"] == (1 if sent.status_code == 201 else 0)

    async def test_nothing_to_send_is_still_refused_with_a_valid_confirmation(
        self, client: AsyncClient, coach: Headers, link: str
    ) -> None:
        empty = (await client.post("/programs", headers=coach, json={"name": "Empty"})).json()["id"]
        await client.post(
            f"/programs/{empty}/templates", headers=coach, json={"name": "Day", "day_order": 0}
        )

        assert (await _send(client, coach, link, empty)).status_code == 422
