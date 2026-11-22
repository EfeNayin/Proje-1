"""Adım 26 (PROJE_1_CODEX_INCELEME.md): the picker showed all ~96 exercises in
one flat list, and the user could not find anything in it. This adds a broad
"category" filter — chest / back / biceps / triceps / legs / abs / shoulders —
coarser than the 17-muscle taxonomy used for volume analytics, so the picker
can offer a handful of chips instead of the full muscle breakdown.

Two placements aren't obvious from the category names alone and are worth
locking down with a test: forearms exercises fall under "biceps" (no separate
"forearms"/"arms" bucket was requested) and traps exercises fall under "back"
(not "shoulders"). See service.CATEGORY_MUSCLES for the full mapping.
"""

import pytest
from httpx import AsyncClient


class TestCategoryFilter:
    @pytest.mark.parametrize(
        "category",
        ["chest", "back", "biceps", "triceps", "legs", "abs", "shoulders"],
    )
    async def test_every_category_has_results(
        self, client: AsyncClient, auth_headers: dict[str, str], category: str
    ) -> None:
        response = await client.get(
            "/exercises", headers=auth_headers, params={"category": category}
        )
        assert response.status_code == 200, response.text
        assert response.json()["total"] > 0

    async def test_rejects_unknown_category(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.get("/exercises", headers=auth_headers, params={"category": "arms"})
        assert response.status_code == 422

    @pytest.mark.parametrize(
        "category,query,name",
        [
            ("chest", "pec deck", "Pec Deck Fly"),
            ("legs", "hack squat", "Hack Squat"),
            ("triceps", "skull crusher", "Barbell Skull Crusher"),
            ("abs", "woodchop", "Cable Woodchop"),
            ("shoulders", "landmine press", "Landmine Press"),
            # Placement judgement calls (see module docstring):
            ("biceps", "bilek bukme", "Dumbbell Wrist Curl"),  # forearms -> biceps
            ("back", "barbell omuz silkme", "Barbell Shrug"),  # traps -> back
        ],
    )
    async def test_category_finds_the_expected_exercise(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        category: str,
        query: str,
        name: str,
    ) -> None:
        response = await client.get(
            "/exercises",
            headers=auth_headers,
            params={"category": category, "q": query},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["total"] == 1
        assert body["items"][0]["name"] == name

    async def test_category_excludes_unrelated_exercises(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """A chest exercise must not show up when browsing "legs"."""
        response = await client.get(
            "/exercises",
            headers=auth_headers,
            params={"category": "legs", "q": "barbell bench press"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["total"] == 0

    async def test_forearms_exercise_is_absent_from_shoulders(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """Locks down the forearms -> biceps placement from the other side."""
        response = await client.get(
            "/exercises",
            headers=auth_headers,
            params={"category": "shoulders", "q": "bilek bukme"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["total"] == 0

    async def test_category_combines_with_equipment(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.get(
            "/exercises",
            headers=auth_headers,
            params={"category": "back", "equipment": "machine"},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["total"] > 0
        assert all(item["equipment"] == "machine" for item in body["items"])
