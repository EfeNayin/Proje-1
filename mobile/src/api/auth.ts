/**
 * Auth and profile endpoints.
 *
 * The types mirror the backend's Pydantic models. Keeping them here rather
 * than inline in screens means a backend change breaks one file, not five.
 */

import { apiRequest } from "./client";
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
