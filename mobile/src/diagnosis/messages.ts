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

function weightInterval(data: Finding["data"]): string {
  const { first_measured_on: first, last_measured_on: last, span_days: days,
    measurement_count: count } = data;
  if (typeof first === "string" && typeof last === "string" &&
      typeof days === "number" && typeof count === "number") {
    return `Between ${first} and ${last} (${days} days; ${count} weigh-ins)`;
  }
  // Older servers cannot tell us the actual interval; never substitute the selector.
  return "Between the first and last recorded weigh-ins";
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
      const bulk = finding.code === "weight_stalled_bulk";
      return {
        title: bulk ? "No clear weight increase recorded" : "No clear weight decrease recorded",
        description: `${weightInterval(data)}: ${signed(changeKg)} kg (${signed(changePct)}%).`,
        action: "Keep recording under similar conditions and review the pattern. These measurements alone do not explain the cause.",
      };
    }

    case "weight_on_track": {
      const changeKg = data.change_kg as number;
      const changePct = data.change_pct as number;
      return {
        title: "Recorded weight change matches your goal's direction",
        description: `${weightInterval(data)}: ${signed(changeKg)} kg (${signed(changePct)}%).`,
        action: "Keep tracking the pattern. Direction alone does not show whether the pace is appropriate.",
      };
    }

    case "weight_no_data": {
      const weeks = data.weeks as number;
      const count = data.measurement_count;
      const requiredDays = typeof data.required_span_days === "number" ? data.required_span_days : 14;
      if (data.reason === "short_span") {
        return {
          title: "Weigh-ins are too close together",
          description: `${weightInterval(data)}. At least ${requiredDays} days between measurements are needed for this comparison.`,
          action: "Continue logging, or select a wider period if you have older weigh-ins.",
        };
      }
      if (data.reason === "stale_measurements") {
        return {
          title: "A recent weigh-in is needed",
          description: `${weightInterval(data)}. The latest weigh-in was ${data.latest_age_days} days ago.`,
          action: "Add a current measurement before interpreting this as your current trend.",
        };
      }
      return {
        title: "Not enough weigh-ins",
        description: typeof count === "number"
          ? `${count} weigh-in${count === 1 ? "" : "s"} in the selected ${weeks}-week period.`
          : `Too few weigh-ins in the selected ${weeks}-week period.`,
        action: `Record at least two measurements spanning ${requiredDays} days, including one from the past 7 days.`,
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
