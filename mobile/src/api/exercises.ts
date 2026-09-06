/** Exercise catalogue endpoints. */

import { apiRequest } from "./client";

export type ExerciseSummary = {
  id: string;
  name: string;
  name_tr: string | null;
  equipment: string | null;
  is_compound: boolean;
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

type ExerciseList = {
  items: ExerciseSummary[];
  total: number;
  limit: number;
  offset: number;
};

export function searchExercises(query: string, limit = 50): Promise<ExerciseList> {
  const params = new URLSearchParams({ limit: String(limit) });
  // The backend search is accent-insensitive, so "gogus" finds "Göğüs" and
  // the user does not have to switch keyboards.
  if (query.trim()) params.set("q", query.trim());
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
