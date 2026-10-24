import { apiRequest } from "./client";
import type { UserProfile } from "./auth";

/**
 * Coach mode, invites and coach-athlete connections.
 *
 * The caller is always the signed-in account (taken from the access token by
 * the backend); no function here sends a user id. The backend decides who may
 * do what; hiding a screen is only a convenience.
 */

/** What one side may see of the other. No email, no training data. */
export type Person = {
  username: string;
  first_name: string | null;
  last_name: string | null;
};

/** `person` is the athlete in a coach's list and the coach in an athlete's. */
export type Connection = {
  id: string;
  person: Person;
  connected_at: string;
  /**
   * Whether the athlete lets the coach read their completed workouts. Off for
   * every new connection; only the athlete can change it.
   */
  shares_workouts: boolean;
};

export type InviteCreated = {
  id: string;
  /** Shown once; the backend keeps only a hash. */
  code: string;
  expires_at: string;
};

export type InvitePreview = {
  coach: Person;
  expires_at: string;
};

export function enableCoach(): Promise<UserProfile> {
  return apiRequest<UserProfile>("/coaching/enable", { method: "POST" });
}

export function createInvite(): Promise<InviteCreated> {
  return apiRequest<InviteCreated>("/coaching/invites", { method: "POST" });
}

// The code goes in the body, not the URL, so it stays out of access logs.
export function previewInvite(code: string): Promise<InvitePreview> {
  return apiRequest<InvitePreview>("/coaching/invites/preview", {
    method: "POST",
    body: { code },
  });
}

export function acceptInvite(code: string): Promise<Connection> {
  return apiRequest<Connection>("/coaching/invites/accept", { method: "POST", body: { code } });
}

export async function listAthletes(): Promise<Connection[]> {
  return (await apiRequest<{ items: Connection[] }>("/coaching/athletes")).items;
}

export async function listCoaches(): Promise<Connection[]> {
  return (await apiRequest<{ items: Connection[] }>("/coaching/coaches")).items;
}

export function endConnection(linkId: string): Promise<void> {
  return apiRequest<void>(`/coaching/links/${linkId}`, { method: "DELETE" });
}

/** The athlete's per-connection switch. Idempotent; returns the connection as the athlete sees it. */
export function setWorkoutSharing(linkId: string, enabled: boolean): Promise<Connection> {
  return apiRequest<Connection>(`/coaching/links/${linkId}/workout-sharing`, {
    method: "PUT",
    body: { enabled },
  });
}

/** A completed session in a coach's list. No notes, no volume. */
export type AthleteWorkoutSummary = {
  id: string;
  title: string | null;
  performed_at: string;
  finished_at: string;
  /** false: Finish was pressed (real duration). true: closed when a later session started. null: unknown. */
  finished_automatically: boolean | null;
  /** Working sets; warm-ups are not counted. */
  total_sets: number;
};

export type AthleteWorkoutPage = {
  items: AthleteWorkoutSummary[];
  total: number;
  limit: number;
  offset: number;
};

export type AthleteSet = {
  set_number: number;
  weight_kg: string;
  reps: number;
  /** null: not recorded. 0 is a real value. */
  rir: number | null;
  is_warmup: boolean;
};

export type AthleteExercise = {
  exercise_id: string;
  name: string;
  sets: AthleteSet[];
};

export type AthleteWorkoutDetail = AthleteWorkoutSummary & { exercises: AthleteExercise[] };

// The athlete is named by the connection id only; the backend finds the person
// from it and checks the caller is that connection's coach.
export function listAthleteWorkouts(
  linkId: string,
  limit: number,
  offset: number,
): Promise<AthleteWorkoutPage> {
  return apiRequest<AthleteWorkoutPage>(
    `/coaching/athletes/${linkId}/workouts?limit=${limit}&offset=${offset}`,
  );
}

export function getAthleteWorkout(linkId: string, workoutId: string): Promise<AthleteWorkoutDetail> {
  return apiRequest<AthleteWorkoutDetail>(`/coaching/athletes/${linkId}/workouts/${workoutId}`);
}
