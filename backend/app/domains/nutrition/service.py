"""Nutrition goal business logic.

The formula (Mifflin-St Jeor + activity multiplier + goal offset) produces a
SUGGESTION, not a fact — the user can overwrite any of the four numbers it
produces, and that override must survive until they explicitly ask to
regenerate it. This is why the four goal fields on `users` are stored values,
not something computed on every read.

Rounding order matters for the "macros add back up to the calorie goal"
guarantee: protein and fat are rounded first, then carbs are computed as
whatever calories are left over. Round-tripping through the *rounded*
calorie_goal (not the raw float) for the fat calculation, and through the
*rounded* protein/fat grams for the carb calculation, keeps the four stored
numbers mutually consistent — the sum of macro calories lands within a few
kcal of calorie_goal, not just each formula step independently.
"""

from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ValidationAppError
from app.domains.nutrition.schemas import NutritionGoalsManualUpdate, NutritionGoalsRead
from app.models import BodyMeasurement, User

# kcal/kg body weight * activity level. Sedentary = little to no exercise,
# very_active = physical job or training twice a day.
_ACTIVITY_MULTIPLIERS: dict[str, float] = {
    "sedentary": 1.2,
    "light": 1.375,
    "moderate": 1.55,
    "active": 1.725,
    "very_active": 1.9,
}

# kcal offset from maintenance (TDEE). Not symmetric: a bulk that outpaces a
# cut invites more fat gain than the extra muscle is worth, so the surplus is
# kept smaller than the deficit.
_GOAL_DELTAS: dict[str, int] = {"cut": -500, "maintain": 0, "bulk": 350}

# Never suggest a calorie target below these, regardless of how aggressive
# the cut or how sedentary the person is — a small-framed person in an
# aggressive cut was calculating out to 889 kcal before this floor existed.
# 'other'/'prefer_not_to_say' fall back to the average of the two, same
# reasoning as the BMR formula below.
_MIN_CALORIES_MALE = 1500
_MIN_CALORIES_FEMALE = 1200

_MISSING_FIELD_LABELS: dict[str, str] = {
    "weight": "weight",
    "height": "height",
    "date_of_birth": "date of birth",
    "gender": "gender",
    "activity_level": "activity level",
    "nutrition_goal": "goal (cut/maintain/bulk)",
}


def _today_in(timezone: str) -> date:
    """Mirrors app.domains.readiness.service._today_in."""
    return datetime.now(ZoneInfo(timezone)).date()


def _age_years(date_of_birth: date, today: date) -> int:
    had_birthday_this_year = (today.month, today.day) >= (date_of_birth.month, date_of_birth.day)
    return today.year - date_of_birth.year - (0 if had_birthday_this_year else 1)


async def _current_weight_kg(db: AsyncSession, user: User) -> Decimal | None:
    """The latest weigh-in, same source the Weight History screen reads —
    there is no separate "current weight" field on users (see
    app.models.body.BodyMeasurement's docstring)."""
    result: Decimal | None = await db.scalar(
        select(BodyMeasurement.weight_kg)
        .where(BodyMeasurement.user_id == user.id)
        .order_by(BodyMeasurement.measured_on.desc())
        .limit(1)
    )
    return result


async def _missing_fields(db: AsyncSession, user: User) -> list[str]:
    """Which required inputs are absent, in a stable, human-meaningful order."""
    missing: list[str] = []
    if await _current_weight_kg(db, user) is None:
        missing.append("weight")
    if user.height_cm is None:
        missing.append("height")
    if user.date_of_birth is None:
        missing.append("date_of_birth")
    if user.gender is None:
        missing.append("gender")
    if user.activity_level is None:
        missing.append("activity_level")
    if user.nutrition_goal is None:
        missing.append("nutrition_goal")
    return missing


def _missing_fields_message(missing: list[str]) -> str:
    labels = [_MISSING_FIELD_LABELS[field] for field in missing]
    if len(labels) == 1:
        joined = labels[0]
    else:
        joined = ", ".join(labels[:-1]) + " and " + labels[-1]
    return f"{joined} {'is' if len(labels) == 1 else 'are'} required to calculate your goals"


def _calculate(
    *, weight_kg: Decimal, height_cm: Decimal, age: int, gender: str, activity_level: str, goal: str
) -> tuple[int, int, int, int]:
    """Returns (calorie_goal, protein_goal_g, carb_goal_g, fat_goal_g)."""
    w, h = float(weight_kg), float(height_cm)

    bmr_male = 10 * w + 6.25 * h - 5 * age + 5
    bmr_female = 10 * w + 6.25 * h - 5 * age - 161
    if gender == "male":
        bmr = bmr_male
    elif gender == "female":
        bmr = bmr_female
    else:
        # No EMG-grade way to do better for 'other'/'prefer_not_to_say' than
        # split the difference — not a made-up third formula, just the
        # average of the two real ones.
        bmr = (bmr_male + bmr_female) / 2

    tdee = bmr * _ACTIVITY_MULTIPLIERS[activity_level]
    raw_calories = tdee + _GOAL_DELTAS[goal]

    min_calories: float
    if gender == "male":
        min_calories = _MIN_CALORIES_MALE
    elif gender == "female":
        min_calories = _MIN_CALORIES_FEMALE
    else:
        min_calories = (_MIN_CALORIES_MALE + _MIN_CALORIES_FEMALE) / 2

    calorie_goal = round(max(raw_calories, bmr, min_calories))

    # 1.6-2.2 g/kg covers hypertrophy training; 2.0 is the midpoint.
    protein_goal_g = round(2.0 * w)
    # 25% of calories from fat, then carbs take whatever is left over — this
    # is what keeps the three macros' calories summing back to calorie_goal.
    fat_goal_g = round(0.25 * calorie_goal / 9)
    carb_goal_g = max(0, round((calorie_goal - protein_goal_g * 4 - fat_goal_g * 9) / 4))

    return calorie_goal, protein_goal_g, carb_goal_g, fat_goal_g


def _to_read(user: User, missing: list[str]) -> NutritionGoalsRead:
    # model_validate rather than the constructor: activity_level/nutrition_goal
    # come off the ORM as plain `str | None` (the CHECK constraint enforces
    # the allowed values at the database level, not the Python type), and
    # model_validate is where that gets reconciled with the schema's Literal
    # types — the same reason UserProfile.model_validate(current_user) is
    # used instead of the constructor elsewhere.
    return NutritionGoalsRead.model_validate(
        {
            "activity_level": user.activity_level,
            "nutrition_goal": user.nutrition_goal,
            "calorie_goal": user.calorie_goal,
            "protein_goal_g": user.protein_goal_g,
            "carb_goal_g": user.carb_goal_g,
            "fat_goal_g": user.fat_goal_g,
            "missing_for_calculation": missing,
        }
    )


async def get_goals(db: AsyncSession, user: User) -> NutritionGoalsRead:
    missing = await _missing_fields(db, user)
    return _to_read(user, missing)


async def generate_goals(db: AsyncSession, user: User) -> NutritionGoalsRead:
    """Calculate fresh goals from the formula and persist them, overwriting
    whatever was there before — including a previous manual override. The
    user asked for this explicitly by calling this endpoint."""
    missing = await _missing_fields(db, user)
    if missing:
        raise ValidationAppError(_missing_fields_message(missing))

    weight_kg = await _current_weight_kg(db, user)
    assert weight_kg is not None  # just proven absent above would have raised
    assert user.height_cm is not None
    assert user.date_of_birth is not None
    assert user.gender is not None
    assert user.activity_level is not None
    assert user.nutrition_goal is not None

    age = _age_years(user.date_of_birth, _today_in(user.timezone))
    calorie_goal, protein_goal_g, carb_goal_g, fat_goal_g = _calculate(
        weight_kg=weight_kg,
        height_cm=user.height_cm,
        age=age,
        gender=user.gender,
        activity_level=user.activity_level,
        goal=user.nutrition_goal,
    )

    user.calorie_goal = calorie_goal
    user.protein_goal_g = protein_goal_g
    user.carb_goal_g = carb_goal_g
    user.fat_goal_g = fat_goal_g
    await db.commit()
    await db.refresh(user)

    return _to_read(user, missing=[])


async def update_goals(
    db: AsyncSession, user: User, payload: NutritionGoalsManualUpdate
) -> NutritionGoalsRead:
    """Save the user's own numbers. Does not touch activity_level or
    nutrition_goal — those go through PATCH /users/me, same as every other
    profile preference."""
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(user, field, value)

    await db.commit()
    await db.refresh(user)

    missing = await _missing_fields(db, user)
    return _to_read(user, missing)
