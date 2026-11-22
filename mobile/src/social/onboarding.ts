/**
 * Finishing a first Google/Apple sign-in. The server has verified who the person is but
 * created no account; the offer it returned (a short-lived single-use token plus what the
 * provider shared) lives here, in memory only, until the person either:
 *
 *  - picks a username and creates the account (`create`), or
 *  - proves they already have an Aures account with its email and password, and the
 *    provider is attached to THAT account (`link`).
 *
 * Neither is decided by the provider's email address. A matching address never links
 * anything; the person says which account is theirs and proves it.
 *
 * The token is not persisted: closing the app abandons the offer and the next provider
 * sign-in starts again, which is also what the server's 15-minute expiry assumes. The
 * store forgets it on sign-out/account change (AuthContext.resetAccountState) and when the
 * screen is left.
 */

import type { OnboardingOffer } from "../api/social";

export type OnboardingState = { offer: OnboardingOffer | null };

export const USERNAME_MIN = 3;

/** The registration rules for a username, with the same wording. */
export function usernameError(raw: string): string | null {
  const username = raw.trim();
  if (username.length < USERNAME_MIN) return `Username must be at least ${USERNAME_MIN} characters.`;
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return "Username can only contain letters, numbers and underscores.";
  }
  return null;
}

export function createOnboardingStore(now: () => number = () => Date.now()) {
  let state: OnboardingState = { offer: null };
  let expiresAt = 0;
  const listeners = new Set<() => void>();
  function set(next: OnboardingState): void {
    state = next;
    for (const listener of [...listeners]) listener();
  }
  return {
    getSnapshot: (): OnboardingState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    begin(offer: OnboardingOffer): void {
      // The server's clock decides validity; this is only so the screen does not offer
      // a form that is certain to be refused.
      expiresAt = now() + offer.expires_in * 1000;
      set({ offer });
    },
    /** The offer if it is still within its life, else null (and forgotten). */
    current(): OnboardingOffer | null {
      if (state.offer && now() >= expiresAt) set({ offer: null });
      return state.offer;
    },
    clear(): void {
      if (state.offer) set({ offer: null });
    },
  };
}

export type OnboardingStore = ReturnType<typeof createOnboardingStore>;

export type OnboardingOutcome =
  | { kind: "ignored" }
  | { kind: "invalid"; message: string }
  | { kind: "success" }
  /** The sign-in this belonged to ended meanwhile (another sign-in, a sign-out). Show nothing. */
  | { kind: "superseded" }
  /** The offer is gone (expired, used, replaced). The person starts again from sign-in. */
  | { kind: "expired"; message: string }
  /** That address belongs to an Aures account: offer to sign in to it and link instead. */
  | { kind: "email-in-use"; message: string }
  | { kind: "username-taken"; message: string }
  | { kind: "failed"; message: string };

const EXPIRED = "That sign-in expired. Go back and sign in with Google or Apple again.";

type ErrorLike = { name?: unknown; status?: unknown; message?: unknown; code?: unknown };

export function describeOnboardingFailure(error: unknown): OnboardingOutcome {
  const { name, message, code } = (error ?? {}) as ErrorLike;
  if (name === "SessionChangedError") return { kind: "superseded" };
  const detail =
    typeof message === "string" && message ? message : "Something went wrong. Try again.";
  switch (code) {
    case "social_onboarding_expired":
      return { kind: "expired", message: EXPIRED };
    case "social_username_taken":
      return { kind: "username-taken", message: "That username is taken. Choose another." };
    case "social_email_in_use":
      return {
        kind: "email-in-use",
        message:
          "An Aures account already uses that email. If it is yours, sign in to it below to link this " +
          "account. Otherwise use a different email.",
      };
    default:
      return { kind: "failed", message: detail };
  }
}

type Gate = { tryEnter: () => boolean; leave: () => void };
export type OnboardingDeps<Signed> = {
  store: OnboardingStore;
  /** Signs in with the response, as sessionController.establish does. */
  establish: (request: () => Promise<Signed>) => Promise<void>;
  complete: (input: {
    onboarding_token: string;
    username: string;
    first_name?: string;
    email?: string;
    timezone?: string;
  }) => Promise<Signed>;
  linkExisting: (input: {
    onboarding_token: string;
    email: string;
    password: string;
  }) => Promise<Signed>;
  gate: Gate;
  timezone?: () => string | undefined;
};

export type CreateFields = { username: string; firstName: string; email: string };

export function createOnboarding<Signed>(deps: OnboardingDeps<Signed>) {
  async function run(request: (token: string) => Promise<Signed>): Promise<OnboardingOutcome> {
    const offer = deps.store.current();
    if (!offer) return { kind: "expired", message: EXPIRED };
    if (!deps.gate.tryEnter()) return { kind: "ignored" };
    try {
      await deps.establish(() => request(offer.token));
      deps.store.clear();
      return { kind: "success" };
    } catch (error) {
      const outcome = describeOnboardingFailure(error);
      if (outcome.kind === "expired") deps.store.clear();
      return outcome;
    } finally {
      deps.gate.leave();
    }
  }

  return {
    async create(fields: CreateFields): Promise<OnboardingOutcome> {
      const offer = deps.store.current();
      if (!offer) return { kind: "expired", message: EXPIRED };
      const problem = usernameError(fields.username);
      if (problem) return { kind: "invalid", message: problem };
      const email = fields.email.trim();
      // Asked for only when the provider gave nothing usable.
      if (!offer.email_is_usable && !email.includes("@")) {
        return { kind: "invalid", message: "Enter a valid email address." };
      }
      const firstName = fields.firstName.trim();
      return run((token) =>
        deps.complete({
          onboarding_token: token,
          username: fields.username.trim().toLowerCase(),
          ...(firstName ? { first_name: firstName } : {}),
          ...(!offer.email_is_usable ? { email } : {}),
          timezone: deps.timezone?.(),
        }),
      );
    },

    async link(fields: { email: string; password: string }): Promise<OnboardingOutcome> {
      if (!fields.email.trim().includes("@")) {
        return { kind: "invalid", message: "Enter the email of your Aures account." };
      }
      if (!fields.password) return { kind: "invalid", message: "Enter your Aures password." };
      return run((token) =>
        deps.linkExisting({
          onboarding_token: token,
          email: fields.email.trim(),
          password: fields.password,
        }),
      );
    },
  };
}
