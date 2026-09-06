/**
 * Preferred rest length between sets.
 *
 * Kept on the device rather than typed each session: rest is a habit, not a
 * per-workout decision, and whatever the user picked last time is almost
 * always what they want next time.
 */

import * as SecureStore from "expo-secure-store";

const KEY = "bodytrack.rest_seconds";

/** Common rest lengths. Short for isolation, long for heavy compounds. */
export const REST_PRESETS = [60, 90, 120, 150, 180, 240] as const;

export const DEFAULT_REST_SECONDS = 120;

export function formatRest(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export async function getRestSeconds(): Promise<number> {
  const stored = await SecureStore.getItemAsync(KEY);
  const parsed = Number(stored);
  // Guard against a corrupted value rather than starting a timer at NaN.
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REST_SECONDS;
}

export async function setRestSeconds(seconds: number): Promise<void> {
  await SecureStore.setItemAsync(KEY, String(seconds));
}