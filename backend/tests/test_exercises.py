"""Tests for the exercise catalogue endpoints."""

from httpx import AsyncClient


class TestListExercises:
    async def test_returns_the_seeded_catalogue(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.get("/exercises", headers=auth_headers)

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["total"] == 46
        assert len(body["items"]) == 46

    async def test_requires_authentication(self, client: AsyncClient) -> None:
        response = await client.get("/exercises")
        assert response.status_code == 401

    async def test_compound_movements_come_first(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """They are what people log at the start of a session."""
        items = (await client.get("/exercises", headers=auth_headers)).json()["items"]

        compound_flags = [item["is_compound"] for item in items]
        assert compound_flags == sorted(compound_flags, reverse=True)

    async def test_pagination_splits_the_catalogue(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        first = (
            await client.get("/exercises?limit=5&offset=0", headers=auth_headers)
        ).json()
        second = (
            await client.get("/exercises?limit=5&offset=5", headers=auth_headers)
        ).json()

        assert len(first["items"]) == 5
        assert len(second["items"]) == 5
        # total reports the whole match, not the page.
        assert first["total"] == second["total"] == 46
        assert {item["id"] for item in first["items"]}.isdisjoint(
            item["id"] for item in second["items"]
        )

    async def test_rejects_oversized_page(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """An unbounded limit would let one request pull the entire table."""
        response = await client.get("/exercises?limit=5000", headers=auth_headers)
        assert response.status_code == 422


class TestSearch:
    async def test_finds_by_english_name(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        body = (await client.get("/exercises?q=bench", headers=auth_headers)).json()

        assert body["total"] >= 3
        assert all("bench" in item["name"].lower() for item in body["items"])

    async def test_is_case_insensitive(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        lower = (await client.get("/exercises?q=squat", headers=auth_headers)).json()
        upper = (await client.get("/exercises?q=SQUAT", headers=auth_headers)).json()

        assert lower["total"] == upper["total"] > 0

    async def test_finds_turkish_names_typed_without_accents(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """Most people type 'egimli' on a phone, not 'Eğimli'."""
        body = (await client.get("/exercises?q=egimli", headers=auth_headers)).json()

        assert body["total"] == 1
        assert body["items"][0]["name_tr"] == "Eğimli Bench Press"

    async def test_accented_and_plain_queries_agree(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        plain = (await client.get("/exercises?q=egimli", headers=auth_headers)).json()
        accented = (await client.get("/exercises?q=eğimli", headers=auth_headers)).json()

        assert plain["total"] == accented["total"] == 1

    async def test_matches_in_the_middle_of_a_name(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        body = (await client.get("/exercises?q=deadlift", headers=auth_headers)).json()
        assert body["total"] == 2  # conventional + romanian

    async def test_returns_empty_for_no_match(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        body = (await client.get("/exercises?q=zzzznope", headers=auth_headers)).json()

        assert body["total"] == 0
        assert body["items"] == []


class TestFilters:
    async def test_filters_by_equipment(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        body = (await client.get("/exercises?equipment=cable", headers=auth_headers)).json()

        assert body["total"] > 0
        assert all(item["equipment"] == "cable" for item in body["items"])

    async def test_rejects_unknown_equipment(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.get("/exercises?equipment=kettlebell", headers=auth_headers)
        assert response.status_code == 422

    async def test_filters_by_muscle_group(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        body = (await client.get("/exercises?muscle=chest", headers=auth_headers)).json()

        names = {item["name"] for item in body["items"]}
        assert "Barbell Bench Press" in names
        assert "Cable Fly" in names
        assert "Leg Curl" not in names

    async def test_muscle_filter_includes_secondary_involvement(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """Bench press trains triceps as a secondary muscle and should show up
        when browsing triceps work."""
        body = (await client.get("/exercises?muscle=triceps", headers=auth_headers)).json()

        assert "Barbell Bench Press" in {item["name"] for item in body["items"]}

    async def test_muscle_filter_returns_each_exercise_once(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """A JOIN would duplicate rows when an exercise maps to the muscle more
        than once; the EXISTS form must not."""
        body = (await client.get("/exercises?muscle=quads", headers=auth_headers)).json()

        ids = [item["id"] for item in body["items"]]
        assert len(ids) == len(set(ids))

    async def test_filters_combine(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        body = (
            await client.get(
                "/exercises?muscle=chest&equipment=barbell", headers=auth_headers
            )
        ).json()

        names = {item["name"] for item in body["items"]}
        assert "Barbell Bench Press" in names
        assert "Cable Fly" not in names  # right muscle, wrong equipment


class TestExerciseDetail:
    async def test_returns_the_muscle_breakdown(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        listing = (await client.get("/exercises?q=barbell bench", headers=auth_headers)).json()
        exercise_id = listing["items"][0]["id"]

        response = await client.get(f"/exercises/{exercise_id}", headers=auth_headers)

        assert response.status_code == 200, response.text
        muscles = {m["name"]: m for m in response.json()["muscles"]}
        assert muscles["chest"]["role"] == "primary"
        assert muscles["chest"]["effectiveness"] == 5
        assert muscles["triceps"]["role"] == "secondary"
        assert muscles["triceps"]["effectiveness"] == 3

    async def test_every_exercise_has_a_primary_muscle(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """Weekly volume only counts direct work, so an exercise with no
        primary muscle would be logged and then vanish from analytics."""
        listing = (await client.get("/exercises?limit=100", headers=auth_headers)).json()

        for item in listing["items"]:
            detail = (
                await client.get(f"/exercises/{item['id']}", headers=auth_headers)
            ).json()
            primaries = [m for m in detail["muscles"] if m["role"] == "primary"]
            assert primaries, f"{item['name']} has no primary muscle"

    async def test_effectiveness_is_within_range(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        listing = (await client.get("/exercises?limit=100", headers=auth_headers)).json()

        for item in listing["items"]:
            detail = (
                await client.get(f"/exercises/{item['id']}", headers=auth_headers)
            ).json()
            for muscle in detail["muscles"]:
                assert 1 <= muscle["effectiveness"] <= 5, item["name"]

    async def test_primary_muscles_come_first(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        listing = (await client.get("/exercises?q=deadlift", headers=auth_headers)).json()
        detail = (
            await client.get(f"/exercises/{listing['items'][0]['id']}", headers=auth_headers)
        ).json()

        roles = [m["role"] for m in detail["muscles"]]
        # Primary muscles first, so the client can show the headline muscle
        # without sorting again.
        assert roles == sorted(roles, key=lambda r: r != "primary")

    async def test_unknown_id_returns_404(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.get(
            "/exercises/00000000-0000-0000-0000-000000000000", headers=auth_headers
        )
        assert response.status_code == 404

    async def test_malformed_id_returns_422(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.get("/exercises/not-a-uuid", headers=auth_headers)
        assert response.status_code == 422


class TestMuscleGroups:
    async def test_returns_all_seventeen(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.get("/muscle-groups", headers=auth_headers)

        assert response.status_code == 200, response.text
        assert len(response.json()) == 17

    async def test_includes_volume_landmarks(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """These drive the whole "below MEV / within MAV / over MRV" readout."""
        response = await client.get("/muscle-groups", headers=auth_headers)
        groups = {g["name"]: g for g in response.json()}

        chest = groups["chest"]
        assert (chest["mev"], chest["mav"], chest["mrv"]) == (8, 14, 22)
        assert chest["name_tr"] == "Göğüs"

    async def test_landmarks_are_ordered(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """mev < mav < mrv must hold, otherwise the readout is nonsense."""
        for group in (await client.get("/muscle-groups", headers=auth_headers)).json():
            if group["mev"] is not None:
                assert group["mev"] < group["mav"] < group["mrv"], group["name"]

    async def test_requires_authentication(self, client: AsyncClient) -> None:
        response = await client.get("/muscle-groups")
        assert response.status_code == 401