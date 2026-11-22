import { randomUUID } from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import { ApiError } from "../api/client";
import { saveSetRequest, type NewSet, type WorkoutDetail } from "../api/workouts";

export type SetSaveRequest = { requestId: string; exerciseName: string; input: NewSet };
const key = (userId: string, workoutId: string) => `bodytrack.set_save.${userId}.${workoutId}`;
const locks = new Map<string, Promise<void>>();

/** Serialize storage and network work across screen instances in this app. */
async function withLock<T>(scope: string, action: () => Promise<T>): Promise<T> {
  const task = (locks.get(scope) ?? Promise.resolve()).then(action);
  const tail = task.then(() => undefined, () => undefined);
  locks.set(scope, tail);
  try { return await task; }
  finally { if (locks.get(scope) === tail) locks.delete(scope); }
}

export async function getSetSaveRequest(userId: string, workoutId: string): Promise<SetSaveRequest | null> {
  const raw = await SecureStore.getItemAsync(key(userId, workoutId));
  if (raw === null) return null;
  const request = JSON.parse(raw) as SetSaveRequest;
  if (!request || typeof request.requestId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(request.requestId) || typeof request.exerciseName !== "string" ||
      typeof request.input?.exercise_id !== "string" ||
      !Number.isFinite(request.input.weight_kg) || !Number.isInteger(request.input.reps) ||
      (request.input.rir != null && !Number.isInteger(request.input.rir))) {
    throw new Error("Could not read the pending set. Retry loading before logging another set.");
  }
  return request;
}

/** Never overwrite an unresolved intent, even across overlapping screen instances. */
export async function prepareSetSaveRequest(
  userId: string, workoutId: string, exerciseName: string, input: NewSet,
): Promise<SetSaveRequest> {
  return withLock(key(userId, workoutId), async () => {
    if (await getSetSaveRequest(userId, workoutId)) {
      throw new Error("Resolve the pending set before logging another set.");
    }
    const request = { requestId: randomUUID(), exerciseName,
      input: { ...input, weight_kg: Math.round(input.weight_kg * 100) / 100 } };
    await SecureStore.setItemAsync(key(userId, workoutId), JSON.stringify(request));
    return request;
  });
}

export async function sendSetSaveRequest(
  userId: string, workoutId: string, request: SetSaveRequest,
): Promise<WorkoutDetail> {
  return withLock(key(userId, workoutId), async () => {
    const saved = await getSetSaveRequest(userId, workoutId);
    if (!saved || saved.requestId !== request.requestId) {
      throw new Error("The pending set changed. Reload this workout before trying again.");
    }
    let result: WorkoutDetail;
    try {
      result = await saveSetRequest(workoutId, saved.requestId, saved.input);
    } catch (error) {
      // A 422 proves that this attempt was rejected without committing a set.
      // Network errors, 401, 404, 409 and 5xx retain the original intent.
      if (error instanceof ApiError && error.status === 422) {
        await SecureStore.deleteItemAsync(key(userId, workoutId));
      }
      throw error;
    }
    // If local cleanup fails, keep the request unresolved. Replaying it is safe.
    await SecureStore.deleteItemAsync(key(userId, workoutId));
    return result;
  });
}
