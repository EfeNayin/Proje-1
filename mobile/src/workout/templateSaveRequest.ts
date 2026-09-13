import * as SecureStore from "expo-secure-store";

import { ApiError } from "../api/client";
import { createTemplateWithExercises } from "../api/programs";
import type { TemplateSaveInput, WorkoutTemplate } from "../api/programs";

export type TemplateSaveRequest = {
  programId: string;
  input: TemplateSaveInput;
};

const key = (workoutId: string) => `bodytrack.template_save.${workoutId}`;

/** Call only after the server confirms the workout is finished. */
export async function clearTemplateSaveRequest(workoutId: string): Promise<void> {
  await SecureStore.deleteItemAsync(key(workoutId));
}

export async function getTemplateSaveRequest(workoutId: string): Promise<TemplateSaveRequest | null> {
  const value = await SecureStore.getItemAsync(key(workoutId));
  if (value === null) return null;
  const request = JSON.parse(value) as TemplateSaveRequest;
  if (!request || typeof request.programId !== "string" ||
      typeof request.input?.name !== "string" || !Array.isArray(request.input.exercises)) {
    throw new Error("Could not read the previous template save. Please try again.");
  }
  return request;
}

/** Keep the original intent even after success: finishing the workout can still fail. */
export async function prepareTemplateSaveRequest(
  workoutId: string,
  proposed: TemplateSaveRequest,
): Promise<TemplateSaveRequest> {
  const existing = await getTemplateSaveRequest(workoutId);
  if (existing) return existing;
  // Persist before sending. A device storage failure must never issue an untracked write.
  await SecureStore.setItemAsync(key(workoutId), JSON.stringify(proposed));
  return proposed;
}

export async function sendTemplateSaveRequest(
  workoutId: string,
  request: TemplateSaveRequest,
): Promise<WorkoutTemplate> {
  // One save-as-template intent per workout. The server scopes this id to the account.
  try {
    return await createTemplateWithExercises(request.programId, request.input, workoutId);
  } catch (error) {
    // Validation rejection proves no save was committed, so the user can correct the form.
    if (error instanceof ApiError && error.status === 422) {
      await SecureStore.deleteItemAsync(key(workoutId));
    }
    throw error;
  }
}
