/** Training analytics endpoints. */

import { apiRequest } from "./client";

/**
 * Where a muscle's weekly work sits against its landmarks.
 *
 * "untrained" is separate from "below_mev" on purpose: zero sets and a few
 * sets call for different nudges — one is "you skipped this", the other is
 * "you are close, add a couple".
 */
export type VolumeStatus = "untrained" | "below_mev" | "optimal" | "high" | "above_mrv";

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