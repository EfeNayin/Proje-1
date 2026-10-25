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

// ── Program offers ───────────────────────────────────────────────────────
// A coach sends a frozen copy of one of their programs; the athlete decides
// whether to keep an independent copy. Offers hang off one connection, so they
// vanish with it. Nothing here names an owner: the backend takes the caller
// from the token and the connection or offer id.

export type OfferStatus = "pending" | "accepted" | "declined";

export type OfferExercise = {
  exercise_id: string;
  exercise_name: string;
  exercise_order: number;
  target_sets: number;
  target_reps_min: number | null;
  target_reps_max: number | null;
  /** 0 is a real target; null means none was set. */
  target_rir: number | null;
  target_rpe: string | null;
  notes: string | null;
};

export type OfferTemplate = {
  name: string;
  day_order: number;
  notes: string | null;
  exercises: OfferExercise[];
};

export type OfferProgram = {
  name: string;
  notes: string | null;
  templates: OfferTemplate[];
};

type OfferBase = {
  id: string;
  status: OfferStatus;
  program_name: string;
  template_count: number;
  exercise_count: number;
  sent_at: string;
  responded_at: string | null;
};

/** The coach's view of one sent offer. It never says which program the athlete ended up with. */
export type SentOffer = OfferBase;
export type SentOfferDetail = SentOffer & { program: OfferProgram };
export type SentOfferPage = { items: SentOffer[]; total: number; limit: number; offset: number };

export type ReceivedOffer = OfferBase & {
  coach: Person;
  /** The athlete's own copy once accepted; null while pending or declined. */
  program_id: string | null;
};
export type ReceivedOfferDetail = ReceivedOffer & { program: OfferProgram };
export type ReceivedOfferPage = {
  items: ReceivedOffer[];
  total: number;
  limit: number;
  offset: number;
};

/**
 * What sending this program to this athlete would offer right now, built by the
 * backend. `fingerprint` identifies exactly this content: the send is accepted
 * only while it still matches.
 */
export type ProgramPreview = { program: OfferProgram; fingerprint: string };

export function getProgramPreview(linkId: string, programId: string): Promise<ProgramPreview> {
  return apiRequest<ProgramPreview>(`/coaching/athletes/${linkId}/program-preview/${programId}`);
}

/**
 * Confirm the previewed content. The backend rebuilds the program itself and
 * refuses (412) if it no longer matches `fingerprint`. Safe to repeat with the
 * same request id: the backend returns the offer it already made.
 */
export function sendProgramOffer(
  linkId: string,
  requestId: string,
  programId: string,
  fingerprint: string,
): Promise<SentOfferDetail> {
  return apiRequest<SentOfferDetail>(`/coaching/athletes/${linkId}/program-offers/${requestId}`, {
    method: "PUT",
    body: { program_id: programId, fingerprint },
  });
}

export function listSentOffers(linkId: string, limit: number, offset: number): Promise<SentOfferPage> {
  return apiRequest<SentOfferPage>(
    `/coaching/athletes/${linkId}/program-offers?limit=${limit}&offset=${offset}`,
  );
}

export function listReceivedOffers(limit: number, offset: number): Promise<ReceivedOfferPage> {
  return apiRequest<ReceivedOfferPage>(`/coaching/program-offers?limit=${limit}&offset=${offset}`);
}

export function getReceivedOffer(offerId: string): Promise<ReceivedOfferDetail> {
  return apiRequest<ReceivedOfferDetail>(`/coaching/program-offers/${offerId}`);
}

/** Safe to repeat: an offer already accepted returns the same copy. */
export function acceptOffer(offerId: string): Promise<ReceivedOfferDetail> {
  return apiRequest<ReceivedOfferDetail>(`/coaching/program-offers/${offerId}/accept`, {
    method: "POST",
  });
}

export function declineOffer(offerId: string): Promise<ReceivedOfferDetail> {
  return apiRequest<ReceivedOfferDetail>(`/coaching/program-offers/${offerId}/decline`, {
    method: "POST",
  });
}
