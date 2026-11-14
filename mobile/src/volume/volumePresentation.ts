/**
 * Display rules for the weekly volume screen. Nothing here computes volume:
 * counts, landmarks and statuses all come from the API untouched. This only
 * decides how they are worded and where bar markers sit.
 */

import type { MuscleWeeklyVolume, VolumeStatus, WeeklyVolume } from "../api/analytics";

// Zero direct sets is a record of the week, not a claim about the person, so
// the wording describes what was recorded.
export const STATUS_LABELS: Record<VolumeStatus, string> = {
  untrained: "No direct sets recorded",
  below_mev: "Below MEV",
  optimal: "Optimal",
  high: "High",
  above_mrv: "Over MRV",
  no_reference: "No reference range",
};

/**
 * `muscle.name` is the backend's machine code (e.g. "front_delts"), not a
 * display string. Splits on "_" and title-cases each word: "front_delts" ->
 * "Front Delts". Covers every code in the catalogue without a lookup table.
 */
export function formatMuscleName(name: string): string {
  return name
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatWeekRange(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const format = (date: Date) =>
    date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `${format(start)} – ${format(end)}`;
}

/** `offset` is the position in the API's newest-first list: 0 is the current week. */
export function formatWeekTitle(weekStart: string, offset: number): string {
  if (offset === 0) return "This week";
  if (offset === 1) return "Last week";
  return formatWeekRange(weekStart);
}

// ---- week selection ----
//
// The selected week is remembered by its start date, not by its position. A
// reload can shift positions (the first load after Monday adds a new current
// week), and a position would then silently point at a different week.

export function resolveOffset(weeks: WeeklyVolume[], selectedStart: string | null): number {
  if (selectedStart === null) return 0;
  const index = weeks.findIndex((week) => week.week_start === selectedStart);
  return index >= 0 ? index : 0;
}

/** +1 goes to an earlier week, -1 to a later one. Never past either end of the loaded list. */
export function stepWeek(
  weeks: WeeklyVolume[],
  selectedStart: string | null,
  direction: 1 | -1,
): string | null {
  if (weeks.length === 0) return selectedStart;
  const next = Math.min(weeks.length - 1, Math.max(0, resolveOffset(weeks, selectedStart) + direction));
  return weeks[next].week_start;
}

// ---- one muscle ----

export type MuscleView = {
  name: string;
  directSets: number;
  directLabel: string;
  statusLabel: string;
  /** Reference values the API actually provided, in ascending-landmark order. */
  references: string[];
  /**
   * Present only when the API gave all three landmarks. Positions are
   * fractions of `scale`, so the marks and the fill share one real axis;
   * sets above MRV push the MRV mark inward instead of being clipped.
   */
  bar: null | {
    fill: number;
    mev: number;
    mav: number;
    mrv: number;
    overMrv: boolean;
  };
  indirectSets: number;
  effectiveness: number | null;
  accessibilityLabel: string;
};

export function describeMuscle(muscle: MuscleWeeklyVolume): MuscleView {
  const { direct_sets: sets, mev, mav, mrv, status } = muscle;
  const directLabel = `${sets} direct set${sets === 1 ? "" : "s"}`;
  const statusLabel = STATUS_LABELS[status];

  const references = [
    mev !== null ? `MEV ${mev}` : null,
    mav !== null ? `MAV ${mav}` : null,
    mrv !== null ? `MRV ${mrv}` : null,
  ].filter((text): text is string => text !== null);

  let bar: MuscleView["bar"] = null;
  if (mev !== null && mav !== null && mrv !== null) {
    const scale = Math.max(mrv, sets) || 1;
    bar = {
      fill: sets / scale,
      mev: mev / scale,
      mav: mav / scale,
      mrv: mrv / scale,
      overMrv: sets > mrv,
    };
  }

  const indirectSets = Math.max(0, muscle.involved_sets - sets);
  const name = formatMuscleName(muscle.name);

  const parts = [`${name}: ${directLabel}`, statusLabel];
  if (references.length > 0) parts.push(`Reference ${references.join(", ")}`);
  if (indirectSets > 0) {
    parts.push(`${indirectSets} indirect set${indirectSets === 1 ? "" : "s"}, not counted`);
  }

  return {
    name,
    directSets: sets,
    directLabel,
    statusLabel,
    references,
    bar,
    indirectSets,
    effectiveness: muscle.avg_effectiveness,
    accessibilityLabel: `${parts.join(". ")}.`,
  };
}
