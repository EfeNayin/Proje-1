/** Training analytics endpoints. */

import { apiRequest } from "./client";

/**
 * Where a muscle's weekly work sits against its landmarks.
 *
 * "untrained" is separate from "below_mev" on purpose: zero sets and a few
 * sets call for different nudges — one is "you skipped this", the other is
 * "you are close, add a couple".
 */
/**
 * "no_reference": no published MEV/MAV/MRV for this muscle — the count has
 * nothing to be judged against. Distinct from "optimal", which means the
 * count sits inside a real range; every current seed muscle has one, so this
 * only appears once a muscle is added without landmarks (see
 * PROJE_1_CODEX_INCELEME.md Adım 17).
 */
export type VolumeStatus = "untrained" | "below_mev" | "optimal" | "high" | "above_mrv" | "no_reference";

export type MuscleWeeklyVolume = {
  muscle_group_id: number;
  name: string;
  name_tr: string;
  region: "upper" | "lower" | "core";

  /**
   * Sets whose exercise trains this muscle directly. The number the landmarks
   * are read against — indirect work from pressing and pulling is already
   * priced into MEV/MAV/MRV, so counting it again would inflate everything.
   */
  direct_sets: number;
  /** Adds sets where the muscle only assisted. Context, not a target. */
  involved_sets: number;

  /** Mean 1-5 rating of the direct work. Null when there was none. */
  avg_effectiveness: number | null;
  volume_kg: string;

  mev: number | null;
  mav: number | null;
  mrv: number | null;

  status: VolumeStatus;
};

export type WeeklyVolume = {
  /** Monday of that week in the user's own timezone. */
  week_start: string;
  muscles: MuscleWeeklyVolume[];
};

export type WeeklyVolumeResponse = {
  weeks: WeeklyVolume[];
  timezone: string;
};

export function fetchWeeklyVolume(weeks = 4): Promise<WeeklyVolumeResponse> {
  return apiRequest<WeeklyVolumeResponse>(`/analytics/weekly-volume?weeks=${weeks}`);
}

/**
 * "Why am I not growing" — ranked findings across volume, recovery and
 * weight trend. See src/diagnosis/messages.ts for how a Finding becomes the
 * text shown on screen: the server sends code + data, never a message,
 * because translation is coming later and this endpoint should not need to
 * change when it does.
 */
export type FindingSeverity = "critical" | "warning" | "good" | "info";

export type FindingCode =
  | "volume_below_mev"
  | "volume_above_mrv"
  | "muscles_untrained"
  | "sleep_low"
  | "sleep_very_low"
  | "readiness_no_data"
  | "weight_stalled_bulk"
  | "weight_stalled_cut"
  | "weight_on_track"
  | "weight_no_data"
  | "training_infrequent"
  | "training_consistent";

export type Finding = {
  code: FindingCode;
  severity: FindingSeverity;
  /** Shape depends on `code` — see messages.ts for the field list per code. */
  data: Record<string, unknown>;
};

export type TrainingCoverage = {
  period_start: string | null;
  period_end: string;
  completed_weeks: number;
  weeks_with_work: number;
  sessions: number;
  required_weeks_with_work: number;
};

/**
 * How much a domain's records can support. Five distinct states, never merged:
 * "missing" means no records in the window (not "nothing happened"), "not_applicable"
 * means the comparison does not apply (weight without a directional goal).
 */
export type DomainState = "sufficient" | "insufficient" | "stale" | "missing" | "not_applicable";

export type DomainReason =
  | "no_working_sets"
  | "no_completed_week"
  | "too_few_weeks_with_work"
  | "no_sleep_records"
  | "too_few_nights"
  | "stale_records"
  | "no_measurements"
  | "too_few_measurements"
  | "short_span"
  | "stale_measurements"
  | "no_goal"
  | "goal_maintain";

/** What one domain rests on: its own window and the dates of the records found in it. */
export type DomainCoverage = {
  state: DomainState;
  reason: DomainReason | null;
  /** The window that was searched. Training: whole completed local weeks. Sleep/weight: up to today. */
  period_start: string | null;
  period_end: string | null;
  record_count: number;
  first_recorded_on: string | null;
  last_recorded_on: string | null;
  /** Age of the newest record in days (sleep and weight only). */
  latest_age_days: number | null;
};

export type DiagnosisDomains = {
  training: DomainCoverage;
  sleep: DomainCoverage;
  weight: DomainCoverage;
};

export type DiagnosisResponse = {
  period_weeks: number;
  /**
   * About TRAINING records only: recorded work in at least two eligible completed weeks.
   * It gates the volume and consistency findings, not the whole assessment; sleep and
   * weight are judged on their own records (see `domains`).
   */
  has_enough_data: boolean;
  /** Optional while connecting to an older backend. */
  training_coverage?: TrainingCoverage;
  findings: Finding[];
  /** The user's local calendar day the assessment was made on. Optional for older backends. */
  today?: string;
  timezone?: string;
  /** Optional while connecting to an older backend. */
  domains?: DiagnosisDomains;
};

export function fetchDiagnosis(weeks = 4): Promise<DiagnosisResponse> {
  return apiRequest<DiagnosisResponse>(`/analytics/diagnosis?weeks=${weeks}`);
}
