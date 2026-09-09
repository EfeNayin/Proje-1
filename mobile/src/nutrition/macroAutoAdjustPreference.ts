/**
 * Whether editing one nutrition goal field live-adjusts the others.
 *
 * A per-device UI behaviour, not user data — the backend has no column for
 * it (see TASK_nutrition_ux.md). Mirrors src/workout/restPreference.ts.
 *
 * On by default: calories and macros are mathematically linked
 * (P*4 + C*4 + F*9 = calories), so leaving them to drift out of sync is the
 * surprising choice, not this one. Off is an escape hatch for someone who
 * wants "same calories, more protein, less carbs" without the fields
 * fighting each other on every edit.
 */

import * as SecureStore from "expo-secure-store";

const KEY = "bodytrack.macro_auto_adjust_enabled";

export async function isMacroAutoAdjustEnabled(): Promise<boolean> {
  const stored = await SecureStore.getItemAsync(KEY);
  return stored !== "false";
}

export async function setMacroAutoAdjustEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(KEY, String(enabled));
}
