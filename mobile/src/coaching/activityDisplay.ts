import type { AthleteActivity } from "../api/coaching";
import { formatConnectedDate } from "./presentation";

/**
 * Words for a roster card's recorded activity. Facts only: no ranking, no
 * "inactive" wording, no judgement. A missing summary (sharing off) is
 * "unavailable", never zero, and a sharer with nothing recorded is "no
 * completed workouts recorded", never "has not trained".
 */

export type ActivityDescription =
  | { kind: "off"; text: string }
  | { kind: "none"; text: string }
  | {
      kind: "recorded";
      /** "Latest: Push · 3 Nov 2026", or null when the server sent no latest workout. */
      latest: string | null;
      /** "Recorded in the last 28 days" */
      period: string;
      /** "3 workouts · 11 working sets" */
      counts: string;
    };

export const SHARING_OFF = "Workout sharing is off";
export const NOTHING_RECORDED = "No completed workouts recorded";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function describeActivity(activity: AthleteActivity | null, days: number): ActivityDescription {
  if (activity === null) return { kind: "off", text: SHARING_OFF };
  if (activity.latest_workout === null && activity.workouts_in_window === 0) {
    return { kind: "none", text: NOTHING_RECORDED };
  }
  const latest = activity.latest_workout;
  const date = latest ? formatConnectedDate(latest.performed_at) : "";
  const name = latest ? latest.title?.trim() || "Untitled workout" : null;
  return {
    kind: "recorded",
    latest: name ? (date ? `Latest: ${name} · ${date}` : `Latest: ${name}`) : null,
    period: `Recorded in the last ${plural(days, "day", "days")}`,
    counts: `${plural(activity.workouts_in_window, "workout", "workouts")} · ${plural(
      activity.working_sets_in_window,
      "working set",
      "working sets",
    )}`,
  };
}

/** One sentence for the card's accessibility label. */
export function activityLabel(description: ActivityDescription): string {
  if (description.kind !== "recorded") return description.text;
  return [description.latest, `${description.period}: ${description.counts}`]
    .filter((part): part is string => part !== null)
    .join(". ");
}
