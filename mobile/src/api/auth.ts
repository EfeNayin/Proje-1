/**
 * Auth and profile endpoints.
 *
 * The types mirror the backend's Pydantic models. Keeping them here rather
 * than inline in screens means a backend change breaks one file, not five.
 */

import { apiRequest } from "./client";
import type { TokenPair } from "./tokens";

export type UserProfile = {
  id: string;
  email: string;
  username: string;
  first_name: string | null;
  last_name: string | null;
  bio: string | null;
  is_private: boolean;
  weight_unit: "kg" | "lb";
  timezone: string;
  locale: string;
  created_at: string;
};

type AuthResponse = {
  user: UserProfile;
  tokens: TokenPair;
};

/** "First Last", "First", or null if neither name is set. Never falls back
 * to username itself — callers decide what to show instead. */
export function fullName(user: Pick<UserProfile, "first_name" | "last_name">): string | null {
  const parts = [user.first_name, user.last_name].filter(
    (part): part is string => part != null && part.length > 0,
  );
  return parts.length > 0 ? parts.join(" ") : null;
}

/** Avatar initials: first_name + last_name's first letters, or the first
 * letter of username if no name is set. */
export function initials(
  user: Pick<UserProfile, "first_name" | "last_name" | "username">,
): string {
  if (user.first_name) {
    return (user.first_name[0] + (user.last_name?.[0] ?? "")).toUpperCase();
  }
  return user.username[0]?.toUpperCase() ?? "?";
}

export type RegisterInput = {
  email: string;
  username: string;
  password: string;
  first_name?: string;
  timezone?: string;
  locale?: string;
};

export function register(input: RegisterInput): Promise<AuthResponse> {
  return apiRequest<AuthResponse>("/auth/register", {
    method: "POST",
    body: input,
    anonymous: true,
  });
}

export function login(email: string, password: string): Promise<AuthResponse> {
  return apiRequest<AuthResponse>("/auth/login", {
    method: "POST",
    body: { email, password },
    anonymous: true,
  });
}

export function fetchMe(): Promise<UserProfile> {
  return apiRequest<UserProfile>("/users/me");
}

export function updateMe(changes: Partial<UserProfile>): Promise<UserProfile> {
  // Only the fields present are sent, matching the backend's PATCH semantics:
  // omitted fields keep their value, an explicit null clears one.
  return apiRequest<UserProfile>("/users/me", { method: "PATCH", body: changes });
}
