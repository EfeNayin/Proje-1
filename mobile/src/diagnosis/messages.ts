/**
 * Turns a Finding (code + data) into what the diagnosis screen shows.
 *
 * The server deliberately never sends message text — see
 * src/api/analytics.ts — so this is the one place that owns the copy. When
 * translation lands, this file is what gets a second implementation, not
 * the endpoint.
 */

import type { Finding, TrainingCoverage } from "../api/analytics";

export function describeTrainingCoverage(coverage: TrainingCoverage): string {
  if (!coverage.period_start) {
    return "No completed training weeks are available after your first recorded week yet.";
  }
  return `Training: ${coverage.period_start} to ${coverage.period_end}. ` +
    `${coverage.sessions} recorded sessions across ${coverage.completed_weeks} completed weeks; ` +
    `${coverage.weeks_with_work} weeks contain working sets. ` +
    "The current week and your first recorded week are excluded. Weeks without records remain in the average; they may reflect missing logs.";
}

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

function sleepCoverage(data: Finding["data"]): string {
  if (typeof data.days_total !== "number" || typeof data.period_start !== "string" ||
      typeof data.period_end !== "string") {
    return "This describes recorded nights only; missing nights are unknown.";
  }
  const dates = typeof data.first_logged_on === "string" && typeof data.last_logged_on === "string"
    ? ` Sleep records: ${data.first_logged_on} to ${data.last_logged_on}.` : "";
  return `${data.nights_total} of ${data.days_total} days have sleep records in ` +
    `${data.period_start} to ${data.period_end}.${dates} Missing nights are unknown.`;
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
      // English, matching the rest of this file's copy — muscle_tr also
      // comes down the wire (see backend/app/domains/analytics/service.py)
      // but is reserved for the future translated implementation this file
      // itself defers to (see the file header comment); mixing it into an
      // otherwise-English sentence read as broken text, not localization.
      const muscle = data.muscle as string;
      const avgSets = data.avg_sets as number;
      const mev = data.mev as number;
      const weeksTotal = data.weeks_total as number;
      return {
        title: `${muscle}: low recorded volume`,
        description: `Averaging ${avgSets} recorded sets/week across ${weeksTotal} evaluated weeks, below the ${mev}-set reference (MEV).`,
        action: "Check that your logs are complete before using this reference to adjust your program.",
      };
    }

    case "volume_above_mrv": {
      const muscle = data.muscle as string;
      const avgSets = data.avg_sets as number;
      const mrv = data.mrv as number;
      return {
        title: `${muscle}: high recorded volume`,
        description: `Averaging ${avgSets} recorded sets/week in the evaluated training period, above the ${mrv}-set reference (MRV).`,
        action: "Cut back a few sets, or make sure sleep and nutrition can support this volume.",
      };
    }

    case "muscles_untrained": {
      const region = data.region as string;
      const count = data.count as number;
      const muscles = data.muscles as string[];
      return {
        title: `${REGION_TITLES[region] ?? region}: ${count} muscle${count === 1 ? "" : "s"} without direct-work records`,
        description: `No direct working sets were recorded for ${muscles.join(", ")} in the evaluated training period.`,
        action: "Check that your logs are complete before changing your program.",
      };
    }

    case "sleep_low":
    case "sleep_very_low": {
      const avgHours = data.avg_hours as number;
      const nightsUnder7 = data.nights_under_7 as number;
      const nightsTotal = data.nights_total as number;
      const critical = finding.code === "sleep_very_low";
      return {
        title: critical ? "Very low sleep in recorded nights" : "Low sleep in recorded nights",
        description: `Recorded-night average: ${avgHours}h (${nightsUnder7}/${nightsTotal} recorded nights under 7h). ` + sleepCoverage(data),
        action: "Log sleep on rest days too. Missing nights are unknown; these records alone do not establish the cause of your progress.",
      };
    }

    case "readiness_no_data": {
      const nightsTotal = data.nights_total as number;
      if (data.reason === "stale_records") {
        return {
          title: "Recent sleep records are needed",
          description: `${sleepCoverage(data)} The latest sleep record was ${data.latest_age_days} days ago.`,
          action: "Add current sleep records before interpreting this as your current recovery.",
        };
      }
      return {
        title: "Not enough check-in data",
        description: `${nightsTotal} recorded night${nightsTotal === 1 ? "" : "s"}; at least 3 are needed for a recorded-night comparison. ${sleepCoverage(data)}`,
        action: "Log sleep on training and rest days, including a record from the past 7 days.",
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
        title: consistent ? "Training recorded consistently" : "Fewer than two recorded sessions per week",
        description: `Averaging ${avgPerWeek} recorded sessions/week across ${weeksTotal} evaluated weeks.`,
        action: consistent
          ? "Keep it up."
          : "Check for missing logs before using this average to adjust your schedule.",
      };
    }
  }
}
