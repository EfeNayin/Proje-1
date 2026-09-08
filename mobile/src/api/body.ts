/** Body measurement endpoints: weight history + today's weigh-in. */

import { apiRequest } from "./client";

export type BodyMeasurement = {
  id: number;
  measured_on: string;
  weight_kg: string;
  body_fat_pct: string | null;
  notes: string | null;
};

export type BodyMeasurementUpsert = {
  weight_kg: number;
  body_fat_pct?: number | null;
  notes?: string | null;
};

/** The weight history screen's header. Every field is null when the user
 * has no measurements yet — there is no "0 kg" to fall back to. */
export type BodySummary = {
  current_weight_kg: string | null;
  last_measured_on: string | null;
  first_weight_kg: string | null;
  first_measured_on: string | null;
  change_kg: string | null;
};

/** History, most recent first. */
export function listMeasurements(limit = 50): Promise<{ items: BodyMeasurement[] }> {
  return apiRequest<{ items: BodyMeasurement[] }>(`/body/measurements?limit=${limit}`);
}

/** Create or update today's weigh-in. Submitting twice the same day
 * replaces it, not appends. */
export function upsertMeasurement(payload: BodyMeasurementUpsert): Promise<BodyMeasurement> {
  return apiRequest<BodyMeasurement>("/body/measurements", { method: "PUT", body: payload });
}

export function deleteMeasurement(id: number): Promise<void> {
  return apiRequest<void>(`/body/measurements/${id}`, { method: "DELETE" });
}

export function fetchBodySummary(): Promise<BodySummary> {
  return apiRequest<BodySummary>("/body/summary");
}
