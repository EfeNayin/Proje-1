/**
 * Signing in with Google or Apple, as the sign-in screen drives it. Pure logic with its
 * collaborators passed in, so what matters can be tested without a phone:
 *
 *  - which buttons exist: a provider is offered only when this is iOS, the native module
 *    is in the build, AND the server says it is configured and enabled. Anything less hides
 *    it, so a button never leads to a dead end;
 *  - one attempt at a time, shared with the email button (auth/attemptGate.ts);
 *  - a cancelled sheet is not an error: nothing is shown and nothing typed is touched;
 *  - what the screen is told on failure is the server's wording for server problems and a
 *    fixed sentence for anything native. Native error text is never shown or logged: it can
 *    carry identifiers.
 *
 * Nothing here keeps a credential. They are created, sent once, and dropped.
 */

import type {
  ProviderAvailability,
  ProviderCredential,
  SocialProvider,
  SocialSignInResponse,
} from "../api/social";
import type { ProviderSignInResult } from "../auth/sessionController";
import { SocialCancelledError, SocialUnavailableError } from "./errors";
import type { NativeProviders } from "./nativeProviders";

export type OfferedProviders = {
  google: { webClientId: string; iosClientId: string } | null;
  apple: boolean;
};

export const NO_PROVIDERS: OfferedProviders = { google: null, apple: false };

export type ProviderDeps = {
  native: NativeProviders;
  fetchProviders: () => Promise<ProviderAvailability>;
  requestNonce: () => Promise<{ nonce: string }>;
};

/** What to show, from what the server enabled and what this build can do. Never throws. */
export async function resolveOfferedProviders(deps: ProviderDeps): Promise<OfferedProviders> {
  let server: ProviderAvailability;
  try {
    server = await deps.fetchProviders();
  } catch {
    // Server unreachable or an older server without the endpoint: email sign-in only.
    return NO_PROVIDERS;
  }
  const google =
    server.google.enabled &&
    server.google.web_client_id &&
    server.google.ios_client_id &&
    deps.native.googleAvailable()
      ? { webClientId: server.google.web_client_id, iosClientId: server.google.ios_client_id }
      : null;
  const apple = server.apple.enabled && (await deps.native.appleAvailable());
  return { google, apple };
}

/**
 * Opens the provider's sheet and returns what to send to the server. Used for sign-in,
 * for confirming an account deletion and for the proof of linking, so all three ask the
 * provider afresh and none can reuse an old credential.
 */
export async function obtainCredential(
  provider: SocialProvider,
  offered: OfferedProviders,
  deps: ProviderDeps,
): Promise<ProviderCredential> {
  if (provider === "google") {
    if (!offered.google) throw new SocialUnavailableError();
    const { authorizationCode } = await deps.native.signInWithGoogle(offered.google);
    return { provider: "google", authorization_code: authorizationCode };
  }
  if (!offered.apple) throw new SocialUnavailableError();
  // A fresh single-use nonce for this attempt; the identity token will carry it back.
  const { nonce } = await deps.requestNonce();
  const apple = await deps.native.signInWithApple(nonce);
  return {
    provider: "apple",
    identity_token: apple.identityToken,
    nonce,
    ...(apple.authorizationCode ? { authorization_code: apple.authorizationCode } : {}),
    ...(apple.firstName ? { first_name: apple.firstName } : {}),
    ...(apple.lastName ? { last_name: apple.lastName } : {}),
  };
}

export type ProviderOutcome =
  | { kind: "ignored" }
  | { kind: "cancelled" }
  /** The sign-in this attempt belonged to ended meanwhile; nothing may be shown or done. */
  | { kind: "superseded" }
  | { kind: "signedIn" }
  | Extract<ProviderSignInResult, { kind: "onboarding" }>
  | { kind: "failed"; message: string };

type ErrorLike = { name?: unknown; status?: unknown; message?: unknown };

const GENERIC_FAILURE = "We could not sign you in with that account. Try again, or use your email.";

/** What a failed attempt means for the screen. Exported for tests. */
export function describeFailure(error: unknown): ProviderOutcome {
  const { name, status, message } = (error ?? {}) as ErrorLike;
  if (error instanceof SocialCancelledError || name === "SocialCancelledError") {
    return { kind: "cancelled" };
  }
  if (name === "SessionChangedError") return { kind: "superseded" };
  if (name === "SocialUnavailableError") {
    return { kind: "failed", message: "That sign-in is not available right now. Use your email." };
  }
  // The server's own wording (provider outage, rate limit, no connection) says what to do.
  if (name === "ApiError" && typeof status === "number" && typeof message === "string" && message) {
    return { kind: "failed", message };
  }
  return { kind: "failed", message: GENERIC_FAILURE };
}

type Gate = { tryEnter: () => boolean; leave: () => void };

export function createProviderSubmitter(options: {
  deps: ProviderDeps;
  /** Opens the sheet inside the session transition (sessionController.signInWithProvider). */
  signInWithProvider: (
    request: () => Promise<SocialSignInResponse>,
  ) => Promise<ProviderSignInResult>;
  login: (credential: ProviderCredential) => Promise<SocialSignInResponse>;
  gate: Gate;
  offered: () => OfferedProviders;
  /** Called once an attempt really starts, so the screen can show it. */
  onStart?: () => void;
}): (provider: SocialProvider) => Promise<ProviderOutcome> {
  return async (provider) => {
    if (!options.gate.tryEnter()) return { kind: "ignored" };
    options.onStart?.();
    try {
      return await options.signInWithProvider(async () => {
        const credential = await obtainCredential(provider, options.offered(), options.deps);
        return options.login(credential);
      });
    } catch (error) {
      return describeFailure(error);
    } finally {
      options.gate.leave();
    }
  };
}
