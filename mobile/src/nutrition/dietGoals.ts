/**
 * The Diet home reads the nutrition goals the user has already saved (GET /nutrition/goals,
 * edited on Profile > Nutrition Goals). It shows them as DAILY TARGETS only: no food is
 * recorded yet, so there is nothing consumed or remaining to compute.
 *
 * One owner for focus loads and retries, like the weekly volume loader: only the newest
 * request may change the screen (a slow answer from an earlier focus, a request that was
 * overtaken by a retry, or one that finishes after the screen was left or the account
 * changed is dropped), and a failed reload keeps the goals already on screen and records
 * only the error, so a transient failure never turns saved goals into "no goals".
 */

import type { NutritionGoals } from "../api/nutrition";

export type DietGoals = {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
};

export type DietGoalsState = {
  /** null until the first successful load. */
  goals: DietGoals | null;
  /** First load only: nothing to show yet. */
  loading: boolean;
  /** The last attempt failed. `goals`, if any, are older than this. */
  error: string | null;
};

const EMPTY_VALUE = "—";

export function initialDietGoalsState(): DietGoalsState {
  return { goals: null, loading: true, error: null };
}

const asGoal = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** An absent goal stays null: it must never become a zero. */
export function normalizeGoals(response: NutritionGoals): DietGoals {
  if (response === null || typeof response !== "object") {
    throw new Error("Unexpected response. Try again.");
  }
  return {
    calories: asGoal(response.calorie_goal),
    protein: asGoal(response.protein_goal_g),
    carbs: asGoal(response.carb_goal_g),
    fat: asGoal(response.fat_goal_g),
  };
}

/** The saved number, or an em dash when there is none. */
export function formatGoal(value: number | null): string {
  return value === null ? EMPTY_VALUE : String(Math.round(value));
}

export function hasAnyGoal(goals: DietGoals | null): boolean {
  return goals !== null && Object.values(goals).some((value) => value !== null);
}

export function createDietGoalsLoader(fetchGoals: () => Promise<NutritionGoals>) {
  let state = initialDietGoalsState();
  let generation = 0;
  const listeners = new Set<() => void>();
  const publish = (next: DietGoalsState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Blur / unmount / account change: whatever is still in flight no longer counts. */
    invalidate: () => {
      generation += 1;
    },
    async load(): Promise<void> {
      const request = ++generation;
      // A retry after a failure on an empty screen is a first load again.
      publish({ ...state, loading: state.goals === null, error: null });
      try {
        const goals = normalizeGoals(await fetchGoals());
        if (request !== generation) return;
        publish({ goals, loading: false, error: null });
      } catch (error) {
        if (request !== generation) return;
        publish({
          ...state,
          loading: false,
          error:
            error instanceof Error && error.message
              ? error.message
              : "Could not load your daily goals.",
        });
      }
    },
  };
}
