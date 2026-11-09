/**
 * Barbell plate calculator: which plates go on each side of a bar for a total.
 *
 * Pure and local — no storage, no React, no network — so the arithmetic can be
 * tested on its own. Everything here is in the user's display unit (kg or lb);
 * nothing converts between units, so a typed "100" in lb stays 100 lb and
 * never passes through the kg-only API representation.
 *
 * The total INCLUDES the bar. Loading is symmetrical, so what is left after
 * the bar is split evenly between the two sides, and the answer is per side.
 * Plate supply is assumed unlimited (enough pairs of every selected size).
 *
 * Why not "take the biggest plate that fits, repeat": that greedy approach
 * misses exact loads. With only 25s and 20s, 40 per side is 20 + 20, but
 * greedy takes a 25 first and is stuck with 15 it cannot make. So this finds
 * the heaviest reachable per-side load not above the target with a small
 * dynamic program, using the fewest plates among those that tie.
 *
 * All sums run on integers (thousandths of a unit). 1.25 + 2.5 + ... in
 * floating point drifts, and "is this exactly reachable" must not depend on
 * that drift. Fractional plates (1.25, 0.25) are therefore preserved exactly.
 */

import type { WeightUnit } from "../units/weight";

/** Resolution of all arithmetic: input and plate sizes are kept to 0.001. */
const SCALE = 1000;
const MAX_DECIMALS = 3;

/** Heaviest total accepted (display unit). Far past any real bar, and bounds the work. */
export const MAX_TOTAL = 2000;
/** Heaviest bar accepted (display unit). */
export const MAX_BAR = 500;

/** Sizes offered in the calculator, heaviest first. */
export const PLATE_OPTIONS: Record<WeightUnit, readonly number[]> = {
  kg: [25, 20, 15, 10, 5, 2.5, 1.25, 1, 0.5, 0.25],
  lb: [100, 45, 35, 25, 10, 5, 2.5, 1.25],
};

export type PlatePreference = { bar: number; plates: number[] };

/** Separate per unit: a 20 kg bar is not a 20 lb bar, and 45 lb plates are not 45 kg ones. */
export const DEFAULT_PLATE_PREFERENCE: Record<WeightUnit, PlatePreference> = {
  kg: { bar: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] },
  lb: { bar: 45, plates: [45, 35, 25, 10, 5, 2.5] },
};

export type PlateCount = { size: number; count: number };

export type PlateInvalidField = "total" | "bar";

export type PlateResult =
  | { status: "invalid"; field: PlateInvalidField; reason: "blank" | "invalid" | "too-large" }
  /** Total is under the bar: nothing to load. */
  | { status: "below-bar"; bar: number; total: number }
  /** Total is exactly the bar: lift it empty. */
  | { status: "bar-only"; bar: number; total: number }
  | { status: "exact"; bar: number; total: number; perSide: PlateCount[] }
  /** Not reachable: the closest total at or below the request. */
  | {
      status: "closest";
      bar: number;
      requested: number;
      total: number;
      shortfall: number;
      perSide: PlateCount[];
    }
  /** Something is over the bar but no plate size is selected. */
  | { status: "no-plates"; bar: number; total: number };

/**
 * Text -> number, or null for blank/invalid. Accepts "87.5" and "87,5".
 *
 * Stricter than Number(): that turns "" into 0 and accepts "1e3" and "0x10",
 * none of which is a weight someone typed. At most three decimals, so a value
 * is never silently rounded into looking exactly loadable.
 */
export function parseDecimalInput(text: string): number | null {
  const trimmed = text.trim();
  const match = /^(\d*)[.,]?(\d*)$/.exec(trimmed);
  if (!match || trimmed === "" || trimmed === "." || trimmed === ",") return null;
  const [, whole, fraction] = match;
  if (whole === "" && fraction === "") return null;
  if (fraction.length > MAX_DECIMALS) return null;
  return Number(`${whole === "" ? "0" : whole}.${fraction === "" ? "0" : fraction}`);
}

function toMilli(value: number): number {
  return Math.round(value * SCALE);
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * The heaviest per-side load <= `limit` made of `sizes`, fewest plates among
 * equals. All values are integer thousandths. Returns the counts per size.
 */
function bestPerSide(limit: number, sizes: number[]): { amount: number; counts: Map<number, number> } {
  // Every reachable amount is a multiple of the gcd, so the table only needs a
  // slot per multiple: 1000 kg per side with 0.25 plates is 4000 slots, not 1M.
  const step = sizes.reduce((acc, size) => gcd(acc, size), 0);
  const slots = Math.floor(limit / step);
  const coins = sizes.map((size) => size / step).sort((a, b) => b - a);

  // fewest[a] = fewest plates summing to a slots; Infinity = unreachable.
  const fewest = new Array<number>(slots + 1).fill(Infinity);
  const last = new Array<number>(slots + 1).fill(0);
  fewest[0] = 0;
  for (let amount = 1; amount <= slots; amount++) {
    // Heaviest coin first and a strict "<": among equally short answers the
    // one built on the heavier plate wins, so the choice is deterministic.
    for (const coin of coins) {
      if (coin > amount) continue;
      const candidate = fewest[amount - coin] + 1;
      if (candidate < fewest[amount]) {
        fewest[amount] = candidate;
        last[amount] = coin;
      }
    }
  }

  let best = slots;
  while (best > 0 && fewest[best] === Infinity) best--;

  const counts = new Map<number, number>();
  for (let amount = best; amount > 0; amount -= last[amount]) {
    const size = last[amount] * step;
    counts.set(size, (counts.get(size) ?? 0) + 1);
  }
  return { amount: best * step, counts };
}

function fromMilli(milli: number): number {
  return milli / SCALE;
}

/**
 * The plates for one side of the bar.
 *
 * @param totalText what the user typed for the total weight (bar included)
 * @param barText   what the user typed for the bar weight
 * @param plates    selected plate sizes, in the display unit
 */
export function calculatePlates(totalText: string, barText: string, plates: readonly number[]): PlateResult {
  const total = parseDecimalInput(totalText);
  if (total === null) {
    return { status: "invalid", field: "total", reason: totalText.trim() === "" ? "blank" : "invalid" };
  }
  const bar = parseDecimalInput(barText);
  if (bar === null) {
    return { status: "invalid", field: "bar", reason: barText.trim() === "" ? "blank" : "invalid" };
  }
  if (total > MAX_TOTAL) return { status: "invalid", field: "total", reason: "too-large" };
  if (bar > MAX_BAR) return { status: "invalid", field: "bar", reason: "too-large" };

  const totalMilli = toMilli(total);
  const barMilli = toMilli(bar);

  if (totalMilli < barMilli) return { status: "below-bar", bar, total };
  if (totalMilli === barMilli) return { status: "bar-only", bar, total };

  const sizes = [...new Set(plates.map(toMilli).filter((size) => size > 0))];
  if (sizes.length === 0) return { status: "no-plates", bar, total };

  const perSideLimit = Math.floor((totalMilli - barMilli) / 2);
  const { amount, counts } = bestPerSide(perSideLimit, sizes);

  const perSide: PlateCount[] = [...counts.entries()]
    .sort(([a], [b]) => b - a)
    .map(([size, count]) => ({ size: fromMilli(size), count }));

  const achievedMilli = barMilli + 2 * amount;
  if (achievedMilli === totalMilli) {
    return { status: "exact", bar, total, perSide };
  }
  // Even the lightest plate is too heavy for one side: the bar alone is the closest.
  if (amount === 0) {
    return {
      status: "closest",
      bar,
      requested: total,
      total: fromMilli(barMilli),
      shortfall: fromMilli(totalMilli - barMilli),
      perSide: [],
    };
  }
  return {
    status: "closest",
    bar,
    requested: total,
    total: fromMilli(achievedMilli),
    shortfall: fromMilli(totalMilli - achievedMilli),
    perSide,
  };
}

/**
 * What the calculator opens with for a set's weight draft: the draft itself
 * when it is a usable number, otherwise empty. The calculator only ever reads
 * this once; editing it afterwards never reaches the draft.
 */
export function initialPlateTotal(draftWeight: string | undefined): string {
  if (draftWeight === undefined) return "";
  return parseDecimalInput(draftWeight) === null ? "" : draftWeight.trim();
}

/** "20", "1.25", never "20.000" or "1.2500000000000002". */
export function formatPlateNumber(value: number): string {
  return String(Math.round(value * SCALE) / SCALE);
}

/** One string for a screen reader: "1 × 20 kg, 1 × 10 kg". The screen shows the same plates as separate rows. */
export function describePerSide(perSide: readonly PlateCount[], unit: WeightUnit): string {
  if (perSide.length === 0) return "no plates";
  return perSide.map(({ size, count }) => `${count} × ${formatPlateNumber(size)} ${unit}`).join(", ");
}

/** Keep only a preference that is usable; anything else falls back to this unit's defaults. */
export function sanitizePlatePreference(value: unknown, unit: WeightUnit): PlatePreference {
  const defaults = DEFAULT_PLATE_PREFERENCE[unit];
  if (typeof value !== "object" || value === null) return { bar: defaults.bar, plates: [...defaults.plates] };
  const { bar, plates } = value as { bar?: unknown; plates?: unknown };
  const validBar = typeof bar === "number" && Number.isFinite(bar) && bar >= 0 && bar <= MAX_BAR
    && toMilli(bar) / SCALE === bar ? bar : defaults.bar;
  // An empty list is a real choice (nothing selected); only a missing/garbled one resets.
  const validPlates = Array.isArray(plates)
    ? PLATE_OPTIONS[unit].filter((size) => plates.includes(size))
    : [...defaults.plates];
  return { bar: validBar, plates: validPlates };
}
