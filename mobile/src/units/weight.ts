/**
 * kg <-> lb conversion for display and input.
 *
 * Every weight value in the API and database is kg (see CLAUDE.md — this is
 * an intentional architecture decision, not something this module changes).
 * `users.weight_unit` is only a display preference. Before this file, the
 * preferences screen said so explicitly ("Display only — existing values
 * are not converted") because nothing actually converted anything.
 *
 * The rule this module enforces: kg is the only unit that ever crosses an
 * API boundary. Screens convert to the user's unit at the last possible
 * moment for display, and convert back to kg at the first possible moment
 * after a user types a number — every `weight_kg` sent to the API, and
 * every `parsed`/`< 20 || > 400` style bounds check, stays in kg.
 */

export type WeightUnit = "kg" | "lb";

/** Body weight bounds, matching the backend's own sanity range for a body
 * measurement. Always compare a parsed value against these in kg — after
 * `parseWeightInput` has already converted it — never convert the bounds
 * themselves to the display unit. */
export const BODY_WEIGHT_MIN_KG = 20;
export const BODY_WEIGHT_MAX_KG = 400;

/** Exact — the internationally defined pound. */
const KG_PER_LB = 0.45359237;

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

/** kg -> the user's display unit. Identity when the unit is kg. */
export function toDisplayWeight(kg: number, unit: WeightUnit): number {
  return unit === "lb" ? kgToLb(kg) : kg;
}

/** A value entered in the user's display unit -> kg, for the API/storage. */
export function fromDisplayWeight(value: number, unit: WeightUnit): number {
  return unit === "lb" ? lbToKg(value) : value;
}

/**
 * One decimal place of display resolution. Plates move in ~2.5 kg or ~5 lb
 * jumps, so a tenth of a unit is already finer than anyone loads a bar to;
 * this mainly exists to kill the floating-point noise a kg<->lb conversion
 * introduces (82.5 kg must not render as "181.89999999999998 lb").
 */
function roundDisplay(value: number): number {
  return Math.round(value * 10) / 10;
}

/** "82.5" or "182" — no trailing ".0" for whole numbers. */
function trimmed(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** kg from the API -> a display string with unit suffix, e.g. "82.5 kg" / "182 lb". */
export function formatWeight(kg: number, unit: WeightUnit): string {
  return `${trimmed(roundDisplay(toDisplayWeight(kg, unit)))} ${unit}`;
}

/** kg from the API -> a bare display number as a string, for prefilling a
 * TextInput whose unit label is rendered separately (e.g. the "kg ×" / "lb ×"
 * field next to a set's weight input). */
export function formatWeightValue(kg: number, unit: WeightUnit): string {
  return trimmed(roundDisplay(toDisplayWeight(kg, unit)));
}

/** "20–400 kg" / "44–882 lb" — for an error message next to a body-weight
 * field, in whichever unit the field is actually showing. */
export function bodyWeightRangeLabel(unit: WeightUnit): string {
  const min = trimmed(roundDisplay(toDisplayWeight(BODY_WEIGHT_MIN_KG, unit)));
  const max = trimmed(roundDisplay(toDisplayWeight(BODY_WEIGHT_MAX_KG, unit)));
  return `${min}–${max} ${unit}`;
}

/**
 * Text typed in the user's display unit -> kg for the API, or null if it
 * doesn't parse as a finite number. Accepts a comma decimal separator, same
 * as every weight field in this app already did before unit conversion
 * existed.
 */
export function parseWeightInput(text: string, unit: WeightUnit): number | null {
  const parsed = Number(text.replace(",", "."));
  if (!Number.isFinite(parsed)) return null;
  return fromDisplayWeight(parsed, unit);
}
