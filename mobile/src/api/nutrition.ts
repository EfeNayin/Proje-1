/** Nutrition goal endpoints: read, auto-calculate, and manual override. */

import type { ActivityLevel, NutritionGoalKind } from "./auth";
import { apiRequest } from "./client";

export type { ActivityLevel, NutritionGoalKind };

export type NutritionGoals = {
  activity_level: ActivityLevel | null;
  nutrition_goal: NutritionGoalKind | null;
  calorie_goal: number | null;
  protein_goal_g: number | null;
  carb_goal_g: number | null;
  fat_goal_g: number | null;
  /** Empty once every input the formula needs (weight, height, date of
   * birth, gender, activity level, goal) is on file. Does not mean the
   * goals themselves are set — the user may just not have generated or
   * entered any yet. */
  missing_for_calculation: string[];
};

export type NutritionGoalsManualUpdate = Partial<{
  calorie_goal: number | null;
  protein_goal_g: number | null;
  carb_goal_g: number | null;
  fat_goal_g: number | null;
}>;

export function fetchNutritionGoals(): Promise<NutritionGoals> {
  return apiRequest<NutritionGoals>("/nutrition/goals");
}

/** Calculates goals from the Mifflin-St Jeor formula and saves them,
 * overwriting any previous value including a manual override. */
export function generateNutritionGoals(): Promise<NutritionGoals> {
  return apiRequest<NutritionGoals>("/nutrition/goals/generate", { method: "POST" });
}

export function updateNutritionGoals(
  changes: NutritionGoalsManualUpdate,
): Promise<NutritionGoals> {
  return apiRequest<NutritionGoals>("/nutrition/goals", { method: "PATCH", body: changes });
}
