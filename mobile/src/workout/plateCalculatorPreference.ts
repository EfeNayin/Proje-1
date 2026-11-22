/**
 * Bar weight and available plate sizes for the plate calculator.
 *
 * A per-device habit, not user data (same reasoning and pattern as
 * restPreference.ts): the bar and plates in your gym rarely change. One entry
 * per unit, because a 20 kg bar with kg plates and a 45 lb bar with lb plates
 * are different setups, and switching the unit preference must not carry one
 * over to the other.
 *
 * A storage failure is never the user's problem: reading falls back to the
 * unit's defaults, writing is best effort.
 */

import * as SecureStore from "expo-secure-store";

import type { WeightUnit } from "../units/weight";
import { sanitizePlatePreference, type PlatePreference } from "./plateMath";

// SecureStore keys may only contain alphanumerics, ".", "-" and "_".
const key = (unit: WeightUnit) => `bodytrack.plate_calculator.${unit}`;

export async function getPlatePreference(unit: WeightUnit): Promise<PlatePreference> {
  let parsed: unknown = null;
  try {
    const stored = await SecureStore.getItemAsync(key(unit));
    parsed = stored === null ? null : JSON.parse(stored);
  } catch {
    // Unreadable or corrupted: start from the defaults instead of failing the screen.
  }
  return sanitizePlatePreference(parsed, unit);
}

export async function setPlatePreference(unit: WeightUnit, preference: PlatePreference): Promise<void> {
  await SecureStore.setItemAsync(key(unit), JSON.stringify(preference));
}
