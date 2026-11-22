import type { ReadinessPatch } from "../api/readiness";

/**
 * How sleep text becomes a value. Strict: the server accepts 0 to 24 hours with at most
 * one decimal, and a typo must be shown to the user rather than silently turned into
 * "no sleep recorded". An empty field is "not recorded", never zero hours; "0" is zero.
 */
export type SleepText =
  | { kind: "empty" }
  | { kind: "valid"; hours: number }
  | { kind: "invalid" };

export const SLEEP_HOURS_HELP = "Enter hours from 0 to 24, with at most one decimal (for example 7.5).";

export function parseSleepText(raw: string): SleepText {
  const text = raw.trim().replace(",", ".");
  if (text === "") return { kind: "empty" };
  if (!/^\d{1,2}(\.\d)?$/.test(text)) return { kind: "invalid" };
  const hours = Number(text);
  return hours >= 0 && hours <= 24 ? { kind: "valid", hours } : { kind: "invalid" };
}

/** The server's decimal ("7.5", "8.0") as text for the field; null when nothing is recorded. */
export function sleepTextOf(value: string | null): string {
  if (value === null) return "";
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : "";
}

/**
 * What the pre-workout check-in saves: only what the user filled in. A blank sleep field
 * or an unanswered rating is left out, so it can never replace an earlier value of the
 * same day with nothing. Returns null when nothing was filled in (no request is made).
 */
export function buildCheckinPatch(input: {
  sleepText: string;
  energy: number | null;
  soreness: Record<string, number>;
}): ReadinessPatch | null {
  const patch: ReadinessPatch = {};
  const sleep = parseSleepText(input.sleepText);
  if (sleep.kind === "valid") patch.sleep_hours = sleep.hours;
  if (input.energy !== null) patch.energy = input.energy;
  if (Object.keys(input.soreness).length > 0) patch.soreness = input.soreness;
  return Object.keys(patch).length > 0 ? patch : null;
}
