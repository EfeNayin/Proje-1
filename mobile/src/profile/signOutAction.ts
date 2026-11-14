/**
 * The Sign out button's action, kept out of the component so the lock can be
 * tested. The in-flight flag lives here rather than in React state: a `busy`
 * state only updates on the next render, so two quick taps could both read
 * busy === false. It is released in `finally`, so a failed sign-out (for
 * example a secure-storage error) leaves the button usable for another try.
 *
 * What signing out actually clears is decided by AuthContext.signOut, not here.
 */

export type SignOutOutcome =
  | { kind: "ignored" } // a sign-out is already running
  | { kind: "done" }
  | { kind: "failed"; message: string };

export function createSignOutAction(
  signOut: () => Promise<void>,
  onStart?: () => void,
): () => Promise<SignOutOutcome> {
  let inFlight = false;

  return async () => {
    if (inFlight) return { kind: "ignored" };
    inFlight = true;
    onStart?.();
    try {
      await signOut();
      return { kind: "done" };
    } catch (err) {
      return {
        kind: "failed",
        message: err instanceof Error && err.message ? err.message : "Could not sign out",
      };
    } finally {
      inFlight = false;
    }
  };
}
