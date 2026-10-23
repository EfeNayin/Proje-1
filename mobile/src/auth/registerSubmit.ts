/**
 * Submit logic for the register screen, kept out of the component so the rules
 * that matter can be tested without rendering anything.
 *
 * Same shape as loginSubmit: the in-flight flag lives here rather than in
 * React state, because `busy` state only updates on the next render, so a
 * keyboard "go" followed immediately by a button tap could both read
 * busy === false and fire two sign-up requests.
 */

import type { RegisterInput } from "../api/auth";

export type RegisterFields = {
  email: string;
  username: string;
  password: string;
  firstName: string;
  timezone?: string;
};

export type RegisterOutcome =
  | { kind: "ignored" }
  | { kind: "invalid"; message: string }
  | { kind: "success" }
  | { kind: "failed"; message: string };

/**
 * Validate on submit rather than disabling the button: a disabled button that
 * does nothing when tapped gives the user no idea what is wrong.
 */
export function validateRegister(
  fields: Pick<RegisterFields, "email" | "username" | "password">,
): string | null {
  const username = fields.username.trim();
  if (!fields.email.trim().includes("@")) return "Enter a valid email address.";
  if (username.length < 3) return "Username must be at least 3 characters.";
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return "Username can only contain letters, numbers and underscores.";
  }
  if (fields.password.length < 8) return "Password must be at least 8 characters.";
  return null;
}

export function buildRegisterInput(fields: RegisterFields): RegisterInput {
  return {
    email: fields.email.trim(),
    username: fields.username.trim().toLowerCase(),
    password: fields.password,
    first_name: fields.firstName.trim() || undefined,
    // Sent at signup because it cannot be reconstructed later, and weekly
    // volume is sliced in the user's local week: a Monday 01:00 session in
    // Istanbul is Sunday 22:00 UTC and would otherwise land in the wrong week.
    timezone: fields.timezone,
  };
}

export function createRegisterSubmitter(
  signUp: (input: RegisterInput) => Promise<void>,
  // Called once a request is actually about to start (not for ignored or
  // invalid submits), so the screen can show its loading state.
  onStart?: () => void,
): (fields: RegisterFields) => Promise<RegisterOutcome> {
  let inFlight = false;

  return async (fields) => {
    if (inFlight) return { kind: "ignored" };

    const message = validateRegister(fields);
    if (message) return { kind: "invalid", message };

    inFlight = true;
    onStart?.();
    try {
      await signUp(buildRegisterInput(fields));
      return { kind: "success" };
    } catch (err) {
      // The server's own wording (email taken, username taken, no connection)
      // is what tells the user what to fix, so it is passed through as is.
      return { kind: "failed", message: err instanceof Error ? err.message : "Registration failed" };
    } finally {
      inFlight = false;
    }
  };
}
