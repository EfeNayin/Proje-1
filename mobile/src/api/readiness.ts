/** Daily readiness check-in endpoints. */

import { apiRequest } from "./client";

export type ReadinessLog = {
  /** null means nothing has been submitted for this day yet. */
  id: number | null;
  log_date: string;
  sleep_hours: string | null;
  sleep_quality: number | null;
  energy: number | null;
  mood: number | null;
  soreness: Record<string, number> | null;
  notes: string | null;
};

export type ReadinessUpsert = {
  sleep_hours?: number | null;
  sleep_quality?: number | null;
  energy?: number | null;
  mood?: number | null;
  soreness?: Record<string, number> | null;
  notes?: string | null;
};

/** Today's log, computed from the user's own timezone, not the client's clock. */
export function getTodayReadiness(): Promise<ReadinessLog> {
  return apiRequest<ReadinessLog>("/readiness/today");
}

/** Create or update today's log. Submitting twice the same day replaces it, not appends. */
export function upsertTodayReadiness(payload: ReadinessUpsert): Promise<ReadinessLog> {
  return apiRequest<ReadinessLog>("/readiness/today", { method: "PUT", body: payload });
}

export type ReadinessPatch = ReadinessUpsert & {
  /** The day the screen was looking at: the server refuses (409) if the local day has changed. */
  expected_log_date?: string;
};

/**
 * Change only the sent fields of today's log. A field sent as null is cleared; a field
 * left out keeps its value. Safe to repeat: the same fields give the same result. Never
 * creates a workout.
 */
export function patchTodayReadiness(payload: ReadinessPatch): Promise<ReadinessLog> {
  return apiRequest<ReadinessLog>("/readiness/today", { method: "PATCH", body: payload });
}
