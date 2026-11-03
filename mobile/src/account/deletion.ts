/**
 * Account deletion, as the signed-in device sees it. State lives here, not in the
 * screen, so the rules that matter can be tested without rendering anything.
 *
 * What is claimed, and when:
 *  - "Deleted" is claimed only after the server answered 204. Nothing else proves
 *    it: not a timeout, not a lost connection, not a 5xx, and not a 401 (which the
 *    API client turns into a forced sign-out for any reason).
 *  - A wrong password (403), a limit (429) and the server's own "nothing was
 *    deleted" (503) are refusals made before anything changed, and say so.
 *  - No answer, or a server error that is not that 503, is "unconfirmed": the
 *    account may or may not be gone. Nothing on the device changes, and the way to
 *    find out is to try again: if it was deleted, the session is gone and the app
 *    signs out on its own.
 *
 * The password is never kept. It is an argument of submit(), goes to the request
 * and nowhere else; the state holds no copy.
 *
 * Everything belongs to one signed-in account. reset() (sign-out, forced expiry,
 * a new sign-in) voids a request still running, and a request that comes back
 * after the sign-in it started under has ended is dropped: it neither shows a
 * result nor ends the session of whoever is signed in now.
 */

export type DeletionFailure =
  | { kind: "invalid"; message: string }
  | { kind: "wrong-password"; message: string }
  | { kind: "rate-limited"; message: string }
  | { kind: "not-deleted"; message: string }
  | { kind: "rejected"; message: string }
  | { kind: "unconfirmed"; message: string };

export type DeletionOutcome =
  | { kind: "deleted" }
  | DeletionFailure
  /** The server ended the session instead of answering; the app is already signed out. */
  | { kind: "session-ended" }
  /** The answer belonged to an account that is no longer the signed-in one. Dropped. */
  | { kind: "obsolete" }
  /** A deletion is already running. */
  | { kind: "ignored" };

export type DeletionState = {
  phase: "idle" | "deleting" | "failed" | "deleted";
  error: DeletionFailure | null;
};

export const initialDeletionState: DeletionState = { phase: "idle", error: null };

export const EMPTY_PASSWORD_MESSAGE = "Enter your current password to continue.";

const WRONG_PASSWORD =
  "That password is not correct. Your account has not been deleted. Check it and try again.";
const RATE_LIMITED =
  "Too many attempts. Your account has not been deleted. Wait a few minutes, then try again.";
const NOT_DELETED =
  "The server could not finish deleting your account, so nothing was deleted. Try again in a moment.";
const UNCONFIRMED =
  "We could not confirm whether your account was deleted. Nothing on this device has changed. " +
  "Try again: if it was deleted, you will be signed out.";

type ErrorLike = { name?: unknown; status?: unknown; message?: unknown };

/** What a failed request means for the account. Reads `name` and `status` only, so it needs no import. */
export function classifyDeletionError(
  error: unknown,
): DeletionFailure | { kind: "session-ended" } | { kind: "obsolete" } {
  const { name, status, message } = (error ?? {}) as ErrorLike;
  if (name === "SessionChangedError") return { kind: "obsolete" };
  if (typeof status !== "number") return { kind: "unconfirmed", message: UNCONFIRMED };
  const detail = typeof message === "string" ? message : "";
  if (status === 403) return { kind: "wrong-password", message: WRONG_PASSWORD };
  if (status === 429) return { kind: "rate-limited", message: RATE_LIMITED };
  if (status === 401) return { kind: "session-ended" };
  if (status === 503) return { kind: "not-deleted", message: NOT_DELETED };
  if (status === 422) return { kind: "invalid", message: EMPTY_PASSWORD_MESSAGE };
  if (status >= 400 && status < 500) {
    return { kind: "rejected", message: detail || "The request was refused. Your account has not been deleted." };
  }
  // No answer (status 0), a 5xx or anything else: the server may have acted.
  return { kind: "unconfirmed", message: UNCONFIRMED };
}

export type DeletionDeps = {
  deleteAccount: (password: string) => Promise<void>;
  /** The sign-in the request is made under (api/client.ts currentAuthEpoch). */
  currentEpoch: () => number;
};

/** Ends the local session after a confirmed deletion, for the sign-in `epoch`. */
export type OnDeleted = (epoch: number) => Promise<unknown> | unknown;

export function createAccountDeletionStore(deps: DeletionDeps) {
  let state: DeletionState = initialDeletionState;
  const listeners = new Set<() => void>();
  // Moves on at every reset: whatever started before it is obsolete.
  let generation = 0;
  // The generation whose request is running; a duplicate submit for it is refused,
  // but a new account (a later generation) is not held up by an old request.
  let running: number | null = null;
  let onDeleted: OnDeleted | null = null;

  function set(next: DeletionState): void {
    state = next;
    for (const listener of [...listeners]) listener();
  }

  async function submit(password: string): Promise<DeletionOutcome> {
    if (running === generation) return { kind: "ignored" };
    if (password.length === 0) {
      const error: DeletionFailure = { kind: "invalid", message: EMPTY_PASSWORD_MESSAGE };
      set({ phase: "failed", error });
      return error;
    }

    const started = generation;
    const epoch = deps.currentEpoch();
    running = started;
    set({ phase: "deleting", error: null });

    let outcome: ReturnType<typeof classifyDeletionError> | { kind: "deleted" };
    try {
      await deps.deleteAccount(password);
      outcome = { kind: "deleted" };
    } catch (error) {
      outcome = classifyDeletionError(error);
    } finally {
      if (running === started) running = null;
    }

    // The account changed while the request ran: the answer is not ours to show.
    if (generation !== started || deps.currentEpoch() !== epoch) return { kind: "obsolete" };
    if (outcome.kind === "obsolete") return outcome;

    if (outcome.kind === "deleted") {
      set({ phase: "deleted", error: null });
      // Only now, and only for the sign-in the deletion was made under.
      await onDeleted?.(epoch);
      return outcome;
    }
    if (outcome.kind === "session-ended") {
      // The client has already signed out; nothing is shown for it.
      set(initialDeletionState);
      return outcome;
    }
    set({ phase: "failed", error: outcome });
    return outcome;
  }

  return {
    getSnapshot: (): DeletionState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    submit,
    /** The screen was left. A running deletion carries on; anything else is forgotten. */
    leave(): void {
      if (state.phase === "deleting") return;
      set(initialDeletionState);
    },
    /** The account changed (sign-out, expiry, new sign-in): drop everything, void what is running. */
    reset(): void {
      generation += 1;
      set(initialDeletionState);
    },
    /** How the app ends its session once the deletion is confirmed (set by AuthContext). */
    setOnDeleted(handler: OnDeleted | null): void {
      onDeleted = handler;
    },
  };
}

export type AccountDeletionStore = ReturnType<typeof createAccountDeletionStore>;
