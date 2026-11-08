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

/**
 * Shared with the Google and Apple buttons (see auth/attemptGate.ts), so a provider
 * sign-in and an email sign-in cannot overlap. Typed structurally: this module imports
 * nothing.
 */
type Gate = { tryEnter: () => boolean; leave: () => void };

export function createLoginSubmitter(
  signIn: (email: string, password: string) => Promise<void>,
  // Called once a request is actually about to start (not for ignored or
  // invalid submits), so the screen can show its loading state.
  onStart?: () => void,
  gate?: Gate,
): (email: string, password: string) => Promise<LoginOutcome> {
  let inFlight = false;
  const own: Gate = {
    tryEnter() {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    leave() {
      inFlight = false;
    },
  };
  const attempts = gate ?? own;

  return async (email, password) => {
    const message = validateLogin(email, password);
    // A submit while another attempt runs is ignored before it is judged: the running
    // request owns the screen.
    if (!attempts.tryEnter()) return { kind: "ignored" };
    if (message) {
      attempts.leave();
      return { kind: "invalid", message };
    }

    onStart?.();
    try {
      await signIn(email.trim(), password);
      return { kind: "success" };
    } catch (err) {
      return { kind: "failed", message: err instanceof Error ? err.message : "Sign in failed" };
    } finally {
      attempts.leave();
    }
  };
}
