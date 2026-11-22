/**
 * The example-program library: browse, preview, and copy one into "My programs".
 *
 * Browsing is read-only on the server. Only copyExampleProgram writes, and it must
 * be sent with the SAME request id after an uncertain result (lost response, app
 * killed): the server then returns the program the first attempt created instead of
 * making another. src/programs/exampleCopy.ts owns that id.
 */

import { apiRequest } from "./client";
import type { ProgramDetail } from "./programs";

export type ExampleLevel = "Beginner" | "Intermediate" | "Advanced";

export type ExampleSummary = {
  id: string;
  version: number;
  level: ExampleLevel;
  name: string;
  summary: string;
  sessions_per_week: number;
  /** The suggested schedule in words, shown as is. */
  schedule: string;
  day_count: number;
  exercise_count: number;
  weekly_working_sets: number;
};

export type ExampleExercise = {
  exercise_name: string;
  exercise_order: number;
  target_sets: number;
  target_reps_min: number;
  target_reps_max: number;
  target_rir: number;
  notes: string | null;
};

export type ExampleDay = {
  name: string;
  day_order: number;
  notes: string | null;
  exercises: ExampleExercise[];
};

export type ExampleSource = {
  title: string;
  citation: string;
  url: string;
  /** What the source found. Aures's own choices are in `authored`, never here. */
  finding: string;
};

export type ExampleDetail = ExampleSummary & {
  sequence: string[];
  days: ExampleDay[];
  sources: ExampleSource[];
  authored: string[];
};

export type ExampleCopyBody = { example_id: string; version: number };

export async function listExamplePrograms(): Promise<ExampleSummary[]> {
  const body = await apiRequest<{ examples: ExampleSummary[] }>("/example-programs");
  return body.examples;
}

export function getExampleProgram(id: string): Promise<ExampleDetail> {
  return apiRequest<ExampleDetail>(`/example-programs/${encodeURIComponent(id)}`);
}

/** The caller must reuse the request id after an uncertain result. */
export function copyExampleProgram(requestId: string, body: ExampleCopyBody): Promise<ProgramDetail> {
  return apiRequest<ProgramDetail>(`/example-programs/requests/${requestId}`, { method: "PUT", body });
}
