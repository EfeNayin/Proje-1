"""A coach prepares a program for one athlete and publishes it in numbered versions.

Run through the real app against the real test database. The tests that matter
most are about ownership (whose program, whose copy), what accepting does to the
athlete's active program, what survives the end of a connection, and races
that would leave two versions waiting, two programs active or a copy half made.
"""

import asyncio
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Exercise, Program, ProgramLineage, ProgramOffer
from tests.test_coaching import Headers, _connect, _register
from tests.test_program_offers import _accept, _decline, _program, _programs, _shape


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
    response = await client.get("/exercises?limit=6", headers=coach)
    assert response.status_code == 200, response.text
    return [item["id"] for item in response.json()["items"]]


# ── helpers ──────────────────────────────────────────────────────────────

_BASE = "/coaching/athletes"


async def _prepare(
    client: AsyncClient,
    coach: Headers,
    link: str,
    *,
    name: str | None = "Block A",
    from_program: str | None = None,
    request_id: str | None = None,
) -> Response:
    body: dict[str, Any] = {}
    if name is not None:
        body["name"] = name
    if from_program is not None:
        body["from_program_id"] = from_program
    return await client.put(
        f"{_BASE}/{link}/program-lineages/{request_id or uuid4()}", headers=coach, json=body
    )


async def _new(client: AsyncClient, coach: Headers, link: str, **kwargs: Any) -> dict[str, Any]:
    response = await _prepare(client, coach, link, **kwargs)
    assert response.status_code == 201, response.text
    return dict(response.json())


async def _add_day(
    client: AsyncClient,
    coach: Headers,
    draft_id: str,
    exercise_ids: list[str],
    *,
    name: str = "Day 1",
    day_order: int = 0,
    sets: int = 3,
    notes: str | None = "Smooth reps.",
) -> dict[str, Any]:
    response = await client.post(
        f"/programs/{draft_id}/templates/with-exercises",
        headers=coach,
        json={
            "name": name,
            "day_order": day_order,
            "notes": notes,
            "exercises": [
                {"exercise_id": exercise_ids[0], "target_sets": sets, "target_reps_min": 8,
                 "target_reps_max": 10, "notes": "Controlled."},
                {"exercise_id": exercise_ids[1], "target_sets": 2, "target_reps_min": 12},
            ],
        },
    )
    assert response.status_code == 201, response.text
    return dict(response.json())


async def _ready(
    client: AsyncClient, coach: Headers, link: str, exercise_ids: list[str], **kwargs: Any
) -> dict[str, Any]:
    """A preparation whose draft already has one day, ready to publish."""
    lineage = await _new(client, coach, link, **kwargs)
    await _add_day(client, coach, lineage["draft_program_id"], exercise_ids)
    return lineage


def _lineage_url(link: str, lineage: str) -> str:
    return f"{_BASE}/{link}/program-lineages/{lineage}"


async def _preview(client: AsyncClient, coach: Headers, link: str, lineage: str) -> Response:
    return await client.get(_lineage_url(link, lineage) + "/preview", headers=coach)


async def _publish(
    client: AsyncClient,
    coach: Headers,
    link: str,
    lineage: str,
    *,
    request_id: str | None = None,
    fingerprint: str | None = None,
) -> Response:
    """Publish what the coach just previewed, unless a fingerprint is given explicitly."""
    if fingerprint is None:
        preview = await _preview(client, coach, link, lineage)
        fingerprint = preview.json()["fingerprint"] if preview.status_code == 200 else "0" * 64
    return await client.put(
        _lineage_url(link, lineage) + f"/versions/{request_id or uuid4()}",
        headers=coach,
        json={"fingerprint": fingerprint},
    )


async def _version(
    client: AsyncClient, coach: Headers, link: str, lineage: str
) -> dict[str, Any]:
    response = await _publish(client, coach, link, lineage)
    assert response.status_code == 201, response.text
    return dict(response.json())


async def _detail(client: AsyncClient, coach: Headers, link: str, lineage: str) -> dict[str, Any]:
    response = await client.get(_lineage_url(link, lineage), headers=coach)
    assert response.status_code == 200, response.text
    return dict(response.json())


async def _received(client: AsyncClient, athlete: Headers, offer: str) -> dict[str, Any]:
    response = await client.get(f"/coaching/program-offers/{offer}", headers=athlete)
    assert response.status_code == 200, response.text
    return dict(response.json())


async def _program_of(client: AsyncClient, headers: Headers, program_id: str) -> dict[str, Any]:
    response = await client.get(f"/programs/{program_id}", headers=headers)
    assert response.status_code == 200, response.text
    return dict(response.json())


async def _template_ids(client: AsyncClient, headers: Headers, program_id: str) -> set[str]:
    return {t["id"] for t in (await _program_of(client, headers, program_id))["templates"]}


async def _first_target_sets(client: AsyncClient, headers: Headers, program_id: str) -> int:
    program = await _program_of(client, headers, program_id)
    return int(program["templates"][0]["exercises"][0]["target_sets"])


async def _versions_of(
    client: AsyncClient, coach: Headers, link: str, lineage: str
) -> list[dict[str, Any]]:
    return list((await _detail(client, coach, link, lineage))["versions"])


async def _activate(client: AsyncClient, headers: Headers, program_id: str) -> Response:
    return await client.post(f"/programs/{program_id}/activate", headers=headers)


async def _active(client: AsyncClient, headers: Headers) -> list[dict[str, Any]]:
    return [p for p in await _programs(client, headers) if p["is_active"]]


async def _edit_draft(
    client: AsyncClient, coach: Headers, draft_id: str, exercise_ids: list[str], sets: int
) -> None:
    """Replace the draft's first day's prescriptions, as the existing editor does."""
    draft = await _program_of(client, coach, draft_id)
    template = draft["templates"][0]["id"]
    response = await client.put(
        f"/templates/{template}/exercises",
        headers=coach,
        json={"exercises": [
            {"exercise_id": exercise_ids[0], "target_sets": sets, "target_reps_min": 6,
             "target_reps_max": 8},
        ]},
    )
    assert response.status_code == 200, response.text


# ── preparing ────────────────────────────────────────────────────────────


class TestPreparation:
    async def test_a_new_preparation_is_a_hidden_inactive_draft_for_that_athlete(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        own = await _program(client, coach, exercise_ids, name="My own block")

        lineage = await _new(client, coach, link, name="Athlete block")

        # The coach's own active program is untouched, and the draft is not part of
        # their own program list.
        assert [p["id"] for p in await _active(client, coach)] == [own]
        listed = await _programs(client, coach)
        assert [p["id"] for p in listed] == [own]
        draft = await _program_of(client, coach, lineage["draft_program_id"])
        assert draft["is_active"] is False
        assert draft["name"] == "Athlete block" and draft["templates"] == []
        # The recipient is part of what the editor reads.
        assert draft["prepared_for"]["lineage_id"] == lineage["id"]
        assert draft["prepared_for"]["link_id"] == link
        assert draft["prepared_for"]["athlete"]["username"] == "intruder"
        assert lineage["athlete"]["username"] == "intruder"
        assert lineage["versions"] == [] and lineage["latest_version"] is None
        # Nothing reaches the athlete until it is published.
        assert (await client.get("/coaching/program-offers", headers=athlete)).json()["total"] == 0

    async def test_an_ordinary_program_reports_no_recipient(
        self, client: AsyncClient, coach: Headers, exercise_ids: list[str]
    ) -> None:
        own = await _program(client, coach, exercise_ids)
        assert (await _program_of(client, coach, own))["prepared_for"] is None

    async def test_starting_from_an_existing_program_makes_an_independent_copy(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        source = await _program(client, coach, exercise_ids, name="Template program")

        lineage = await _new(client, coach, link, name=None, from_program=source)

        draft_id = lineage["draft_program_id"]
        assert draft_id != source
        original = await _program_of(client, coach, source)
        draft = await _program_of(client, coach, draft_id)
        assert _shape(draft) == _shape(original)
        assert {t["id"] for t in draft["templates"]}.isdisjoint(
            {t["id"] for t in original["templates"]}
        )
        # The source stays the coach's active program.
        assert [p["id"] for p in await _active(client, coach)] == [source]

        # Editing either one never changes the other.
        await _edit_draft(client, coach, draft_id, exercise_ids, sets=9)
        await client.patch(f"/programs/{source}", headers=coach, json={"name": "Renamed source"})
        await client.put(
            f"/templates/{original['templates'][0]['id']}/exercises", headers=coach,
            json={"exercises": [{"exercise_id": exercise_ids[2], "target_sets": 1}]},
        )
        after_draft = await _program_of(client, coach, draft_id)
        after_source = await _program_of(client, coach, source)
        assert after_draft["name"] == "Template program"
        assert [e["target_sets"] for e in after_draft["templates"][0]["exercises"]] == [9]
        assert after_source["name"] == "Renamed source"
        assert [e["exercise_id"] for e in after_source["templates"][0]["exercises"]] == [
            exercise_ids[2]
        ]

    async def test_a_name_can_override_the_copied_program_name(
        self, client: AsyncClient, coach: Headers, link: str, exercise_ids: list[str]
    ) -> None:
        source = await _program(client, coach, exercise_ids, name="Template program")
        lineage = await _new(client, coach, link, name="For Intruder", from_program=source)
        assert lineage["name"] == "For Intruder"
        assert (await _program_of(client, coach, source))["name"] == "Template program"

    async def test_two_athletes_get_independent_preparations_from_one_source(
        self, client: AsyncClient, coach: Headers, link: str, exercise_ids: list[str]
    ) -> None:
        casey = await _register(client, "casey")
        casey_link = await _connect(client, coach, casey)
        source = await _program(client, coach, exercise_ids)

        first = await _new(client, coach, link, name=None, from_program=source)
        second = await _new(client, coach, casey_link, name=None, from_program=source)
        await _edit_draft(client, coach, first["draft_program_id"], exercise_ids, sets=11)

        other = await _program_of(client, coach, second["draft_program_id"])
        assert other["prepared_for"]["athlete"]["username"] == "casey"
        assert other["templates"][0]["exercises"][0]["target_sets"] == 4  # the source's value
        assert first["draft_program_id"] != second["draft_program_id"]

    async def test_a_preparation_is_not_shown_for_another_connection(
        self, client: AsyncClient, coach: Headers, link: str, exercise_ids: list[str]
    ) -> None:
        casey = await _register(client, "casey")
        casey_link = await _connect(client, coach, casey)
        lineage = await _new(client, coach, link)

        listed = await client.get(f"{_BASE}/{casey_link}/program-lineages", headers=coach)
        assert listed.json() == {"items": []}
        wrong_link = await client.get(_lineage_url(casey_link, lineage["id"]), headers=coach)
        assert wrong_link.status_code == 404
        assert (await _preview(client, coach, casey_link, lineage["id"])).status_code == 404
        assert (await _publish(client, coach, casey_link, lineage["id"])).status_code == 404

    async def test_only_the_coach_of_an_active_connection_can_prepare(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage = await _ready(client, coach, link, exercise_ids)
        stranger = await _register(client, "stranger")
        assert (await client.post("/coaching/enable", headers=stranger)).status_code == 200
        plain = await _register(client, "plain")

        paths = [
            ("GET", f"{_BASE}/{link}/program-lineages"),
            ("GET", _lineage_url(link, lineage["id"])),
            ("GET", _lineage_url(link, lineage["id"]) + "/preview"),
            ("GET", _lineage_url(link, lineage["id"]) + "/versions/1"),
            ("DELETE", _lineage_url(link, lineage["id"])),
        ]
        for method, path in paths:
            # The athlete is not a coach; a stranger who is a coach has no such connection.
            assert (await client.request(method, path, headers=athlete)).status_code == 403, path
            assert (await client.request(method, path, headers=plain)).status_code == 403, path
            assert (await client.request(method, path, headers=stranger)).status_code == 404, path
            assert (await client.request(method, path)).status_code == 401, path
        assert (await _prepare(client, athlete, link)).status_code == 403
        assert (await _prepare(client, stranger, link)).status_code == 404
        assert (await _prepare(client, coach, str(uuid4()))).status_code == 404
        assert (await _publish(client, athlete, link, lineage["id"])).status_code == 403
        assert (await _publish(client, stranger, link, lineage["id"])).status_code == 404

    async def test_the_source_must_be_the_coachs_own_ordinary_program(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        theirs = await _program(client, athlete, exercise_ids, name="Athlete's own")
        assert (await _prepare(client, coach, link, name=None, from_program=theirs)
                ).status_code == 404
        assert (await _prepare(client, coach, link, name=None, from_program=str(uuid4()))
                ).status_code == 404

        lineage = await _new(client, coach, link)
        again = await _prepare(
            client, coach, link, name=None, from_program=lineage["draft_program_id"]
        )
        assert again.status_code == 409

    async def test_a_name_is_needed_without_a_source(
        self, client: AsyncClient, coach: Headers, link: str
    ) -> None:
        assert (await _prepare(client, coach, link, name=None)).status_code == 422
        assert (await _prepare(client, coach, link, name="   ")).status_code == 422
        assert (await _prepare(client, coach, link, name="x" * 201)).status_code == 422

    async def test_a_preparation_cannot_be_activated_deleted_or_sent_on_its_own(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        own = await _program(client, coach, exercise_ids, name="Mine")
        lineage = await _ready(client, coach, link, exercise_ids)
        draft = lineage["draft_program_id"]

        assert (await client.post(f"/programs/{draft}/activate", headers=coach)).status_code == 409
        assert (await client.delete(f"/programs/{draft}", headers=coach)).status_code == 409
        preview = await client.get(f"{_BASE}/{link}/program-preview/{draft}", headers=coach)
        assert preview.status_code == 409
        sent = await client.put(
            f"{_BASE}/{link}/program-offers/{uuid4()}", headers=coach,
            json={"program_id": draft, "fingerprint": "0" * 64},
        )
        assert sent.status_code == 409
        assert [p["id"] for p in await _active(client, coach)] == [own]
        assert (await client.get("/coaching/program-offers", headers=athlete)).json()["total"] == 0

    async def test_the_coach_can_still_edit_the_draft_with_the_normal_editor(
        self, client: AsyncClient, coach: Headers, link: str, exercise_ids: list[str]
    ) -> None:
        lineage = await _ready(client, coach, link, exercise_ids)
        draft = lineage["draft_program_id"]

        renamed = await client.patch(
            f"/programs/{draft}", headers=coach, json={"name": "Renamed", "notes": "Read me."}
        )
        assert renamed.status_code == 200
        assert renamed.json()["prepared_for"]["lineage_id"] == lineage["id"]
        await _edit_draft(client, coach, draft, exercise_ids, sets=5)

        detail = await _detail(client, coach, link, lineage["id"])
        assert detail["name"] == "Renamed" and detail["has_unpublished_changes"] is True
        # The template editor learns the recipient too, from its own read only.
        template = (await _program_of(client, coach, draft))["templates"][0]["id"]
        opened = (await client.get(f"/templates/{template}", headers=coach)).json()
        assert opened["prepared_for"]["athlete"]["username"] == "intruder"
        saved = await client.patch(f"/templates/{template}", headers=coach, json={"name": "Day A"})
        assert "prepared_for" not in saved.json()

    async def test_creating_is_safe_to_repeat(
        self, client: AsyncClient, coach: Headers, link: str
    ) -> None:
        request_id = str(uuid4())
        first = await _prepare(client, coach, link, name="Once", request_id=request_id)
        results = await asyncio.gather(
            *[_prepare(client, coach, link, name="Once", request_id=request_id) for _ in range(4)]
        )

        assert first.status_code == 201
        assert {r.status_code for r in results} == {200}
        assert {r.json()["id"] for r in results} == {first.json()["id"]}
        listed = await client.get(f"{_BASE}/{link}/program-lineages", headers=coach)
        assert len(listed.json()["items"]) == 1
        reused = await _prepare(client, coach, link, name="Different", request_id=request_id)
        assert reused.status_code == 409

    async def test_there_is_a_limit_per_connection(
        self, client: AsyncClient, coach: Headers, link: str
    ) -> None:
        for number in range(10):
            await _new(client, coach, link, name=f"Block {number}")
        assert (await _prepare(client, coach, link, name="One too many")).status_code == 409

    async def test_discarding_works_only_before_the_first_publication(
        self, client: AsyncClient, coach: Headers, link: str, exercise_ids: list[str]
    ) -> None:
        own = await _program(client, coach, exercise_ids)
        unpublished = await _ready(client, coach, link, exercise_ids, name="Never sent")
        published = await _ready(client, coach, link, exercise_ids, name="Sent")
        await _version(client, coach, link, published["id"])

        gone = await client.delete(_lineage_url(link, unpublished["id"]), headers=coach)
        refused = await client.delete(_lineage_url(link, published["id"]), headers=coach)

        assert gone.status_code == 204 and refused.status_code == 409
        assert (
            await client.get(f"/programs/{unpublished['draft_program_id']}", headers=coach)
        ).status_code == 404
        names = [i["name"] for i in (await client.get(
            f"{_BASE}/{link}/program-lineages", headers=coach)).json()["items"]]
        assert names == ["Sent"]
        assert [p["id"] for p in await _active(client, coach)] == [own]


# ── publishing ───────────────────────────────────────────────────────────


class TestPublishing:
    async def test_the_preview_names_the_recipient_the_number_and_the_exact_content(
        self, client: AsyncClient, coach: Headers, link: str, exercise_ids: list[str]
    ) -> None:
        lineage = await _ready(client, coach, link, exercise_ids)

        preview = (await _preview(client, coach, link, lineage["id"])).json()

        assert preview["athlete"]["username"] == "intruder"
        assert preview["version"] == 1 and preview["replaces_version"] is None
        assert preview["lineage_id"] == lineage["id"]
        assert preview["program"]["name"] == "Block A"
        exercises = preview["program"]["templates"][0]["exercises"]
        assert exercises[0]["target_reps_max"] == 10 and exercises[0]["notes"] == "Controlled."
        assert preview["program"]["templates"][0]["notes"] == "Smooth reps."
        assert len(preview["fingerprint"]) == 64

    async def test_publishing_sends_a_pending_version_one_with_the_confirmed_content(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage = await _ready(client, coach, link, exercise_ids)
        preview = (await _preview(client, coach, link, lineage["id"])).json()

        response = await _publish(
            client, coach, link, lineage["id"], fingerprint=preview["fingerprint"]
        )

        assert response.status_code == 201, response.text
        sent = response.json()
        assert sent["version"] == 1 and sent["status"] == "pending"
        assert sent["lineage_id"] == lineage["id"]
        assert sent["program"] == preview["program"]
        received = await _received(client, athlete, sent["id"])
        assert received["version"] == 1 and received["program"] == preview["program"]
        assert received["coach"]["username"] == "efe"
        detail = await _detail(client, coach, link, lineage["id"])
        assert detail["latest_version"] == 1 and detail["pending_version"] == 1
        assert detail["has_unpublished_changes"] is False

    async def test_versions_count_up_and_published_content_never_changes(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage = await _ready(client, coach, link, exercise_ids)
        one = await _version(client, coach, link, lineage["id"])
        await _edit_draft(client, coach, lineage["draft_program_id"], exercise_ids, sets=7)
        await client.patch(
            f"/programs/{lineage['draft_program_id']}", headers=coach, json={"name": "Block B"}
        )

        # A draft change alters no published version, here or for the athlete.
        stored = await client.get(_lineage_url(link, lineage["id"]) + "/versions/1", headers=coach)
        assert stored.json()["program"] == one["program"]
        assert (await _received(client, athlete, one["id"]))["program"] == one["program"]
        assert (await _detail(client, coach, link, lineage["id"]))["has_unpublished_changes"]

        two = await _version(client, coach, link, lineage["id"])
        await _edit_draft(client, coach, lineage["draft_program_id"], exercise_ids, sets=8)
        three = await _version(client, coach, link, lineage["id"])

        assert [one["version"], two["version"], three["version"]] == [1, 2, 3]
        assert two["program"]["name"] == "Block B"
        assert two["program"]["templates"][0]["exercises"][0]["target_sets"] == 7
        assert three["program"]["templates"][0]["exercises"][0]["target_sets"] == 8
        history = (await _detail(client, coach, link, lineage["id"]))["versions"]
        assert [v["version"] for v in history] == [3, 2, 1]
        v1 = (await client.get(_lineage_url(link, lineage["id"]) + "/versions/1", headers=coach))
        assert v1.json()["program"] == one["program"]

    async def test_a_preview_goes_stale_when_the_draft_changes(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage = await _ready(client, coach, link, exercise_ids)
        shown = (await _preview(client, coach, link, lineage["id"])).json()["fingerprint"]
        await _edit_draft(client, coach, lineage["draft_program_id"], exercise_ids, sets=12)

        stale = await _publish(client, coach, link, lineage["id"], fingerprint=shown)

        assert stale.status_code == 412
        assert (await client.get("/coaching/program-offers", headers=athlete)).json()["total"] == 0
        fresh = await _publish(client, coach, link, lineage["id"])
        assert fresh.status_code == 201
        assert fresh.json()["program"]["templates"][0]["exercises"][0]["target_sets"] == 12

    async def test_a_preview_goes_stale_when_another_version_is_published_first(
        self, client: AsyncClient, coach: Headers, link: str, exercise_ids: list[str]
    ) -> None:
        lineage = await _ready(client, coach, link, exercise_ids)
        shown = (await _preview(client, coach, link, lineage["id"])).json()["fingerprint"]
        await _version(client, coach, link, lineage["id"])

        # Same unchanged draft, but the number it would get has moved on: the coach must
        # look again, because it would now replace a waiting version.
        again = await _publish(client, coach, link, lineage["id"], fingerprint=shown)

        assert again.status_code == 412
        assert (await _preview(client, coach, link, lineage["id"])).json()["replaces_version"] == 1

    async def test_a_fingerprint_cannot_be_supplied_for_other_content_or_format(
        self, client: AsyncClient, coach: Headers, link: str, exercise_ids: list[str]
    ) -> None:
        lineage = await _ready(client, coach, link, exercise_ids)
        for bad in ["", "x" * 64, "A" * 64, "0" * 63]:
            response = await _publish(client, coach, link, lineage["id"], fingerprint=bad)
            assert response.status_code == 422, bad
        assert (await _publish(client, coach, link, lineage["id"], fingerprint="0" * 64)
                ).status_code == 412

    async def test_an_empty_draft_cannot_be_published(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str
    ) -> None:
        lineage = await _new(client, coach, link)

        response = await _publish(client, coach, link, lineage["id"])

        assert response.status_code == 422
        assert (await client.get("/coaching/program-offers", headers=athlete)).json()["total"] == 0

    async def test_exercises_the_athlete_cannot_use_block_publication(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        me = (await client.get("/users/me", headers=coach)).json()["id"]
        custom = Exercise(name="Coach-only lift", created_by=me)
        db.add(custom)
        await db.commit()
        lineage = await _new(client, coach, link)
        await client.post(
            f"/programs/{lineage['draft_program_id']}/templates/with-exercises", headers=coach,
            json={"name": "D", "exercises": [{"exercise_id": str(custom.id), "target_sets": 3}]},
        )

        response = await _publish(client, coach, link, lineage["id"])

        assert response.status_code == 422 and "Coach-only lift" in response.json()["detail"]

    async def test_publishing_a_replacement_supersedes_the_waiting_version(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage = await _ready(client, coach, link, exercise_ids)
        one = await _version(client, coach, link, lineage["id"])
        await _edit_draft(client, coach, lineage["draft_program_id"], exercise_ids, sets=6)
        preview = (await _preview(client, coach, link, lineage["id"])).json()
        assert preview["version"] == 2 and preview["replaces_version"] == 1

        two = (await _publish(
            client, coach, link, lineage["id"], fingerprint=preview["fingerprint"]
        )).json()

        history = {v["version"]: v for v in await _versions_of(client, coach, link, lineage["id"])}
        assert history[1]["status"] == "superseded" and history[1]["superseded_at"] is not None
        assert history[1]["responded_at"] is None  # nobody answered it
        assert history[2]["status"] == "pending" and history[2]["superseded_at"] is None
        # Exactly one actionable version.
        pending = await db.scalar(
            select(func.count()).select_from(ProgramOffer).where(
                ProgramOffer.lineage_id == lineage["id"], ProgramOffer.status == "pending"
            )
        )
        assert pending == 1
        # The superseded version stays readable, labelled, with its original content.
        old = await _received(client, athlete, one["id"])
        assert old["status"] == "superseded" and old["program"] == one["program"]
        assert old["acceptance"] is None
        items = (await client.get("/coaching/program-offers", headers=athlete)).json()["items"]
        assert [(i["version"], i["status"]) for i in items] == [(2, "pending"), (1, "superseded")]
        assert two["version"] == 2

    async def test_a_superseded_version_can_neither_be_accepted_nor_declined(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage = await _ready(client, coach, link, exercise_ids)
        one = await _version(client, coach, link, lineage["id"])
        await _version(client, coach, link, lineage["id"])

        accepted = await _accept(client, athlete, one["id"])
        declined = await _decline(client, athlete, one["id"])

        assert accepted.status_code == 409 and "newer version" in accepted.json()["detail"]
        assert declined.status_code == 409
        assert await _programs(client, athlete) == []
        assert (await _received(client, athlete, one["id"]))["status"] == "superseded"
        copies = await db.scalar(
            select(func.count()).select_from(Program).where(Program.name == "Block A")
        )
        assert copies == 1  # the coach's draft only

    async def test_a_declined_version_does_not_block_the_next_one(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage = await _ready(client, coach, link, exercise_ids)
        one = await _version(client, coach, link, lineage["id"])
        assert (await _decline(client, athlete, one["id"])).status_code == 200
        await _edit_draft(client, coach, lineage["draft_program_id"], exercise_ids, sets=5)

        preview = (await _preview(client, coach, link, lineage["id"])).json()
        two = await _publish(client, coach, link, lineage["id"], fingerprint=preview["fingerprint"])

        assert preview["replaces_version"] is None and two.status_code == 201
        shown = await _versions_of(client, coach, link, lineage["id"])
        states = {v["version"]: v["status"] for v in shown}
        assert states == {1: "declined", 2: "pending"}

    async def test_repeating_a_publication_returns_the_same_version(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage = await _ready(client, coach, link, exercise_ids)
        fingerprint = (await _preview(client, coach, link, lineage["id"])).json()["fingerprint"]
        request_id = str(uuid4())

        first = await _publish(client, coach, link, lineage["id"], request_id=request_id,
                               fingerprint=fingerprint)
        # The draft and even the lineage have moved on; the lost-response retry still resolves.
        await _edit_draft(client, coach, lineage["draft_program_id"], exercise_ids, sets=3)
        await _version(client, coach, link, lineage["id"])
        repeat = await _publish(client, coach, link, lineage["id"], request_id=request_id,
                                fingerprint=fingerprint)

        assert first.status_code == 201 and repeat.status_code == 200
        assert repeat.json()["id"] == first.json()["id"] and repeat.json()["version"] == 1
        total = (await client.get("/coaching/program-offers", headers=athlete)).json()["total"]
        assert total == 2

    async def test_a_publish_request_id_cannot_be_reused_for_other_content(
        self, client: AsyncClient, coach: Headers, link: str, exercise_ids: list[str]
    ) -> None:
        lineage = await _ready(client, coach, link, exercise_ids)
        other = await _ready(client, coach, link, exercise_ids, name="Block B")
        request_id = str(uuid4())
        assert (await _publish(client, coach, link, lineage["id"], request_id=request_id)
                ).status_code == 201

        reused = await _publish(client, coach, link, other["id"], request_id=request_id)

        assert reused.status_code == 409

    async def test_legacy_offers_stay_standalone_and_independent_of_lineages(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        legacy_source = await _program(client, coach, exercise_ids, name="Legacy")
        preview = await client.get(
            f"{_BASE}/{link}/program-preview/{legacy_source}", headers=coach
        )
        sent = await client.put(
            f"{_BASE}/{link}/program-offers/{uuid4()}", headers=coach,
            json={"program_id": legacy_source, "fingerprint": preview.json()["fingerprint"]},
        )
        assert sent.status_code == 201
        assert sent.json()["version"] is None and sent.json()["lineage_id"] is None
        lineage = await _ready(client, coach, link, exercise_ids, name="Managed")
        await _version(client, coach, link, lineage["id"])

        offer = await _received(client, athlete, sent.json()["id"])
        assert offer["version"] is None and offer["status"] == "pending"
        # It is not attached to the lineage, and accepting it behaves as it always did.
        detail = await _detail(client, coach, link, lineage["id"])
        assert [v["version"] for v in detail["versions"]] == [1]
        assert (await _accept(client, athlete, sent.json()["id"])).json()["activated"] is False
        assert [p["is_active"] for p in await _programs(client, athlete)] == [False]
        assert (await _received(client, athlete, sent.json()["id"]))["acceptance"] is None


# ── acceptance and activation ────────────────────────────────────────────


async def _accepted_v1(
    client: AsyncClient, coach: Headers, athlete: Headers, link: str, exercise_ids: list[str]
) -> tuple[dict[str, Any], str]:
    """A published and accepted version 1. Returns (lineage, the athlete's copy id)."""
    lineage = await _ready(client, coach, link, exercise_ids)
    one = await _version(client, coach, link, lineage["id"])
    accepted = await _accept(client, athlete, one["id"])
    assert accepted.status_code == 200, accepted.text
    return lineage, str(accepted.json()["program_id"])


async def _publish_edit(
    client: AsyncClient, coach: Headers, link: str, lineage: dict[str, Any],
    exercise_ids: list[str], sets: int,
) -> dict[str, Any]:
    await _edit_draft(client, coach, lineage["draft_program_id"], exercise_ids, sets=sets)
    return await _version(client, coach, link, lineage["id"])


class TestAcceptance:
    async def test_the_first_accepted_version_is_an_inactive_copy_and_keeps_the_active_program(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        mine = await _program(client, athlete, exercise_ids, name="Athlete's own")
        lineage = await _ready(client, coach, link, exercise_ids)
        one = await _version(client, coach, link, lineage["id"])
        before = await _received(client, athlete, one["id"])
        assert before["acceptance"] == {
            "kind": "inactive_copy", "replaces_version": None, "replaces_program_name": None,
            "keeps_active_program_name": "Athlete's own",
        }

        accepted = await _accept(client, athlete, one["id"])

        assert accepted.status_code == 200
        body = accepted.json()
        assert body["status"] == "accepted" and body["activated"] is False
        assert body["acceptance"] is None
        copy = await _program_of(client, athlete, body["program_id"])
        assert copy["is_active"] is False and copy["prepared_for"] is None
        assert [p["id"] for p in await _active(client, athlete)] == [mine]
        assert [t["name"] for t in copy["templates"]] == ["Day 1"]
        assert copy["templates"][0]["exercises"][0]["target_reps_max"] == 10
        assert copy["templates"][0]["exercises"][0]["notes"] == "Controlled."
        assert copy["templates"][0]["notes"] == "Smooth reps."

    async def test_the_first_accepted_version_with_no_active_program_stays_inactive(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage = await _ready(client, coach, link, exercise_ids)
        one = await _version(client, coach, link, lineage["id"])
        assert (await _received(client, athlete, one["id"]))["acceptance"][
            "keeps_active_program_name"] is None

        await _accept(client, athlete, one["id"])

        assert await _active(client, athlete) == []

    async def test_an_accepted_update_replaces_the_active_copy_and_keeps_the_old_one(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage, copy_one = await _accepted_v1(client, coach, athlete, link, exercise_ids)
        assert (await _activate(client, athlete, copy_one)).status_code == 200
        # The athlete personalises their copy.
        old_template = (await _program_of(client, athlete, copy_one))["templates"][0]["id"]
        await client.put(
            f"/templates/{old_template}/exercises", headers=athlete,
            json={"exercises": [{"exercise_id": exercise_ids[3], "target_sets": 1}]},
        )
        await client.patch(f"/programs/{copy_one}", headers=athlete, json={"name": "My tweaks"})
        two = await _publish_edit(client, coach, link, lineage, exercise_ids, sets=7)
        waiting = await _received(client, athlete, two["id"])
        assert waiting["acceptance"] == {
            "kind": "replaces_active_copy", "replaces_version": 1,
            "replaces_program_name": "My tweaks", "keeps_active_program_name": None,
        }

        accepted = await _accept(client, athlete, two["id"])

        body = accepted.json()
        assert accepted.status_code == 200 and body["activated"] is True
        new_copy = await _program_of(client, athlete, body["program_id"])
        assert new_copy["is_active"] is True and new_copy["id"] != copy_one
        assert new_copy["templates"][0]["exercises"][0]["target_sets"] == 7
        assert new_copy["name"] == "Block A"
        # The old copy is retained exactly as the athlete left it, just no longer active.
        old = await _program_of(client, athlete, copy_one)
        assert old["is_active"] is False and old["name"] == "My tweaks"
        assert [e["exercise_id"] for e in old["templates"][0]["exercises"]] == [exercise_ids[3]]
        assert [p["id"] for p in await _active(client, athlete)] == [body["program_id"]]
        assert len(await _programs(client, athlete)) == 2

    async def test_an_update_never_displaces_a_different_active_program(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage, copy_one = await _accepted_v1(client, coach, athlete, link, exercise_ids)
        other = await _program(client, athlete, exercise_ids, name="Something else")  # active
        two = await _publish_edit(client, coach, link, lineage, exercise_ids, sets=7)
        effect = (await _received(client, athlete, two["id"]))["acceptance"]
        assert effect["kind"] == "inactive_copy"
        assert effect["keeps_active_program_name"] == "Something else"

        accepted = await _accept(client, athlete, two["id"])

        assert accepted.json()["activated"] is False
        assert [p["id"] for p in await _active(client, athlete)] == [other]
        new_copy = await _program_of(client, athlete, accepted.json()["program_id"])
        assert new_copy["is_active"] is False
        assert (await _program_of(client, athlete, copy_one))["is_active"] is False

    async def test_an_update_is_inactive_when_the_athlete_deleted_the_previous_copy(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage, copy_one = await _accepted_v1(client, coach, athlete, link, exercise_ids)
        await client.post(f"/programs/{copy_one}/activate", headers=athlete)
        await client.delete(f"/programs/{copy_one}", headers=athlete)
        two = await _publish_edit(client, coach, link, lineage, exercise_ids, sets=7)

        accepted = await _accept(client, athlete, two["id"])

        assert accepted.status_code == 200 and accepted.json()["activated"] is False
        assert await _active(client, athlete) == []
        assert len(await _programs(client, athlete)) == 1

    async def test_an_update_is_inactive_when_the_previous_copy_is_not_active(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage, copy_one = await _accepted_v1(client, coach, athlete, link, exercise_ids)
        two = await _publish_edit(client, coach, link, lineage, exercise_ids, sets=7)

        accepted = await _accept(client, athlete, two["id"])

        assert accepted.json()["activated"] is False and await _active(client, athlete) == []
        assert len(await _programs(client, athlete)) == 2
        assert (await _program_of(client, athlete, copy_one))["is_active"] is False

    async def test_after_a_declined_version_the_last_accepted_copy_is_the_one_replaced(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage, copy_one = await _accepted_v1(client, coach, athlete, link, exercise_ids)
        await client.post(f"/programs/{copy_one}/activate", headers=athlete)
        two = await _publish_edit(client, coach, link, lineage, exercise_ids, sets=7)
        assert (await _decline(client, athlete, two["id"])).status_code == 200
        assert [p["id"] for p in await _active(client, athlete)] == [copy_one]  # unchanged
        three = await _publish_edit(client, coach, link, lineage, exercise_ids, sets=8)

        accepted = await _accept(client, athlete, three["id"])

        assert accepted.json()["activated"] is True
        assert [p["id"] for p in await _active(client, athlete)] == [accepted.json()["program_id"]]

    async def test_each_accepted_version_is_its_own_independent_copy(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage, copy_one = await _accepted_v1(client, coach, athlete, link, exercise_ids)
        two = await _publish_edit(client, coach, link, lineage, exercise_ids, sets=7)
        copy_two = (await _accept(client, athlete, two["id"])).json()["program_id"]

        one_templates = await _template_ids(client, athlete, copy_one)
        two_templates = await _template_ids(client, athlete, copy_two)
        assert copy_one != copy_two and one_templates.isdisjoint(two_templates)
        # The coach's draft shares nothing with either, and editing it changes neither.
        draft_templates = await _template_ids(client, coach, lineage["draft_program_id"])
        assert draft_templates.isdisjoint(one_templates | two_templates)
        await _edit_draft(client, coach, lineage["draft_program_id"], exercise_ids, sets=1)
        assert await _first_target_sets(client, athlete, copy_two) == 7

    async def test_repeating_an_accept_returns_the_original_result_even_after_deleting_the_copy(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage, copy_one = await _accepted_v1(client, coach, athlete, link, exercise_ids)
        await client.post(f"/programs/{copy_one}/activate", headers=athlete)
        two = await _publish_edit(client, coach, link, lineage, exercise_ids, sets=7)
        first = (await _accept(client, athlete, two["id"])).json()
        assert first["activated"] is True

        same = (await _accept(client, athlete, two["id"])).json()
        assert same["program_id"] == first["program_id"] and same["activated"] is True
        await client.delete(f"/programs/{first['program_id']}", headers=athlete)
        after_delete = await _accept(client, athlete, two["id"])

        assert after_delete.status_code == 200
        assert after_delete.json()["program_id"] is None
        assert after_delete.json()["activated"] is True
        # No third copy appeared, and the athlete was not given an active program back.
        assert [p["id"] for p in await _programs(client, athlete)] == [copy_one]
        assert await _active(client, athlete) == []

    async def test_declining_changes_no_installed_program(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage, copy_one = await _accepted_v1(client, coach, athlete, link, exercise_ids)
        await client.post(f"/programs/{copy_one}/activate", headers=athlete)
        before = await _programs(client, athlete)
        two = await _publish_edit(client, coach, link, lineage, exercise_ids, sets=7)

        declined = await _decline(client, athlete, two["id"])

        assert declined.status_code == 200 and declined.json()["status"] == "declined"
        assert await _programs(client, athlete) == before
        assert (await _accept(client, athlete, two["id"])).status_code == 409

    async def test_a_running_workout_keeps_its_plan_and_later_starts_use_the_new_version(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage, copy_one = await _accepted_v1(client, coach, athlete, link, exercise_ids)
        await client.post(f"/programs/{copy_one}/activate", headers=athlete)
        old_template = (await _program_of(client, athlete, copy_one))["templates"][0]["id"]
        started = await client.post(f"/templates/{old_template}/start", headers=athlete)
        assert started.status_code == 201, started.text
        workout = started.json()["workout_id"]
        logged = await client.post(
            f"/workouts/{workout}/sets", headers=athlete,
            json={"exercise_id": exercise_ids[0], "weight_kg": "60", "reps": 9},
        )
        assert logged.status_code == 201, logged.text
        before = (await client.get(f"/workouts/{workout}", headers=athlete)).json()
        assert before["template_snapshot"]["exercises"][0]["target_sets"] == 3

        two = await _publish_edit(client, coach, link, lineage, exercise_ids, sets=7)
        accepted = (await _accept(client, athlete, two["id"])).json()

        after = (await client.get(f"/workouts/{workout}", headers=athlete)).json()
        assert after["template_snapshot"] == before["template_snapshot"]
        assert after["sets"] == before["sets"] and after["template_id"] == old_template
        assert after["total_sets"] == before["total_sets"]
        # A later start from the newly active copy uses the accepted revision.
        new_program = await _program_of(client, athlete, accepted["program_id"])
        new_template = new_program["templates"][0]["id"]
        later = await client.post(f"/templates/{new_template}/start", headers=athlete)
        assert later.status_code == 201, later.text
        assert later.json()["targets"][0]["target_sets"] == 7
        # The old copy still starts with the old prescription.
        old_start = await client.post(f"/templates/{old_template}/start", headers=athlete)
        assert old_start.json()["targets"][0]["target_sets"] == 3

    async def test_accepted_does_not_say_the_athlete_is_following_it(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage, copy_one = await _accepted_v1(client, coach, athlete, link, exercise_ids)
        await client.post(f"/programs/{copy_one}/activate", headers=athlete)
        two = await _publish_edit(client, coach, link, lineage, exercise_ids, sets=7)
        copy_two = (await _accept(client, athlete, two["id"])).json()["program_id"]

        sent = await client.get(f"{_BASE}/{link}/program-offers", headers=coach)
        detail = await _detail(client, coach, link, lineage["id"])
        version = await client.get(_lineage_url(link, lineage["id"]) + "/versions/2", headers=coach)
        everything = str(sent.json()) + str(detail) + str(version.json())

        # The coach learns the status only: no copy ids, no activation, no athlete edits.
        for private in (copy_one, copy_two, "'activated'", "'program_id'", "'is_active'",
                        "accepted_program_id", "activated_on_accept"):
            assert private not in everything, private
        assert {v["status"] for v in detail["versions"]} == {"accepted"}

    async def test_the_coach_cannot_reach_the_athletes_copies(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        _, copy_one = await _accepted_v1(client, coach, athlete, link, exercise_ids)
        template = (await _program_of(client, athlete, copy_one))["templates"][0]["id"]

        for method, path in [
            ("GET", f"/programs/{copy_one}"),
            ("PATCH", f"/programs/{copy_one}"),
            ("POST", f"/programs/{copy_one}/activate"),
            ("DELETE", f"/programs/{copy_one}"),
            ("GET", f"/templates/{template}"),
            ("PUT", f"/templates/{template}/exercises"),
            ("POST", f"/templates/{template}/start"),
        ]:
            response = await client.request(
                method, path, headers=coach, json={"name": "x", "exercises": []}
            )
            assert response.status_code == 404, (method, path)

    async def test_only_the_athlete_of_the_connection_can_answer(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage = await _ready(client, coach, link, exercise_ids)
        one = await _version(client, coach, link, lineage["id"])
        stranger = await _register(client, "stranger")

        for headers in (coach, stranger):
            assert (await _accept(client, headers, one["id"])).status_code == 404
            assert (await _decline(client, headers, one["id"])).status_code == 404
            assert (await client.get(f"/coaching/program-offers/{one['id']}", headers=headers)
                    ).status_code == 404
        assert (await _received(client, athlete, one["id"]))["status"] == "pending"

    async def test_acceptance_works_without_workout_sharing(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        shared = (await client.get("/coaching/coaches", headers=athlete)).json()["items"][0]
        assert shared["shares_workouts"] is False

        lineage, copy_one = await _accepted_v1(client, coach, athlete, link, exercise_ids)

        assert copy_one  # accepted and copied with sharing off


# ── lifecycle ────────────────────────────────────────────────────────────


class TestLifecycle:
    async def test_ending_the_connection_stops_publishing_and_accepting(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage = await _ready(client, coach, link, exercise_ids)
        one = await _version(client, coach, link, lineage["id"])
        assert (await client.delete(f"/coaching/links/{link}", headers=coach)).status_code == 204

        assert (await _accept(client, athlete, one["id"])).status_code == 404
        assert (await _decline(client, athlete, one["id"])).status_code == 404
        assert (await _publish(client, coach, link, lineage["id"])).status_code == 404
        assert (await _preview(client, coach, link, lineage["id"])).status_code == 404
        assert (await client.get(_lineage_url(link, lineage["id"]), headers=coach)
                ).status_code == 404
        assert (await client.get("/coaching/program-offers", headers=athlete)).json()["total"] == 0
        assert await _programs(client, athlete) == []

    async def test_a_new_connection_does_not_revive_old_versions(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage = await _ready(client, coach, link, exercise_ids)
        one = await _version(client, coach, link, lineage["id"])
        await client.delete(f"/coaching/links/{link}", headers=athlete)
        new_link = await _connect(client, coach, athlete)

        assert (await _accept(client, athlete, one["id"])).status_code == 404
        assert (await client.get("/coaching/program-offers", headers=athlete)).json()["total"] == 0
        fresh = await client.get(f"{_BASE}/{new_link}/program-lineages", headers=coach)
        assert fresh.json() == {"items": []}
        assert (await _publish(client, coach, new_link, lineage["id"])).status_code == 404
        assert (await _publish(client, coach, link, lineage["id"])).status_code == 404

    async def test_accepted_copies_and_workouts_survive_the_end_of_the_connection(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage, copy_one = await _accepted_v1(client, coach, athlete, link, exercise_ids)
        await client.post(f"/programs/{copy_one}/activate", headers=athlete)
        template = (await _program_of(client, athlete, copy_one))["templates"][0]["id"]
        started = await client.post(f"/templates/{template}/start", headers=athlete)
        workout = started.json()["workout_id"]

        await client.delete(f"/coaching/links/{link}", headers=coach)

        kept = await _program_of(client, athlete, copy_one)
        assert kept["is_active"] is True and kept["templates"][0]["exercises"]
        assert (await client.get(f"/workouts/{workout}", headers=athlete)).status_code == 200

    async def test_the_draft_is_the_coachs_ordinary_program_again_after_disconnection(
        self, client: AsyncClient, coach: Headers, link: str, exercise_ids: list[str]
    ) -> None:
        lineage = await _ready(client, coach, link, exercise_ids)
        draft = lineage["draft_program_id"]
        await client.delete(f"/coaching/links/{link}", headers=coach)

        listed = {p["id"] for p in await _programs(client, coach)}
        program = await _program_of(client, coach, draft)

        assert draft in listed and program["prepared_for"] is None
        assert (await client.delete(f"/programs/{draft}", headers=coach)).status_code == 204

    async def test_deleting_the_coachs_account_data_removes_lineages_and_versions(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage = await _ready(client, coach, link, exercise_ids)
        await _version(client, coach, link, lineage["id"])
        await db.execute(text("DELETE FROM coach_athlete_links"))
        await db.commit()

        assert await db.scalar(select(func.count()).select_from(ProgramLineage)) == 0
        assert await db.scalar(
            select(func.count()).select_from(ProgramOffer).where(ProgramOffer.lineage_id.is_not(None))
        ) == 0


# ── concurrency ──────────────────────────────────────────────────────────


class TestConcurrency:
    async def test_concurrent_publications_publish_one_version(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage = await _ready(client, coach, link, exercise_ids)
        shown = (await _preview(client, coach, link, lineage["id"])).json()["fingerprint"]

        results = await asyncio.gather(*[
            _publish(client, coach, link, lineage["id"], fingerprint=shown) for _ in range(6)
        ])

        assert sorted(r.status_code for r in results) == [201, 412, 412, 412, 412, 412]
        versions = (await _detail(client, coach, link, lineage["id"]))["versions"]
        assert [(v["version"], v["status"]) for v in versions] == [(1, "pending")]

    async def test_concurrent_publications_with_fresh_previews_never_leave_two_waiting(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage = await _ready(client, coach, link, exercise_ids)
        await _version(client, coach, link, lineage["id"])

        async def attempt() -> Response:
            return await _publish(client, coach, link, lineage["id"])

        results = await asyncio.gather(*[attempt() for _ in range(5)])

        assert {r.status_code for r in results} <= {201, 412}
        assert any(r.status_code == 201 for r in results)
        listed = await _versions_of(client, coach, link, lineage["id"])
        states = [v["status"] for v in listed]
        assert states.count("pending") == 1
        numbers = [v["version"] for v in listed]
        assert numbers == sorted(numbers, reverse=True) and len(set(numbers)) == len(numbers)
        assert numbers == list(range(len(numbers), 0, -1))  # no gaps

    async def test_editing_the_draft_while_publishing_never_publishes_a_blend(
        self, client: AsyncClient, coach: Headers, link: str, exercise_ids: list[str]
    ) -> None:
        lineage = await _ready(client, coach, link, exercise_ids)
        shown = (await _preview(client, coach, link, lineage["id"])).json()
        draft = lineage["draft_program_id"]
        template = (await _program_of(client, coach, draft))["templates"][0]["id"]

        edited, published = await asyncio.gather(
            client.put(
                f"/templates/{template}/exercises", headers=coach,
                json={"exercises": [{"exercise_id": exercise_ids[2], "target_sets": 9}]},
            ),
            _publish(client, coach, link, lineage["id"], fingerprint=shown["fingerprint"]),
        )

        assert edited.status_code == 200 and published.status_code in (201, 412)
        if published.status_code == 201:
            assert published.json()["program"] == shown["program"]

    async def test_concurrent_accepts_of_an_update_make_one_copy_and_one_active_program(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage, copy_one = await _accepted_v1(client, coach, athlete, link, exercise_ids)
        await client.post(f"/programs/{copy_one}/activate", headers=athlete)
        two = await _publish_edit(client, coach, link, lineage, exercise_ids, sets=7)

        results = await asyncio.gather(*[_accept(client, athlete, two["id"]) for _ in range(6)])

        assert {r.status_code for r in results} == {200}
        assert len({r.json()["program_id"] for r in results}) == 1
        assert {r.json()["activated"] for r in results} == {True}
        assert len(await _programs(client, athlete)) == 2
        winner = results[0].json()["program_id"]
        assert [p["id"] for p in await _active(client, athlete)] == [winner]

    async def test_publishing_races_acceptance_without_leaving_two_waiting_or_a_stale_accept(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage = await _ready(client, coach, link, exercise_ids)
        for attempt in range(4):
            waiting = await _version(client, coach, link, lineage["id"])
            draft = lineage["draft_program_id"]
            await _edit_draft(client, coach, draft, exercise_ids, sets=2 + attempt)
            publish, accept = await asyncio.gather(
                _publish(client, coach, link, lineage["id"]),
                _accept(client, athlete, waiting["id"]),
            )
            assert publish.status_code == 201
            assert accept.status_code in (200, 409)
            status = (await _received(client, athlete, waiting["id"]))["status"]
            # Whichever came first: accepted before it was replaced, or refused as superseded.
            assert status == ("accepted" if accept.status_code == 200 else "superseded")
            pending = await db.scalar(
                select(func.count()).select_from(ProgramOffer).where(
                    ProgramOffer.lineage_id == lineage["id"], ProgramOffer.status == "pending"
                )
            )
            assert pending == 1
            # Settle: answer the newest so the next round starts from one waiting version.
            newest = (await _detail(client, coach, link, lineage["id"]))["versions"][0]
            await _decline(client, athlete, newest["id"])
        accepted_copies = len(await _programs(client, athlete))
        accepted_versions = await db.scalar(
            select(func.count()).select_from(ProgramOffer).where(
                ProgramOffer.lineage_id == lineage["id"], ProgramOffer.status == "accepted"
            )
        )
        assert accepted_copies == accepted_versions

    async def test_acceptance_races_the_end_of_the_connection(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        for attempt in range(3):
            lineage = await _ready(client, coach, link, exercise_ids, name=f"Race {attempt}")
            one = await _version(client, coach, link, lineage["id"])
            ended, accepted = await asyncio.gather(
                client.delete(f"/coaching/links/{link}", headers=athlete),
                _accept(client, athlete, one["id"]),
            )
            assert ended.status_code == 204
            copies = [p for p in await _programs(client, athlete) if p["name"] == f"Race {attempt}"]
            if accepted.status_code == 200:
                assert len(copies) == 1
            else:
                assert accepted.status_code == 404 and copies == []
            assert (await _accept(client, athlete, one["id"])).status_code in (200, 404)
            assert (await _publish(client, coach, link, lineage["id"])).status_code == 404
            link = await _connect(client, coach, athlete)

    async def test_publishing_races_the_end_of_the_connection(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage = await _ready(client, coach, link, exercise_ids)
        shown = (await _preview(client, coach, link, lineage["id"])).json()["fingerprint"]

        ended, published = await asyncio.gather(
            client.delete(f"/coaching/links/{link}", headers=athlete),
            _publish(client, coach, link, lineage["id"], fingerprint=shown),
        )

        assert ended.status_code == 204 and published.status_code in (201, 404)
        # Either way nothing is reachable afterwards.
        assert (await client.get("/coaching/program-offers", headers=athlete)).json()["total"] == 0
        assert (await _publish(client, coach, link, lineage["id"])).status_code == 404

    async def test_accepting_an_update_races_activating_and_deleting_other_programs(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage, copy_one = await _accepted_v1(client, coach, athlete, link, exercise_ids)
        for attempt in range(4):
            await client.post(f"/programs/{copy_one}/activate", headers=athlete)
            other = await _program(client, athlete, exercise_ids, name=f"Other {attempt}")
            await _activate(client, athlete, copy_one)  # the copy is active again
            waiting = await _publish_edit(
                client, coach, link, lineage, exercise_ids, sets=3 + attempt
            )

            accept, activate, delete = await asyncio.gather(
                _accept(client, athlete, waiting["id"]),
                client.post(f"/programs/{other}/activate", headers=athlete),
                client.delete(f"/programs/{copy_one}", headers=athlete),
            )

            # No request fails with a server error, and there is never more than one active
            # program (the unique index would turn a second into a 500).
            assert accept.status_code == 200, accept.text
            assert activate.status_code in (200, 404) and delete.status_code in (204, 404)
            assert len(await _active(client, athlete)) <= 1
            new_copy = accept.json()["program_id"]
            assert (await _program_of(client, athlete, new_copy))["name"] == "Block A"
            # Next round: the copy just made is the "previous" one.
            copy_one = new_copy
            for program in await _programs(client, athlete):
                if program["id"] != copy_one:
                    await client.delete(f"/programs/{program['id']}", headers=athlete)

    async def test_two_accepts_of_different_lineages_do_not_leave_two_active_programs(
        self, client: AsyncClient, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        first, first_copy = await _accepted_v1(client, coach, athlete, link, exercise_ids)
        second_lineage = await _ready(client, coach, link, exercise_ids, name="Second block")
        second_one = await _version(client, coach, link, second_lineage["id"])
        second_copy = (await _accept(client, athlete, second_one["id"])).json()["program_id"]
        await client.post(f"/programs/{first_copy}/activate", headers=athlete)
        a = await _publish_edit(client, coach, link, first, exercise_ids, sets=5)
        b = await _publish_edit(client, coach, link, second_lineage, exercise_ids, sets=6)

        results = await asyncio.gather(
            _accept(client, athlete, a["id"]), _accept(client, athlete, b["id"])
        )

        assert {r.status_code for r in results} == {200}
        active = await _active(client, athlete)
        assert len(active) == 1 and active[0]["id"] == results[0].json()["program_id"]
        assert second_copy != active[0]["id"]


# ── schema and legacy data ───────────────────────────────────────────────


async def _raw_offer(db: AsyncSession, link: str, coach_id: str, **columns: Any) -> None:
    values: dict[str, Any] = {
        "link_id": link, "coach_id": coach_id, "request_id": str(uuid4()), "request_hash": "h",
        "program_name": "P", "snapshot": '{"name": "P", "notes": null, "templates": []}',
        "status": "pending",
    }
    values.update(columns)
    names = ", ".join(values)
    params = ", ".join(
        "CAST(:snapshot AS jsonb)" if name == "snapshot" else f":{name}" for name in values
    )
    await db.execute(text(f"INSERT INTO program_offers ({names}) VALUES ({params})"), values)


class TestSchema:
    async def test_a_row_written_without_the_new_columns_is_a_working_legacy_offer(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        coach_id = (await client.get("/users/me", headers=coach)).json()["id"]
        # The same insert the code made before lineages existed.
        await db.execute(
            text(
                "INSERT INTO program_offers (link_id, coach_id, request_id, request_hash, "
                "program_name, snapshot, status) VALUES (:l, :c, gen_random_uuid(), 'h', 'Old', "
                "CAST(:s AS jsonb), 'pending')"
            ),
            {"l": link, "c": coach_id, "s": '{"name": "Old", "notes": null, "templates": []}'},
        )
        await db.commit()

        items = (await client.get("/coaching/program-offers", headers=athlete)).json()["items"]
        assert len(items) == 1 and items[0]["version"] is None and items[0]["status"] == "pending"
        detail = await _received(client, athlete, items[0]["id"])
        assert detail["acceptance"]["kind"] == "inactive_copy"
        accepted = await _accept(client, athlete, items[0]["id"])
        assert accepted.status_code == 200 and accepted.json()["activated"] is False
        sent = (await client.get(f"{_BASE}/{link}/program-offers", headers=coach)).json()
        assert sent["items"][0]["version"] is None

    async def test_the_database_refuses_inconsistent_versions(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        coach_id = (await client.get("/users/me", headers=coach)).json()["id"]
        lineage = await _ready(client, coach, link, exercise_ids)
        await _version(client, coach, link, lineage["id"])
        lineage_id = lineage["id"]

        async def refused(**columns: Any) -> bool:
            try:
                await _raw_offer(db, link, coach_id, **columns)
                await db.commit()
            except IntegrityError:
                await db.rollback()
                return True
            await db.rollback()
            return False

        # A second waiting version, a repeated number, a version without a lineage (and the
        # reverse), version 0, and a legacy offer marked superseded are all impossible.
        assert await refused(lineage_id=lineage_id, version=2, status="pending")
        assert await refused(lineage_id=lineage_id, version=1, status="declined")
        assert await refused(version=3)
        assert await refused(lineage_id=lineage_id)
        assert await refused(lineage_id=lineage_id, version=0, status="declined")
        assert await refused(status="superseded", superseded_at=datetime.now(UTC))
        assert await refused(lineage_id=lineage_id, version=2, status="superseded")
        assert await refused(
            lineage_id=lineage_id, version=2, status="declined", activated_on_accept=True
        )
        assert await refused(status="whatever")
        # A consistent historical row is fine.
        await _raw_offer(db, link, coach_id, lineage_id=lineage_id, version=2, status="declined")
        await db.commit()

    async def test_deleting_the_draft_after_disconnection_keeps_the_history_and_the_athletes_copy(
        self, client: AsyncClient, db: AsyncSession, coach: Headers, athlete: Headers, link: str,
        exercise_ids: list[str],
    ) -> None:
        lineage, copy_one = await _accepted_v1(client, coach, athlete, link, exercise_ids)
        await client.delete(f"/coaching/links/{link}", headers=coach)

        deleted = await client.delete(f"/programs/{lineage['draft_program_id']}", headers=coach)

        assert deleted.status_code == 204
        row = await db.scalar(select(ProgramLineage).where(ProgramLineage.id == lineage["id"]))
        assert row is not None and row.draft_program_id is None
        kept = await db.scalar(
            select(func.count()).select_from(ProgramOffer).where(
                ProgramOffer.lineage_id == lineage["id"]
            )
        )
        assert kept == 1
        assert (await _program_of(client, athlete, copy_one))["templates"]
