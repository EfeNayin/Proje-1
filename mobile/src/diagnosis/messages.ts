/**
 * Turns a Finding (code + data) into what the diagnosis screen shows.
 *
 * The server deliberately never sends message text — see
 * src/api/analytics.ts — so this is the one place that owns the copy. When
 * translation lands, this file is what gets a second implementation, not
 * the endpoint.
 */

import type { Finding } from "../api/analytics";

export type FindingCopy = {
  title: string;
  description: string;
  /** What to do about it — every finding gets one, not just the bad ones. */
  action: string;
};

const REGION_TITLES: Record<string, string> = {
  upper: "Upper body",
  lower: "Lower body",
  core: "Core",
};

function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

// Each branch reads `data` under the shape documented in
// backend/app/domains/analytics/service.py for that code — the wire type is
// a plain object, so this is the one place that assumes the field list.
export function describeFinding(finding: Finding): FindingCopy {
  const data = finding.data;

  switch (finding.code) {
    case "volume_below_mev": {
      const muscle = data.muscle_tr as string;
      const avgSets = data.avg_sets as number;
      const mev = data.mev as number;
      const weeksTotal = data.weeks_total as number;
      return {
        title: `${muscle} is under-trained`,
        description: `Averaging ${avgSets} sets/week over the last ${weeksTotal}, below the ${mev}-set minimum (MEV) for growth.`,
        action: `Add 2-3 sets a week until you're consistently at or above ${mev}.`,
      };
    }

    case "volume_above_mrv": {
      const muscle = data.muscle_tr as string;
      const avgSets = data.avg_sets as number;
      const mrv = data.mrv as number;
      return {
        title: `${muscle} may be overtrained`,
        description: `Averaging ${avgSets} sets/week, above the ${mrv}-set recoverable maximum (MRV).`,
        action: "Cut back a few sets, or make sure sleep and nutrition can support this volume.",
      };
    }

    case "muscles_untrained": {
      const region = data.region as string;
      const count = data.count as number;
      const muscles = data.muscles as string[];
      return {
        title: `${REGION_TITLES[region] ?? region}: ${count} muscle${count === 1 ? "" : "s"} untrained`,
        description: `${muscles.join(", ")} got no direct work in this period.`,
        action: "Add at least one exercise for each so they're not skipped entirely.",
      };
    }

    case "sleep_low":
    case "sleep_very_low": {
      const avgHours = data.avg_hours as number;
      const nightsUnder7 = data.nights_under_7 as number;
      const nightsTotal = data.nights_total as number;
      const critical = finding.code === "sleep_very_low";
      return {
        title: critical ? "Sleep is critically low" : "Sleep is running low",
        description: `Averaging ${avgHours}h a night (${nightsUnder7}/${nightsTotal} nights under 7h).`,
        action: critical
          ? "This will blunt recovery and progress. Prioritise sleep before adding more volume."
          : "Recovery matters as much as volume — aim for 7+ hours.",
      };
    }

    case "readiness_no_data": {
      const nightsTotal = data.nights_total as number;
      return {
        title: "Not enough check-in data",
        description: `Only ${nightsTotal} night${nightsTotal === 1 ? "" : "s"} logged in this period — too few to read a trend.`,
        action: "Log a check-in before your next few sessions.",
      };
    }

    case "weight_stalled_bulk":
    case "weight_stalled_cut": {
      const changeKg = data.change_kg as number;
      const changePct = data.change_pct as number;
      const weeks = data.weeks as number;
      const bulk = finding.code === "weight_stalled_bulk";
      return {
        title: bulk ? "Weight isn't moving on a bulk" : "Weight isn't moving on a cut",
        description: `${signed(changeKg)} kg (${signed(changePct)}%) over the last ${weeks} weeks.`,
        action: bulk
          ? "You're likely not eating enough. Increase your calorie goal."
          : "You're likely not in a deficit. Lower your calorie goal or double-check intake.",
      };
    }

    case "weight_on_track": {
      const changeKg = data.change_kg as number;
      const changePct = data.change_pct as number;
      const weeks = data.weeks as number;
      return {
        title: "Weight is on track",
        description: `${signed(changeKg)} kg (${signed(changePct)}%) over the last ${weeks} weeks, matching your goal.`,
        action: "Keep doing what you're doing.",
      };
    }

    case "weight_no_data": {
      const weeks = data.weeks as number;
      return {
        title: "Not enough weigh-ins",
        description: `Too few weigh-ins in the last ${weeks} weeks to read a trend.`,
        action: "Log your weight at least twice a week to track this.",
      };
    }

    case "training_infrequent":
    case "training_consistent": {
      const avgPerWeek = data.avg_per_week as number;
      const weeksTotal = data.weeks_total as number;
      const consistent = finding.code === "training_consistent";
      return {
        title: consistent ? "Training consistently" : "Training less than twice a week",
        description: `Averaging ${avgPerWeek} sessions/week over the last ${weeksTotal}.`,
        action: consistent
          ? "Keep it up."
          : "Consistency drives growth more than any single session. Aim for at least 3/week.",
      };
    }
  }
}
