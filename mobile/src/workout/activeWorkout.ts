/**
 * Which workout is currently in progress, on this device.
 *
 * The backend also tracks this now (workouts.finished_at, GET
 * /workouts/active), so a lost or reinstalled device can recover an
 * unfinished session. This local pointer stays anyway: it is what resumes a
 * session instantly on app relaunch without a round trip, which happens
 * constantly since phones lock between sets.
 * SecureStore rather than AsyncStorage only to avoid pulling in another
 * dependency for one short string; nothing here is secret.
 */

import * as SecureStore from "expo-secure-store";

const KEY = "bodytrack.active_workout_id";

export async function setActiveWorkout(id: string): Promise<void> {
  await SecureStore.setItemAsync(KEY, id);
}

export async function getActiveWorkout(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY);
}

export async function clearActiveWorkout(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
