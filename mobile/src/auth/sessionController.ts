/**
 * The transitions between accounts: sign in, sign up, sign out, forced expiry
 * and the launch-time restore. They live here, not in AuthContext, so the order
 * of their awaits can be tested without rendering anything.
 *
 * The rules they follow:
 *  - Leaving an account is immediate. The screens and every private store drop
 *    the account before any storage or network work starts; nothing waits on the
 *    Keychain, and nothing waits on the server.
 *  - Every transition moves the auth epoch on (see api/client.ts), so requests,
 *    refreshes and sign-in answers still in flight for the earlier account are
 *    obsolete and cannot write tokens, clear tokens or reach a caller.
 *  - A new account's tokens are written only after the previous account's
 *    sign-out cleanup has finished, so a late delete cannot remove them.
 */

import * as authApi from "../api/auth";
import type { AuthResponse, RegisterInput, UserProfile } from "../api/auth";
import { advanceAuthEpoch, currentAuthEpoch, persistTokens, SessionChangedError } from "../api/client";
import { clearTokens, takeRefreshToken } from "../api/tokens";
import { clearActiveWorkout } from "../workout/activeWorkout";
import { restoreSession } from "./restoreSession";
import type { RestoredSession } from "./restoreSession";

export type AccountView =
  | { status: "signedIn"; user: UserProfile }
  | { status: "signedOut"; user: null };

export type SessionHooks = {
  /** Drops everything private to the account: coaching lists, pending answers, shown codes. */
  resetAccountState: () => void;
  /** Shows this state. Called synchronously, never after an await that the caller of a transition does not control. */
  apply: (view: AccountView) => void;
};

/**
 * What a sign-out achieved. Two separate facts, on purpose:
 *  - `localClear`: this device holds no tokens and no active-workout pointer any more.
 *  - `revocation`: whether the server confirmed ending the session. It settles
 *    after the sign-out has already completed, is never awaited by the UI, and is
 *    attempted once; "unconfirmed" means the refresh token stays valid on the
 *    server until it expires (14 days), though no copy of it remains here.
 */
export type SignOutResult = {
  localClear: boolean;
  revocation: Promise<"confirmed" | "unconfirmed" | "none">;
};

export function createSessionController(hooks: SessionHooks) {
  // The previous account's cleanup (tokens, active-workout pointer). Never rejects.
  let cleanup: Promise<void> = Promise.resolve();

  function leaveAccount(): void {
    advanceAuthEpoch();
    hooks.resetAccountState();
    hooks.apply({ status: "signedOut", user: null });
  }

  async function signOut(): Promise<SignOutResult> {
    // Before any await: the epoch moves on, the stores reset, the screens leave.
    leaveAccount();

    let localClear = true;
    let refreshToken: string | null = null;
    const finished = (async () => {
      try {
        // One queued step: it reads the newest refresh token (including one whose
        // write was still pending) and clears both tokens, so nothing can land in
        // between. It is what lets the server end this session.
        refreshToken = await takeRefreshToken();
      } catch {
        try {
          await clearTokens();
        } catch {
          localClear = false;
        }
      }
      try {
        // A device key, not scoped to an account (see workout/activeWorkout.ts):
        // left in place it would point the next account at this one's workout.
        // Preferences such as rest length are per-device and stay.
        await clearActiveWorkout();
      } catch {
        localClear = false;
      }
    })();
    cleanup = finished;
    await finished;

    // Best effort, once, and not awaited: signing out on this device must not
    // depend on the network, and nothing is retried in the background where it
    // could outlive this session.
    const revocation: SignOutResult["revocation"] = refreshToken
      ? authApi.logout(refreshToken).then(
          () => "confirmed" as const,
          () => "unconfirmed" as const,
        )
      : Promise.resolve("none" as const);
    return { localClear, revocation };
  }

  /** The API client gave up on the session (refresh rejected). The epoch has moved on already. */
  function sessionExpired(): void {
    cleanup = clearActiveWorkout().catch(() => undefined);
    hooks.resetAccountState();
    hooks.apply({ status: "signedOut", user: null });
  }

  async function establish(request: () => Promise<AuthResponse>): Promise<void> {
    // A new sign-in supersedes whatever an earlier attempt, or the previous
    // account, still has in flight.
    const epoch = advanceAuthEpoch();
    const result = await request();
    await cleanup;
    if (!(await persistTokens(result.tokens, epoch))) throw new SessionChangedError();
    if (currentAuthEpoch() !== epoch) throw new SessionChangedError();
    hooks.apply({ status: "signedIn", user: result.user });
  }

  function signIn(email: string, password: string): Promise<void> {
    return establish(() => authApi.login(email, password));
  }

  function signUp(input: RegisterInput): Promise<void> {
    return establish(() => authApi.register(input));
  }

  /** The launch-time restore, or null when the account changed while it ran. */
  async function restore(): Promise<RestoredSession | null> {
    const epoch = currentAuthEpoch();
    const restored = await restoreSession();
    return currentAuthEpoch() === epoch ? restored : null;
  }

  return { signIn, signUp, signOut, sessionExpired, restore };
}

export type SessionController = ReturnType<typeof createSessionController>;
