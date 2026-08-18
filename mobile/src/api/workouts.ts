/**
 * Workout and set endpoints.
 *
 * Every set mutation returns the whole workout, so the screen can replace its
 * state in one go rather than patching a local copy and hoping the totals
 * still line up.
 */

import { apiRequest } from "./client";

export type LoggedSet = {
  id: number;
  exercise_id: string;
  exercise_name: string;
  set_number: number;
  weight_kg: string;
  reps: number;
  rir: number | null;
  rpe: string | null;
  is_warmup: boolean;
};

export type WorkoutSummary = {
  id: string;
  title: string | null;
  performed_at: string;
  total_volume_kg: string;
  total_sets: number;
  is_private: boolean;
};

export type WorkoutDetail = WorkoutSummary & {
  notes: string | null;
  sets: LoggedSet[];
};

export type WorkoutList = {
  items: WorkoutSummary[];
  total: number;
  limit: number;
  offset: number;
};

export type NewSet = {
  exercise_id: string;
  weight_kg: number;
  reps: number;
  rir?: number | null;
  is_warmup?: boolean;
};

export function startWorkout(title?: string): Promise<WorkoutDetail> {
  return apiRequest<WorkoutDetail>("/workouts", {
    method: "POST",
    body: { title: title ?? null },
  });
}

export function listWorkouts(limit = 20, offset = 0): Promise<WorkoutList> {
  return apiRequest<WorkoutList>(`/workouts?limit=${limit}&offset=${offset}`);
}

export function getWorkout(id: string): Promise<WorkoutDetail> {
  return apiRequest<WorkoutDetail>(`/workouts/${id}`);
}

export function updateWorkout(
  id: string,
  changes: { title?: string | null; notes?: string | null },
): Promise<WorkoutDetail> {
  return apiRequest<WorkoutDetail>(`/workouts/${id}`, { method: "PATCH", body: changes });
}

export function deleteWorkout(id: string): Promise<void> {
  return apiRequest<void>(`/workouts/${id}`, { method: "DELETE" });
}

export function addSet(workoutId: string, set: NewSet): Promise<WorkoutDetail> {
  return apiRequest<WorkoutDetail>(`/workouts/${workoutId}/sets`, {
    method: "POST",
    body: set,
  });
}

export function deleteSet(workoutId: string, setId: number): Promise<WorkoutDetail> {
  return apiRequest<WorkoutDetail>(`/workouts/${workoutId}/sets/${setId}`, {
    method: "DELETE",
  });
}
