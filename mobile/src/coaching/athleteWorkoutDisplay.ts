import type { AthleteSet, AthleteWorkoutSummary } from "../api/coaching";
import { formatWeight } from "../units/weight";
import type { WeightUnit } from "../units/weight";

/**
 * How a coach's read-only screens word an athlete's sessions. The meanings are
 * the ones the athlete's own history already uses: a duration only exists when
 * Finish was pressed, and a session closed automatically or by an older app
 * version has none.
 */

export function formatSessionDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}

export function formatSessionDuration(performedAt: string, finishedAt: string): string {
  const seconds = Math.max(
    0,
    Math.floor((new Date(finishedAt).getTime() - new Date(performedAt).getTime()) / 1000),
  );
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** Real duration only when the athlete pressed Finish; otherwise say it is not known. */
export function durationText(
  session: Pick<AthleteWorkoutSummary, "performed_at" | "finished_at" | "finished_automatically">,
): string {
  if (session.finished_automatically === false) {
    return formatSessionDuration(session.performed_at, session.finished_at);
  }
  return session.finished_automatically ? "Auto-closed · duration unknown" : "Duration unavailable";
}

export function setCountText(totalSets: number): string {
  return `${totalSets} ${totalSets === 1 ? "set" : "sets"}`;
}

/** "W" for a warm-up, otherwise the set's number. */
export function setBadgeText(set: Pick<AthleteSet, "is_warmup" | "set_number">): string {
  return set.is_warmup ? "W" : String(set.set_number);
}

/** Weight in the viewer's unit with the unit written out; 0 is a real weight. */
export function setWeightText(set: Pick<AthleteSet, "weight_kg">, unit: WeightUnit): string {
  return formatWeight(Number(set.weight_kg), unit);
}

/** "RIR 0" is a recorded value; a set without one says so instead of staying blank. */
export function rirText(rir: number | null): string {
  return rir == null ? "RIR not logged" : `RIR ${rir}`;
}
