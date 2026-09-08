"""Request and response models for nutrition goals."""

from pydantic import BaseModel, Field

# Re-exported so callers have one obvious place to import these from, even
# though they are defined alongside Gender in the auth schemas (UserProfile
# needs them too, since activity_level/nutrition_goal are also editable
# through PATCH /users/me).
from app.domains.auth.schemas import ActivityLevel, NutritionGoalKind

__all__ = ["ActivityLevel", "NutritionGoalKind", "NutritionGoalsManualUpdate", "NutritionGoalsRead"]


class NutritionGoalsRead(BaseModel):
    """Current goals plus, if the auto-calculation can't run yet, what's
    missing. missing_for_calculation is empty once every required input
    (current weight, height, date of birth, gender, activity level, goal)
    is on file — it does not mean the goals themselves are non-null, since
    the user may simply not have generated or entered any yet."""

    activity_level: ActivityLevel | None
    nutrition_goal: NutritionGoalKind | None
    calorie_goal: int | None
    protein_goal_g: int | None
    carb_goal_g: int | None
    fat_goal_g: int | None
    missing_for_calculation: list[str]


class NutritionGoalsManualUpdate(BaseModel):
    """The user overwriting the suggested numbers by hand. Every field is
    optional (PATCH semantics, exclude_unset) so one field can be tweaked
    without resending the rest. Bounds mirror the CHECK constraints — CHECK
    would catch a violation anyway, but failing here returns a clearer 422
    before a query is even made."""

    calorie_goal: int | None = Field(default=None, ge=800, le=8000)
    protein_goal_g: int | None = Field(default=None, ge=0, le=500)
    carb_goal_g: int | None = Field(default=None, ge=0, le=1000)
    fat_goal_g: int | None = Field(default=None, ge=0, le=400)
