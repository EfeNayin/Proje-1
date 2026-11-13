/**
 * The "Why am I not growing?" screen's view model: what the assessment rests on (per
 * domain, with its own dates) and the short list of observations it supports, each with
 * a suggestion and a real destination in the app.
 *
 * Everything here is a plain reading of what the user recorded. Rules this file keeps:
 * - A missing record is unknown, never zero: no training record is not "no training",
 *   no sleep record is not "zero hours".
 * - Body weight is total body weight: it does not measure muscle growth.
 * - Nothing says why progress is slow. Observations are things worth checking.
 * - Training, sleep and weight each have their own state, window and dates; the whole
 *   assessment is never called complete.
 * The server sends codes and numbers, never text (see messages.ts).
 */

import type {
  DiagnosisResponse,
  DomainCoverage,
  DomainState,
  Finding,
} from "../api/analytics";
import { describeFinding, describeTrainingCoverage } from "./messages";

export type DomainKey = "training" | "sleep" | "weight";

/** A place in the app. Resolved to a route by hrefFor; research ids are existing library entries. */
export type ActionTarget =
  | { kind: "daily-checkin" }
  | { kind: "weight-history" }
  | { kind: "nutrition-goals" }
  | { kind: "volume" }
  | { kind: "training-records" }
  | { kind: "research"; id: string };

export type AssessmentAction = {
  label: string;
  hint: string;
  target: ActionTarget;
};

export type DomainView = {
  key: DomainKey;
  title: string;
  state: DomainState;
  /** A word, never colour alone. */
  stateLabel: string;
  /** What window was searched, in actual dates. */
  windowText: string;
  /** What was found in it, in actual dates. */
  recordsText: string;
  note: string;
  actions: AssessmentAction[];
};

export type ObservationKind = "check" | "consistent";

export type ObservationView = {
  key: string;
  domain: DomainKey;
  kind: ObservationKind;
  title: string;
  description: string;
  /** A suggestion, not a conclusion about cause. */
  suggestion: string;
  actions: AssessmentAction[];
};

export type EmptyKind = "insufficient" | "nothing-found";

export type AssessmentView = {
  domains: DomainView[];
  observations: ObservationView[];
  /** Set only when there are no observations; says what that does and does not mean. */
  empty: { kind: EmptyKind; title: string; text: string } | null;
  /** Always shown: what this reading is and is not. */
  limitations: string[];
  /** Shown only when a volume observation is: where the reference numbers come from. */
  referenceNote: string | null;
  sufficientCount: number;
};

export const LIMITATIONS: readonly string[] = [
  "This is a rule-based reading of what you recorded. It cannot tell why progress is slow, and it does not measure muscle growth.",
  "Anything you did not record is unknown, not zero: a missing session, night of sleep or weigh-in is not evidence that it did not happen.",
  "Effort is not part of this reading. A set logged without RIR is unknown, not low effort.",
];

export const VOLUME_REFERENCE_NOTE =
  "The set ranges (MEV and MRV) are general reference numbers: midpoints of volume ranges published by Renaissance Periodization, a coaching organisation. They are population-level starting points, not peer-reviewed limits, and they have not been validated for you.";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-04" → "Sep 4, 2026", without a Date (no timezone can shift the day). */
export function formatDay(iso: string | null): string {
  const match = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  if (!match) return "";
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${month} ${Number(match[3])}, ${match[1]}` : "";
}

function range(start: string | null, end: string | null): string {
  const from = formatDay(start);
  const to = formatDay(end);
  if (from && to) return from === to ? from : `${from} to ${to}`;
  return from || to;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

const STATE_LABEL: Record<DomainState, string> = {
  sufficient: "Enough records",
  insufficient: "Not enough records",
  stale: "Records out of date",
  missing: "No records",
  not_applicable: "Not applicable",
};

// ── Destinations ────────────────────────────────────────────────────────

/** Every route here is an existing screen; research ids are existing library entries. */
export function hrefFor(target: ActionTarget): string {
  switch (target.kind) {
    case "daily-checkin":
      return "/daily-checkin";
    case "weight-history":
      return "/profile/weight-history";
    case "nutrition-goals":
      return "/profile/nutrition-goals";
    case "volume":
      return "/volume";
    case "training-records":
      // Completed sessions live on the History tab ("/" is Start Workout now).
      return "/history";
    case "research":
      return `/research/${target.id}`;
  }
}

const checkin: AssessmentAction = {
  label: "Log today's sleep",
  hint: "Opens the daily check-in. No workout is started.",
  target: { kind: "daily-checkin" },
};
const weighIn: AssessmentAction = {
  label: "Add a weigh-in",
  hint: "Opens weight history, where you can add a measurement",
  target: { kind: "weight-history" },
};
const weightHistory: AssessmentAction = {
  label: "Open weight history",
  hint: "Opens your recorded weigh-ins",
  target: { kind: "weight-history" },
};
const setGoal: AssessmentAction = {
  label: "Set a nutrition goal",
  hint: "Opens nutrition goals, where the goal is chosen",
  target: { kind: "nutrition-goals" },
};
const openVolume: AssessmentAction = {
  label: "Open Volume",
  hint: "Opens your weekly sets per muscle",
  target: { kind: "volume" },
};
const reviewTraining: AssessmentAction = {
  label: "Review training records",
  hint: "Opens your recorded workouts on the History tab",
  target: { kind: "training-records" },
};
const research = (id: string, label: string): AssessmentAction => ({
  label,
  hint: "Opens a short Turkish explanation based on published studies",
  target: { kind: "research", id },
});

// ── Domains ─────────────────────────────────────────────────────────────

function trainingView(result: DiagnosisResponse, domain: DomainCoverage): DomainView {
  const coverage = result.training_coverage;
  const windowText = domain.period_start
    ? `Completed weeks ${range(domain.period_start, domain.period_end)}`
    : "No completed training week to evaluate yet";
  const base = { key: "training" as const, title: "Training", state: domain.state,
    stateLabel: STATE_LABEL[domain.state], windowText };

  switch (domain.reason) {
    case null:
      return { ...base,
        recordsText: coverage ? describeTrainingCoverage(coverage)
          : `${plural(domain.record_count, "session")} with recorded working sets.`,
        note: "Working sets only: warm-ups and sets without reps do not count. A week without records stays in the average and may only mean the session was not logged.",
        actions: [openVolume, research("weekly-volume", "Read: weekly sets")] };
    case "no_completed_week":
      return { ...base,
        recordsText: "Sessions exist, but only in the first recorded week or the week in progress.",
        note: "Whole weeks are compared, and the first recorded week and the current week are left out. Keep logging and this fills in.",
        actions: [reviewTraining] };
    case "too_few_weeks_with_work":
      return { ...base,
        recordsText: `${plural(domain.record_count, "session")} with working sets, in ${coverage ? plural(coverage.weeks_with_work, "week") : "too few weeks"} of the ${coverage?.completed_weeks ?? "completed"} evaluated.`,
        note: `Working sets are needed in at least ${coverage?.required_weeks_with_work ?? 2} completed weeks. Choose a wider period if you have older records.`,
        actions: [reviewTraining] };
    default:
      return { ...base,
        recordsText: "No working sets were recorded in this period.",
        note: "That describes what was recorded, not what you did: sessions that were never logged cannot be counted.",
        actions: [reviewTraining] };
  }
}

function sleepView(domain: DomainCoverage): DomainView {
  const base = { key: "sleep" as const, title: "Sleep", state: domain.state,
    stateLabel: STATE_LABEL[domain.state],
    windowText: `Window ${range(domain.period_start, domain.period_end)} (through today)` };
  const found = domain.record_count > 0
    ? `${plural(domain.record_count, "night")} recorded, ${range(domain.first_recorded_on, domain.last_recorded_on)}; the latest is ${plural(domain.latest_age_days ?? 0, "day")} old.`
    : "No sleep recorded in this window.";
  const unknown = "A night without a record is unknown, not counted as zero hours.";
  switch (domain.reason) {
    case null:
      return { ...base, recordsText: found, note: unknown,
        actions: [checkin, research("sleep-and-recovery", "Read: sleep and recovery")] };
    case "stale_records":
      return { ...base, recordsText: found,
        note: "The newest record is more than 7 days old, so it cannot describe your current sleep.",
        actions: [checkin] };
    case "too_few_nights":
      return { ...base, recordsText: found,
        note: `At least 3 recorded nights are needed. ${unknown}`, actions: [checkin] };
    default:
      return { ...base, recordsText: found, note: unknown, actions: [checkin] };
  }
}

function weightView(domain: DomainCoverage): DomainView {
  const base = { key: "weight" as const, title: "Body weight", state: domain.state,
    stateLabel: STATE_LABEL[domain.state],
    windowText: `Window ${range(domain.period_start, domain.period_end)} (through today)` };
  const found = domain.record_count > 0
    ? `${plural(domain.record_count, "weigh-in")}, ${range(domain.first_recorded_on, domain.last_recorded_on)}; the latest is ${plural(domain.latest_age_days ?? 0, "day")} old.`
    : "No weigh-ins in this window.";
  const meaning = "This is total body weight: it does not separate muscle from fat or water.";
  switch (domain.reason) {
    case null:
      return { ...base, recordsText: found, note: meaning,
        actions: [weightHistory, research("body-weight-changes", "Read: body weight changes")] };
    case "no_goal":
      return { ...base, recordsText: found,
        note: "Weight direction is only compared against a bulk or cut goal, and none is set.",
        actions: [setGoal, weightHistory] };
    case "goal_maintain":
      return { ...base, recordsText: found,
        note: "Your goal is to maintain, so no direction is compared.", actions: [weightHistory] };
    case "stale_measurements":
      return { ...base, recordsText: found,
        note: "The newest weigh-in is more than 7 days old, so it cannot describe your current trend.",
        actions: [weighIn] };
    case "short_span":
      return { ...base, recordsText: found,
        note: "Weigh-ins need to span at least 14 days to compare. Continue logging, or choose a wider period.",
        actions: [weighIn] };
    default:
      return { ...base, recordsText: found,
        note: "At least two weigh-ins spanning 14 days, one within the last 7 days, are needed.",
        actions: [weighIn] };
  }
}

// ── Observations ────────────────────────────────────────────────────────

/** Coverage findings are shown with their domain, not as observations. */
const COVERAGE_CODES: readonly Finding["code"][] = ["readiness_no_data", "weight_no_data"];

const GOOD_CODES: readonly Finding["code"][] = ["weight_on_track", "training_consistent"];

function domainOf(code: Finding["code"]): DomainKey {
  if (code.startsWith("sleep") || code.startsWith("readiness")) return "sleep";
  if (code.startsWith("weight")) return "weight";
  return "training";
}

function actionsFor(code: Finding["code"]): AssessmentAction[] {
  switch (code) {
    case "volume_below_mev":
    case "volume_above_mrv":
    case "muscles_untrained":
      return [openVolume, research("weekly-volume", "Read: weekly sets")];
    case "sleep_low":
    case "sleep_very_low":
      return [checkin, research("sleep-and-recovery", "Read: sleep and recovery")];
    case "weight_stalled_bulk":
    case "weight_stalled_cut":
    case "weight_on_track":
      return [weightHistory, research("body-weight-changes", "Read: body weight changes")];
    case "training_infrequent":
      return [reviewTraining, research("training-frequency", "Read: training frequency")];
    case "training_consistent":
      return [reviewTraining];
    default:
      return [];
  }
}

/** The code alone can repeat (one per muscle or region), so fold in what tells them apart. */
function findingKey(finding: Finding): string {
  const discriminator = finding.data.muscle ?? finding.data.region;
  return discriminator ? `${finding.code}-${String(discriminator)}` : finding.code;
}

/**
 * Things worth checking come first, in the order the server ranked them (largest volume
 * gaps first, then sleep, then weight, then frequency); readings that match expectations
 * follow. Observations are suggestions to look at records, never a stated cause.
 */
export function buildObservations(findings: Finding[]): ObservationView[] {
  const shown = findings.filter((finding) => !COVERAGE_CODES.includes(finding.code));
  const views = shown.map((finding): ObservationView => {
    const copy = describeFinding(finding);
    return {
      key: findingKey(finding),
      domain: domainOf(finding.code),
      kind: GOOD_CODES.includes(finding.code) ? "consistent" : "check",
      title: copy.title,
      description: copy.description,
      suggestion: copy.action,
      actions: actionsFor(finding.code),
    };
  });
  return [...views.filter((v) => v.kind === "check"), ...views.filter((v) => v.kind === "consistent")];
}

const VOLUME_CODES: readonly Finding["code"][] = [
  "volume_below_mev",
  "volume_above_mrv",
  "muscles_untrained",
];

// ── The whole assessment ────────────────────────────────────────────────

export function buildAssessment(result: DiagnosisResponse): AssessmentView {
  const domains = result.domains;
  const views: DomainView[] = domains
    ? [trainingView(result, domains.training), sleepView(domains.sleep), weightView(domains.weight)]
    : [];
  const observations = buildObservations(result.findings);
  const sufficientCount = views.filter((view) => view.state === "sufficient").length;

  let empty: AssessmentView["empty"] = null;
  if (observations.length === 0) {
    empty = sufficientCount === 0
      ? { kind: "insufficient", title: "Not enough records to say anything yet",
          text: "None of the three areas has enough records for this period. Add records where suggested above; nothing here is a finding about your training." }
      : { kind: "nothing-found", title: "No observations from the records that are sufficient",
          text: "That does not mean your training or recovery is adequate: areas without enough records were not assessed, and this reading only covers what these rules look at." };
  }

  return {
    domains: views,
    observations,
    empty,
    limitations: [...LIMITATIONS],
    referenceNote: result.findings.some((f) => VOLUME_CODES.includes(f.code))
      ? VOLUME_REFERENCE_NOTE : null,
    sufficientCount,
  };
}
