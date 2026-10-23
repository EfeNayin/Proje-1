/**
 * Wording for the Profile screen. Nothing here derives a new value: the
 * weight is the API's latest measurement, converted only for display.
 */

import type { BodySummary } from "../api/body";
import { formatWeight, type WeightUnit } from "../units/weight";

export type LatestWeight =
  | { kind: "none" }
  | { kind: "recorded"; value: string; date: string | null; accessibilityLabel: string };

export function formatMeasuredOn(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "none" when nothing has been recorded: there is no "0 kg" to fall back to. */
export function describeLatestWeight(summary: BodySummary, unit: WeightUnit): LatestWeight {
  if (summary.current_weight_kg === null) return { kind: "none" };
  const kg = Number(summary.current_weight_kg);
  if (!Number.isFinite(kg)) return { kind: "none" };

  const value = formatWeight(kg, unit);
  const date = summary.last_measured_on ? formatMeasuredOn(summary.last_measured_on) : null;
  return {
    kind: "recorded",
    value,
    date,
    accessibilityLabel: date
      ? `Last recorded weight ${value}, measured on ${date}`
      : `Last recorded weight ${value}`,
  };
}
