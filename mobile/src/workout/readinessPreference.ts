/**
 * Whether the readiness check-in screen appears before a workout.
 *
 * On by default: recovery data is the product's whole diagnostic thesis, and
 * it cannot be produced retroactively (same reasoning as timezone), so the
 * earlier it starts getting collected the sooner the diagnosis is useful.
 * Off is a per-device preference, same pattern as restPreference — a user
 * asked for a way to turn it off because it slows down every single workout.
 */

import * as SecureStore from "expo-secure-store";

const KEY = "bodytrack.readiness_checkin_enabled";

export async function isReadinessCheckinEnabled(): Promise<boolean> {
  const stored = await SecureStore.getItemAsync(KEY);
  return stored !== "false";
}

export async function setReadinessCheckinEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(KEY, String(enabled));
}
