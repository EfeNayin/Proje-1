/**
 * Submit logic for the login screen, kept out of the component so the rules
 * that matter can be tested without rendering anything.
 *
 * The in-flight flag lives here rather than in React state: `busy` state only
 * updates on the next render, so a keyboard "go" followed immediately by a
 * button tap could both read busy === false and fire two sign-in requests.
 */

export type LoginOutcome =
  | { kind: "ignored" }
  | { kind: "invalid"; message: string }
  | { kind: "success" }
  | { kind: "failed"; message: string };

export function validateLogin(email: string, password: string): string | null {
  // Validated on submit, not by disabling the button: a dead button tells
  // the user nothing about what is missing.
  if (!email.trim()) return "Enter your email address.";
  if (!password) return "Enter your password.";
  return null;
}

export function createLoginSubmitter(
  signIn: (email: string, password: string) => Promise<void>,
  // Called once a request is actually about to start (not for ignored or
  // invalid submits), so the screen can show its loading state.
  onStart?: () => void,
): (email: string, password: string) => Promise<LoginOutcome> {
  let inFlight = false;

  return async (email, password) => {
    if (inFlight) return { kind: "ignored" };

    const message = validateLogin(email, password);
    if (message) return { kind: "invalid", message };

    inFlight = true;
    onStart?.();
    try {
      await signIn(email.trim(), password);
      return { kind: "success" };
    } catch (err) {
      return { kind: "failed", message: err instanceof Error ? err.message : "Sign in failed" };
    } finally {
      inFlight = false;
    }
  };
}
