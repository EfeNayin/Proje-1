/**
 * Programs, templates and template-exercise targets.
 *
 * Templates and their exercises are addressed by their own id, not nested
 * under their program in the URL — matching how the backend proves their
 * ownership (through the parent program, not through the path).
 */

import { apiRequest } from "./client";

export type TemplateExerciseTarget = {
  id: number;
  exercise_id: string;
  exercise_name: string;
  exercise_order: number;
  target_sets: number;
  target_reps_min: number | null;
  target_reps_max: number | null;
  target_rir: number | null;
  target_rpe: string | null;
  notes: string | null;
};

export type TemplateExerciseInput = {
  exercise_id: string;
  target_sets: number;
  target_reps_min?: number | null;
  target_reps_max?: number | null;
  target_rir?: number | null;
  target_rpe?: number | null;
  notes?: string | null;
};

export type WorkoutTemplate = {
  id: string;
  name: string;
  day_order: number;
  notes: string | null;
  exercises: TemplateExerciseTarget[];
};

export type ProgramSummary = {
  id: string;
  name: string;
  is_active: boolean;
};

export type ProgramDetail = ProgramSummary & {
  notes: string | null;
  templates: WorkoutTemplate[];
};

export type TemplateStart = {
  workout_id: string;
  template_id: string;
  performed_at: string;
  targets: TemplateExerciseTarget[];
};

export function createProgram(name: string, notes?: string | null): Promise<ProgramDetail> {
  return apiRequest<ProgramDetail>("/programs", { method: "POST", body: { name, notes } });
}

export function listPrograms(): Promise<ProgramSummary[]> {
  return apiRequest<ProgramSummary[]>("/programs");
}

export function getProgram(id: string): Promise<ProgramDetail> {
  return apiRequest<ProgramDetail>(`/programs/${id}`);
}

export function updateProgram(
  id: string,
  changes: { name?: string; notes?: string | null },
): Promise<ProgramDetail> {
  return apiRequest<ProgramDetail>(`/programs/${id}`, { method: "PATCH", body: changes });
}

export function activateProgram(id: string): Promise<ProgramDetail> {
  return apiRequest<ProgramDetail>(`/programs/${id}/activate`, { method: "POST" });
}

export function deleteProgram(id: string): Promise<void> {
  return apiRequest<void>(`/programs/${id}`, { method: "DELETE" });
}

export function createTemplate(
  programId: string,
  input: { name: string; day_order?: number; notes?: string | null },
): Promise<WorkoutTemplate> {
  return apiRequest<WorkoutTemplate>(`/programs/${programId}/templates`, {
    method: "POST",
    body: input,
  });
}

export function getTemplate(id: string): Promise<WorkoutTemplate> {
  return apiRequest<WorkoutTemplate>(`/templates/${id}`);
}

export function updateTemplate(
  id: string,
  changes: { name?: string; day_order?: number; notes?: string | null },
): Promise<WorkoutTemplate> {
  return apiRequest<WorkoutTemplate>(`/templates/${id}`, { method: "PATCH", body: changes });
}

export function deleteTemplate(id: string): Promise<void> {
  return apiRequest<void>(`/templates/${id}`, { method: "DELETE" });
}

/** Replaces every exercise and target in the template in one request. */
export function setTemplateExercises(
  id: string,
  exercises: TemplateExerciseInput[],
): Promise<WorkoutTemplate> {
  return apiRequest<WorkoutTemplate>(`/templates/${id}/exercises`, {
    method: "PUT",
    body: { exercises },
  });
}

/** Creates an empty workout linked to the template. No sets are created. */
export function startWorkoutFromTemplate(templateId: string): Promise<TemplateStart> {
  return apiRequest<TemplateStart>(`/templates/${templateId}/start`, { method: "POST" });
}
