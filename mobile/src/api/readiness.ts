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
