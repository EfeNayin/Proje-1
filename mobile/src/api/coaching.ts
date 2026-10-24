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
