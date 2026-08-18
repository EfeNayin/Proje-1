/**
 * Which workout is currently in progress.
 *
 * The backend has no "finished" flag: a workout exists from the moment it is
 * created, and finishing is simply the client letting go of it. That keeps
 * the schema smaller, and it also means an abandoned session still keeps
 * whatever sets were logged rather than vanishing.
 *
 * The id lives on the device so that closing the app mid-session — which
 * happens constantly, phones lock between sets — resumes where it left off.
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
