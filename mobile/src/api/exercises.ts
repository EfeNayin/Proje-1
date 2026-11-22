/** Exercise catalogue endpoints. */

import { apiRequest } from "./client";

/** A muscle an exercise trains directly. `name` is the stable code, e.g. "front_delts". */
export type PrimaryMuscle = {
  name: string;
  name_tr: string;
};

export type ExerciseSummary = {
  id: string;
  name: string;
  name_tr: string | null;
  equipment: string | null;
  is_compound: boolean;
  /**
   * Best fit first. Optional because a backend deployed before this field
   * existed does not send it; rows then show no muscle line rather than a guess.
   */
  primary_muscles?: PrimaryMuscle[];
};

// Mirrors the backend's `Equipment` literal in app/domains/exercises/schemas.py
// (tests/exercise-browser.test.cjs checks this, the backend and the choices in
// src/exercises/exerciseFilters.ts against each other). An exercise whose
// equipment is not recorded has `equipment: null`; that is not "bodyweight" and
// there is no filter value for it.
export type Equipment = "barbell" | "dumbbell" | "machine" | "cable" | "bodyweight";

/**
 * What the catalogue is narrowed by, next to the typed query. `muscle` is a
 * muscle-group code from GET /muscle-groups and matches PRIMARY involvement only.
 */
export type ExerciseFilters = {
  muscle: string | null;
  equipment: Equipment | null;
};

export type MuscleInvolvement = {
  name: string;
  name_tr: string;
  role: "primary" | "secondary";
  effectiveness: number;
};

export type ExerciseDetail = ExerciseSummary & {
  muscles: MuscleInvolvement[];
};

export type ExerciseList = {
  items: ExerciseSummary[];
  total: number;
  limit: number;
  offset: number;
};

/** `offset` pages through the matches; the backend caps `limit` at 100. */
export function searchExercises(
  query: string,
  filters: ExerciseFilters = { muscle: null, equipment: null },
  limit = 50,
  offset = 0,
): Promise<ExerciseList> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (offset > 0) params.set("offset", String(offset));
  // The backend search is accent-insensitive, so "gogus" finds "Göğüs" and
  // the user does not have to switch keyboards.
  if (query.trim()) params.set("q", query.trim());
  if (filters.muscle) params.set("muscle", filters.muscle);
  if (filters.equipment) params.set("equipment", filters.equipment);
  return apiRequest<ExerciseList>(`/exercises?${params.toString()}`);
}

export function getExercise(id: string): Promise<ExerciseDetail> {
  return apiRequest<ExerciseDetail>(`/exercises/${id}`);
}

export type MuscleGroupSummary = {
  id: number;
  name: string;
  name_tr: string;
  region: "upper" | "lower" | "core";
  mev: number | null;
  mav: number | null;
  mrv: number | null;
};

export function listMuscleGroups(): Promise<MuscleGroupSummary[]> {
  return apiRequest<MuscleGroupSummary[]>("/muscle-groups");
}
