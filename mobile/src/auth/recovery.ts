/**
 * Password recovery as the app sees it: email -> code and new password -> done. State
 * lives here, not in the screen, so the rules that matter can be tested without
 * rendering anything.
 *
 * What it promises, and what it does not:
 *  - The request step claims nothing about the address: the server answers the same for
 *    every address, so the screen says "if an account exists" and nothing more.
 *  - "Password changed" is claimed only after the server answered 204. A lost answer
 *    (no connection, timeout, a 5xx) is "unconfirmed": the password may or may not have
 *    changed, and the message says how to find out. A refusal made before anything
 *    changed (400, 422, 429, 503) says that nothing changed.
 *  - Nothing signs anyone in and nothing touches the session: this flow runs signed out,
 *    and its result is a message, not tokens. A late answer is dropped when the screen
 *    was left or the signed-in account changed meanwhile (the same epoch guard as account
 *    deletion), so it can never act on a session that is not the one it started under.
 *  - The email address is the only thing kept between steps. The code and the passwords
 *    are arguments of submitReset(): they go to the request and nowhere else. The screen
 *    keeps what was typed in its own state across failures (so a typo costs one field,
 *    not the form) and drops it when it is left; nothing is written to storage.
 *  - Guards are released after every outcome, so a failure can always be retried, and
 *    nothing here retries by itself.
 */

export const CODE_LENGTH = 8;
/** Mirrors the server's guesses per code (PASSWORD_RESET_MAX_ATTEMPTS). After this many
 * wrong codes the code no longer works, whatever is typed next. */
export const MAX_WRONG_CODES = 5;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_BYTES = 72;
const DEFAULT_RESEND_SECONDS = 60;

export type RecoveryFailure = {
  kind:
    | "invalid" // refused on the device, nothing was sent
    | "wrong-code" // the server: not valid, expired, used or replaced
    | "exhausted" // too many wrong codes for this code
    | "rate-limited"
    | "unavailable" // refused before anything changed (503, or no answer to a request)
    | "unconfirmed" // no answer to the reset: it may or may not have gone through
    | "rejected";
  message: string;
};

export type RecoveryState = {
  phase: "request" | "confirm" | "done";
  /** The address the code was asked for (or typed): kept between steps. */
  email: string;
  working: "requesting" | "resetting" | null;
  error: RecoveryFailure | null;
  /** A new code was just asked for from the second step. */
  resent: boolean;
  /** When another code may be asked for (ms, the store's clock), or null. */
  resendAvailableAt: number | null;
  wrongCodes: number;
  exhausted: boolean;
  codeValidMinutes: number | null;
};

export const initialRecoveryState: RecoveryState = {
  phase: "request",
  email: "",
  working: null,
  error: null,
  resent: false,
  resendAvailableAt: null,
  wrongCodes: 0,
  exhausted: false,
  codeValidMinutes: null,
};

export type RequestOutcome =
  | { kind: "sent" }
  | RecoveryFailure
  | { kind: "cooldown" }
  | { kind: "obsolete" }
  | { kind: "ignored" };

export type ResetOutcome =
  | { kind: "changed" }
  | RecoveryFailure
  | { kind: "obsolete" }
  | { kind: "ignored" };

// ── what is checked on the device before anything is sent ──────────────────

export function validateEmail(raw: string): string | null {
  const email = raw.trim();
  if (email.length === 0) return "Enter your email address.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
  return null;
}

/** The 8 digits typed or pasted (spaces and hyphens ignored), or null if it is not a code. */
export function normalizeCode(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  return new RegExp(`^[0-9]{${CODE_LENGTH}}$`).test(digits) ? digits : null;
}

/** UTF-8 length, which is what the server's 72-byte limit counts (ş is 2 bytes). */
export function utf8Length(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const point = char.codePointAt(0) ?? 0;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return bytes;
}

export function validateNewPassword(password: string, confirmation: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (utf8Length(password) > MAX_PASSWORD_BYTES) {
    return `That password is too long: at most ${MAX_PASSWORD_BYTES} bytes (letters such as ş or ü count as 2).`;
  }
  if (password !== confirmation) return "The two passwords do not match.";
  return null;
}

/** "Try again in 40 seconds / 12 minutes / 2 hours" from a 429 message, in ms. */
export function waitFromMessage(message: string): number | null {
  const found = /Try again in (\d+) (second|minute|hour)s?/.exec(message);
  if (!found) return null;
  const unit = found[2] === "second" ? 1000 : found[2] === "minute" ? 60_000 : 3_600_000;
  return Number(found[1]) * unit;
}

// ── messages ──────────────────────────────────────────────────────────────

export const WRONG_CODE_MESSAGE =
  "That code is not valid, or it has expired or was already used. Check it, or request a new code.";
export const EXHAUSTED_MESSAGE =
  "Too many wrong codes. This code no longer works: request a new one.";
const REQUEST_UNAVAILABLE =
  "We could not send the request right now. Check your connection and try again in a moment.";
const RESET_UNAVAILABLE =
  "The service is temporarily unavailable. Your password has not been changed. Try again in a moment.";
const RESET_UNCONFIRMED =
  "We could not confirm whether your password was changed. Try signing in with the new password. " +
  "If that does not work, use the code again, or request a new one.";

type ErrorLike = { name?: unknown; status?: unknown; message?: unknown };

function describe(error: unknown, step: "request" | "reset"): RecoveryFailure {
  const { status, message } = (error ?? {}) as ErrorLike;
  const detail = typeof message === "string" ? message : "";
  if (typeof status !== "number") {
    return step === "request"
      ? { kind: "unavailable", message: REQUEST_UNAVAILABLE }
      : { kind: "unconfirmed", message: RESET_UNCONFIRMED };
  }
  if (status === 429) {
    return { kind: "rate-limited", message: detail || "Too many attempts. Try again later." };
  }
  if (step === "reset" && status === 400) return { kind: "wrong-code", message: WRONG_CODE_MESSAGE };
  if (status === 422) {
    return {
      kind: "invalid",
      message:
        step === "request"
          ? "Enter a valid email address."
          : "That password or code is not accepted. Check both and try again.",
    };
  }
  if (status === 503) {
    return {
      kind: "unavailable",
      message: step === "request" ? REQUEST_UNAVAILABLE : RESET_UNAVAILABLE,
    };
  }
  if (status >= 500 || status === 0) {
    // The server may have acted (only matters for the reset).
    return step === "request"
      ? { kind: "unavailable", message: REQUEST_UNAVAILABLE }
      : { kind: "unconfirmed", message: RESET_UNCONFIRMED };
  }
  return {
    kind: "rejected",
    message: detail || "The request was refused. Your password has not been changed.",
  };
}

// ── the store ─────────────────────────────────────────────────────────────

export type RecoveryDeps = {
  requestCode: (email: string) => Promise<{ code_valid_minutes: number; resend_after_seconds: number }>;
  confirmReset: (input: { email: string; code: string; newPassword: string }) => Promise<void>;
  /** The sign-in the request is made under (api/client.ts currentAuthEpoch). */
  currentEpoch: () => number;
  now: () => number;
  /** Called once, after the server confirmed the change and only if the answer is still ours. */
  onChanged?: () => void;
};

export function createRecoveryStore(deps: RecoveryDeps) {
  let state: RecoveryState = initialRecoveryState;
  const listeners = new Set<() => void>();
  // Moves on at every reset: whatever started before it is obsolete.
  let generation = 0;
  let running: number | null = null;

  function set(next: RecoveryState): void {
    state = next;
    for (const listener of [...listeners]) listener();
  }
  const patch = (changes: Partial<RecoveryState>): void => set({ ...state, ...changes });

  async function requestCode(rawEmail: string, options: { resend?: boolean } = {}): Promise<RequestOutcome> {
    if (running === generation) return { kind: "ignored" };
    const resend = options.resend === true;
    if (resend && state.resendAvailableAt !== null && deps.now() < state.resendAvailableAt) {
      return { kind: "cooldown" };
    }
    const problem = validateEmail(rawEmail);
    if (problem) {
      const error: RecoveryFailure = { kind: "invalid", message: problem };
      patch({ error });
      return error;
    }
    const email = rawEmail.trim();

    const started = generation;
    const epoch = deps.currentEpoch();
    running = started;
    patch({ working: "requesting", error: null, email });

    let outcome: RecoveryFailure | { kind: "sent"; minutes: number; resendSeconds: number };
    try {
      const accepted = await deps.requestCode(email);
      outcome = {
        kind: "sent",
        minutes: accepted.code_valid_minutes,
        resendSeconds: accepted.resend_after_seconds,
      };
    } catch (error) {
      outcome = describe(error, "request");
    } finally {
      if (running === started) running = null;
    }

    if (generation !== started || deps.currentEpoch() !== epoch) return { kind: "obsolete" };

    if (outcome.kind === "sent") {
      patch({
        phase: "confirm",
        working: null,
        error: null,
        resent: resend,
        resendAvailableAt: deps.now() + (outcome.resendSeconds || DEFAULT_RESEND_SECONDS) * 1000,
        wrongCodes: 0,
        exhausted: false,
        codeValidMinutes: outcome.minutes,
      });
      return { kind: "sent" };
    }
    const wait = outcome.kind === "rate-limited" ? waitFromMessage(outcome.message) : null;
    patch({
      working: null,
      error: outcome,
      resent: false,
      // A refused resend: the cooldown is whatever the server said (or a minute).
      resendAvailableAt:
        outcome.kind === "rate-limited"
          ? deps.now() + (wait ?? DEFAULT_RESEND_SECONDS * 1000)
          : state.resendAvailableAt,
    });
    return outcome;
  }

  async function submitReset(input: {
    code: string;
    password: string;
    confirmation: string;
  }): Promise<ResetOutcome> {
    if (running === generation) return { kind: "ignored" };
    if (state.exhausted) {
      const error: RecoveryFailure = { kind: "exhausted", message: EXHAUSTED_MESSAGE };
      patch({ error });
      return error;
    }
    const code = normalizeCode(input.code);
    const problem =
      code === null
        ? `Enter the ${CODE_LENGTH}-digit code from the email.`
        : validateNewPassword(input.password, input.confirmation);
    if (code === null || problem) {
      const error: RecoveryFailure = { kind: "invalid", message: problem ?? "" };
      patch({ error });
      return error;
    }

    const started = generation;
    const epoch = deps.currentEpoch();
    const email = state.email;
    running = started;
    patch({ working: "resetting", error: null, resent: false });

    let outcome: RecoveryFailure | { kind: "changed" };
    try {
      await deps.confirmReset({ email, code, newPassword: input.password });
      outcome = { kind: "changed" };
    } catch (error) {
      outcome = describe(error, "reset");
    } finally {
      if (running === started) running = null;
    }

    if (generation !== started || deps.currentEpoch() !== epoch) return { kind: "obsolete" };

    if (outcome.kind === "changed") {
      patch({ phase: "done", working: null, error: null });
      deps.onChanged?.();
      return outcome;
    }
    if (outcome.kind === "wrong-code") {
      const wrongCodes = state.wrongCodes + 1;
      const exhausted = wrongCodes >= MAX_WRONG_CODES;
      const error: RecoveryFailure = exhausted
        ? { kind: "exhausted", message: EXHAUSTED_MESSAGE }
        : outcome;
      patch({ working: null, error, wrongCodes, exhausted });
      return error;
    }
    patch({ working: null, error: outcome });
    return outcome;
  }

  return {
    getSnapshot: (): RecoveryState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    requestCode,
    submitReset,
    /** The first step's field, and the address typed on the sign-in screen before it opened. */
    setEmail(email: string): void {
      if (state.phase === "request" && state.working === null) patch({ email, error: null });
    },
    /** "I already have a code": go to the second step without asking for another. */
    haveCode(rawEmail: string): RecoveryFailure | null {
      const problem = validateEmail(rawEmail);
      if (problem) {
        const error: RecoveryFailure = { kind: "invalid", message: problem };
        patch({ error });
        return error;
      }
      patch({
        phase: "confirm",
        email: rawEmail.trim(),
        error: null,
        resent: false,
        wrongCodes: 0,
        exhausted: false,
        resendAvailableAt: null,
      });
      return null;
    },
    /** Back to the first step with the address kept (a wrong address, a different one). */
    changeEmail(): void {
      if (state.working !== null) return;
      patch({ phase: "request", error: null, resent: false });
    },
    /** The screen was left, or the account changed: drop everything and void what is running. */
    reset(): void {
      generation += 1;
      set(initialRecoveryState);
    },
  };
}

export type RecoveryStore = ReturnType<typeof createRecoveryStore>;
