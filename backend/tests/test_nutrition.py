"""Tests for calorie/macro goal calculation and storage.

This is a health-adjacent calculation, so the known-input/known-output and
safety-floor cases get the most scrutiny — a silent regression here would
suggest a genuinely unsafe number to someone. age is computed server-side
from date_of_birth and "today" in the user's timezone, so it is frozen the
same way test_body.py freezes measured_on: patching datetime rather than
depending on when the suite happens to run.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

from httpx import AsyncClient

# Registered users default to Europe/Istanbul (UTC+3); 10:00 UTC is safely
# inside the same local calendar day with no midnight-boundary risk.
FROZEN_TODAY_UTC = datetime(2026, 6, 1, 10, 0, tzinfo=ZoneInfo("UTC"))


@contextmanager
def _frozen_today() -> Iterator[None]:
    with patch("app.domains.nutrition.service.datetime") as mock_datetime:
        mock_datetime.now.side_effect = lambda tz: FROZEN_TODAY_UTC.astimezone(tz)
        yield


async def _complete_profile(
    client: AsyncClient,
    headers: dict[str, str],
    *,
    weight_kg: float,
    height_cm: float,
    date_of_birth: str,
    gender: str,
    activity_level: str,
    nutrition_goal: str,
) -> None:
    """Fills in every input the formula needs, mirroring what the Personal
    Details and Preferences screens would have already collected."""
    patch_response = await client.patch(
        "/users/me",
        headers=headers,
        json={
            "height_cm": height_cm,
            "date_of_birth": date_of_birth,
            "gender": gender,
            "activity_level": activity_level,
            "nutrition_goal": nutrition_goal,
        },
    )
    assert patch_response.status_code == 200, patch_response.text

    weigh_in = await client.put(
        "/body/measurements", headers=headers, json={"weight_kg": weight_kg}
    )
    assert weigh_in.status_code == 200, weigh_in.text


class TestGenerateKnownInputs:
    async def test_matches_the_reference_calculation(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """77kg/170cm/22yo male, moderate activity, cut -> ~2178 kcal,
        P154 C255 F60 (rounding tolerance ±2 per the task spec)."""
        await _complete_profile(
            client,
            auth_headers,
            weight_kg=77,
            height_cm=170,
            date_of_birth="2004-01-15",  # 22 on the frozen date below
            gender="male",
            activity_level="moderate",
            nutrition_goal="cut",
        )

        with _frozen_today():
            response = await client.post("/nutrition/goals/generate", headers=auth_headers)

        assert response.status_code == 200, response.text
        body = response.json()
        assert abs(body["calorie_goal"] - 2178) <= 2
        assert abs(body["protein_goal_g"] - 154) <= 2
        assert abs(body["carb_goal_g"] - 255) <= 2
        assert abs(body["fat_goal_g"] - 60) <= 2
        assert body["missing_for_calculation"] == []

    async def test_macros_add_back_up_to_the_calorie_goal(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        await _complete_profile(
            client,
            auth_headers,
            weight_kg=90,
            height_cm=182,
            date_of_birth="1994-03-10",
            gender="male",
            activity_level="active",
            nutrition_goal="bulk",
        )

        with _frozen_today():
            response = await client.post("/nutrition/goals/generate", headers=auth_headers)

        body = response.json()
        macro_calories = (
            body["protein_goal_g"] * 4 + body["carb_goal_g"] * 4 + body["fat_goal_g"] * 9
        )
        assert abs(macro_calories - body["calorie_goal"]) <= 5


class TestSafetyFloor:
    async def test_never_drops_below_bmr_or_the_gender_floor(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """50kg/155cm/30yo female, sedentary, cut: an unclamped TDEE-500
        lands around 889 kcal, well under both BMR (~1158) and the 1200 kcal
        female floor — this used to be exactly the case that shipped an
        unsafe suggestion."""
        await _complete_profile(
            client,
            auth_headers,
            weight_kg=50,
            height_cm=155,
            date_of_birth="1996-01-15",  # 30 on the frozen date below
            gender="female",
            activity_level="sedentary",
            nutrition_goal="cut",
        )

        with _frozen_today():
            response = await client.post("/nutrition/goals/generate", headers=auth_headers)

        assert response.status_code == 200, response.text
        calorie_goal = response.json()["calorie_goal"]
        bmr = 10 * 50 + 6.25 * 155 - 5 * 30 - 161
        assert calorie_goal >= bmr
        assert calorie_goal >= 1200


class TestMissingData:
    async def test_generate_without_any_profile_data_is_422_and_names_the_fields(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.post("/nutrition/goals/generate", headers=auth_headers)

        assert response.status_code == 422, response.text
        detail = response.json()["detail"]
        assert "weight" in detail
        assert "height" in detail

    async def test_get_goals_lists_whats_missing(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.get("/nutrition/goals", headers=auth_headers)

        assert response.status_code == 200, response.text
        missing = response.json()["missing_for_calculation"]
        assert "weight" in missing
        assert "height" in missing
        assert "date_of_birth" in missing
        assert "gender" in missing
        assert "activity_level" in missing
        assert "nutrition_goal" in missing

    async def test_missing_only_weight_still_blocks_generate(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """height/dob/gender/activity/goal present, but no weigh-in yet."""
        await client.patch(
            "/users/me",
            headers=auth_headers,
            json={
                "height_cm": 170,
                "date_of_birth": "2004-01-15",
                "gender": "male",
                "activity_level": "moderate",
                "nutrition_goal": "cut",
            },
        )

        response = await client.post("/nutrition/goals/generate", headers=auth_headers)

        assert response.status_code == 422, response.text
        assert "weight" in response.json()["detail"]


class TestManualOverride:
    async def test_manual_values_are_saved(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.patch(
            "/nutrition/goals",
            headers=auth_headers,
            json={
                "calorie_goal": 2500,
                "protein_goal_g": 180,
                "carb_goal_g": 250,
                "fat_goal_g": 70,
            },
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["calorie_goal"] == 2500
        assert body["protein_goal_g"] == 180
        assert body["carb_goal_g"] == 250
        assert body["fat_goal_g"] == 70

    async def test_manual_value_survives_until_generate_is_called_again(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        await _complete_profile(
            client,
            auth_headers,
            weight_kg=77,
            height_cm=170,
            date_of_birth="2004-01-15",
            gender="male",
            activity_level="moderate",
            nutrition_goal="cut",
        )
        with _frozen_today():
            await client.post("/nutrition/goals/generate", headers=auth_headers)

        await client.patch("/nutrition/goals", headers=auth_headers, json={"calorie_goal": 3000})

        response = await client.get("/nutrition/goals", headers=auth_headers)
        assert response.json()["calorie_goal"] == 3000

    async def test_calling_generate_again_overwrites_the_manual_value(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        await _complete_profile(
            client,
            auth_headers,
            weight_kg=77,
            height_cm=170,
            date_of_birth="2004-01-15",
            gender="male",
            activity_level="moderate",
            nutrition_goal="cut",
        )
        await client.patch("/nutrition/goals", headers=auth_headers, json={"calorie_goal": 3000})

        with _frozen_today():
            response = await client.post("/nutrition/goals/generate", headers=auth_headers)

        assert abs(response.json()["calorie_goal"] - 2178) <= 2

    async def test_rejects_absurd_calorie_value(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.patch(
            "/nutrition/goals", headers=auth_headers, json={"calorie_goal": 300}
        )
        assert response.status_code == 422, response.text

    async def test_rejects_absurd_protein_value(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.patch(
            "/nutrition/goals", headers=auth_headers, json={"protein_goal_g": 900}
        )
        assert response.status_code == 422, response.text

    async def test_only_sent_fields_change(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        await client.patch(
            "/nutrition/goals",
            headers=auth_headers,
            json={
                "calorie_goal": 2500,
                "protein_goal_g": 180,
                "carb_goal_g": 250,
                "fat_goal_g": 70,
            },
        )

        response = await client.patch(
            "/nutrition/goals", headers=auth_headers, json={"calorie_goal": 2600}
        )

        body = response.json()
        assert body["calorie_goal"] == 2600
        assert body["protein_goal_g"] == 180  # untouched


class TestActivityAndGoalViaUsersMe:
    async def test_activity_level_and_nutrition_goal_are_settable_via_patch_users_me(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.patch(
            "/users/me",
            headers=auth_headers,
            json={"activity_level": "active", "nutrition_goal": "bulk"},
        )

        assert response.status_code == 200, response.text
        assert response.json()["activity_level"] == "active"
        assert response.json()["nutrition_goal"] == "bulk"

    async def test_rejects_unknown_activity_level(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.patch(
            "/users/me", headers=auth_headers, json={"activity_level": "superhuman"}
        )
        assert response.status_code == 422, response.text

    async def test_rejects_unknown_nutrition_goal(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        response = await client.patch(
            "/users/me", headers=auth_headers, json={"nutrition_goal": "shred"}
        )
        assert response.status_code == 422, response.text
