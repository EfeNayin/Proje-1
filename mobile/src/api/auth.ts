/**
 * Auth and profile endpoints.
 *
 * The types mirror the backend's Pydantic models. Keeping them here rather
 * than inline in screens means a backend change breaks one file, not five.
 */

import { apiRequest } from "./client";
import type { ProviderCredential } from "./social";
import type { TokenPair } from "./tokens";

export type Gender = "male" | "female" | "other" | "prefer_not_to_say";

// Inputs to the nutrition goal formula. Defined here, alongside Gender,
// because they are directly editable through PATCH /users/me — the
// nutrition API module re-exports them rather than redefining them.
export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";
export type NutritionGoalKind = "cut" | "maintain" | "bulk";

export type UserProfile = {
  id: string;
  email: string;
  username: string;
  first_name: string | null;
  last_name: string | null;
  /** The owner's own contact number (E.164), unverified; never shown to anyone else. */
  phone_number: string | null;
  bio: string | null;
  is_private: boolean;
  weight_unit: "kg" | "lb";
  timezone: string;
  locale: string;
  /** cm. Also the calorie/macro feature's prerequisite (a later task). */
  height_cm: string | null;
  date_of_birth: string | null;
  gender: Gender | null;
  goal_weight_kg: string | null;
  activity_level: ActivityLevel | null;
  nutrition_goal: NutritionGoalKind | null;
  /** Coach tools switched on. Adds capabilities; grants no access to anyone's data. */
  coach_enabled: boolean;
  /**
   * False for an account made with Google or Apple: it has no password to type, to reset or
   * to confirm a deletion with. It confirms by signing in with its provider again.
   */
  has_password: boolean;
  created_at: string;
};

export type AuthResponse = {
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
  phone_number?: string;
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

/**
 * Ends this device's session on the server: the refresh token and any successor
 * its rotations produced stop working (other devices' sessions are untouched).
 *
 * Anonymous on purpose: the refresh token is the credential here, and an
 * expired access token must not send a sign-out through the refresh flow.
 * The server answers 204 even for a token it does not know. Callers treat this
 * as best effort; access tokens already issued stay valid until they expire.
 */
export function logout(refreshToken: string): Promise<void> {
  return apiRequest<void>("/auth/logout", {
    method: "POST",
    body: { refresh_token: refreshToken },
    anonymous: true,
  });
}

export function fetchMe(): Promise<UserProfile> {
  return apiRequest<UserProfile>("/users/me");
}

/**
 * height_cm and goal_weight_kg are numbers here even though UserProfile
 * returns them as strings: Pydantic's Decimal fields accept a JSON number on
 * the way in but always serialise back out as a string, to avoid floating
 * point surprises on values people compare exactly.
 */
export type UserUpdateInput = Partial<
  Omit<UserProfile, "height_cm" | "goal_weight_kg">
> & {
  height_cm?: number | null;
  goal_weight_kg?: number | null;
};

export function updateMe(changes: UserUpdateInput): Promise<UserProfile> {
  // Only the fields present are sent, matching the backend's PATCH semantics:
  // omitted fields keep their value, an explicit null clears one.
  return apiRequest<UserProfile>("/users/me", { method: "PATCH", body: changes });
}

/** Longer than a normal request: the server checks the password and may wait out a lock. */
const DELETE_ACCOUNT_TIMEOUT_MS = 45_000;

/**
 * Permanently deletes the signed-in account. The password travels only in the
 * JSON body of this one request; it is never part of a URL, and the server never
 * echoes it back. The account is always the caller's own: there is no way to name
 * another one.
 *
 * Resolves only on 204, which is the one proof the account is gone. A wrong
 * password is 403 (not 401, which this client would read as a dead session), a
 * limit is 429, and "no answer" is status 0: the server may or may not have acted.
 */
export function deleteAccount(confirmation: string | ProviderCredential): Promise<void> {
  // A password, or (for an account without one) a fresh sign-in with a linked provider.
  const body = typeof confirmation === "string" ? { password: confirmation } : { provider_credential: confirmation };
  return apiRequest<void>("/users/me/delete-account", {
    method: "POST",
    body,
    timeoutMs: DELETE_ACCOUNT_TIMEOUT_MS,
  });
}

export type RecoveryAccepted = {
  message: string;
  /** Deployment constants, the same for every address. */
  code_valid_minutes: number;
  resend_after_seconds: number;
};

const RECOVERY_TIMEOUT_MS = 30_000;

/**
 * Asks for a password reset code by email. Anonymous. The answer is the same whether or
 * not the address has an account, so a success says nothing about the address. A repeat
 * request replaces the previous code (the server's resend rule).
 */
export function requestPasswordRecovery(email: string): Promise<RecoveryAccepted> {
  return apiRequest<RecoveryAccepted>("/auth/password-recovery/request", {
    method: "POST",
    body: { email },
    anonymous: true,
    timeoutMs: RECOVERY_TIMEOUT_MS,
  });
}

/**
 * Sets a new password with the emailed code. Anonymous and signs nobody in: it resolves
 * on 204 and returns no tokens. The code and the password travel only in this JSON body.
 * Status 0 (no answer) means the password may or may not have changed.
 */
export function confirmPasswordRecovery(input: {
  email: string;
  code: string;
  newPassword: string;
}): Promise<void> {
  return apiRequest<void>("/auth/password-recovery/confirm", {
    method: "POST",
    body: { email: input.email, code: input.code, new_password: input.newPassword },
    anonymous: true,
    timeoutMs: RECOVERY_TIMEOUT_MS,
  });
}
