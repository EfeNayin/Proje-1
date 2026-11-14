/**
 * Authentication state, shared across the app.
 *
 * On launch the app has stored tokens but does not yet know whether they are
 * still valid, so `status` starts as "loading" and the router waits rather
 * than flashing the login screen at a user who is actually signed in.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import * as authApi from "../api/auth";
import type { AuthResponse, RegisterInput, UserProfile } from "../api/auth";
import { accountDeletionStore } from "../account/deletionSession";
import { clearAccountDeletedNotice, showAccountDeletedNotice } from "../account/deletionNotice";
import { setOnSessionExpired } from "../api/client";
import type { SocialSignInResponse } from "../api/social";
import { athleteExerciseHistoryStore } from "../coaching/athleteExerciseHistorySession";
import { athleteOverviewStore } from "../coaching/athleteOverviewSession";
import { athleteWorkoutsStore } from "../coaching/athleteWorkoutsSession";
import { coachingStore } from "../coaching/coachingSession";
import { programOffersStore } from "../coaching/programOffersSession";
import { programPreparationStore } from "../coaching/programPreparationSession";
import { receivedFeedbackStore } from "../coaching/receivedFeedbackSession";
import { workoutFeedbackStore } from "../coaching/workoutFeedbackSession";
import { dailyCheckinStore } from "../readiness/dailyCheckinSession";
import { nativeProviders } from "../social/nativeProviders";
import { onboardingStore } from "../social/providerSession";
import { restTimerStore } from "../workout/restTimerStore";
import { setDraftStore } from "../workout/setDraftStore";
import { clearPasswordChangedNotice } from "./passwordChangedNotice";
import { recoveryStore } from "./recoverySession";
import { createSessionController } from "./sessionController";
import type { ProviderSignInResult } from "./sessionController";

type AuthStatus = "loading" | "signedIn" | "signedOut" | "unavailable";

type AuthContextValue = {
  status: AuthStatus;
  user: UserProfile | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: RegisterInput) => Promise<void>;
  /** Google / Apple: opens the sheet inside `request` and signs in, or returns an onboarding offer. */
  signInWithProvider: (request: () => Promise<SocialSignInResponse>) => Promise<ProviderSignInResult>;
  /** Signs in with a server answer that carries tokens (account created or linked in onboarding). */
  establish: (request: () => Promise<AuthResponse>) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  retryRestore: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<UserProfile | null>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const retryRestore = useCallback(() => {
    setStatus("loading");
    setRestoreAttempt((attempt) => attempt + 1);
  }, []);

  // Coaching lists, a shown invite code, a connected athlete's workouts and
  // pending results belong to one account only, and answers still in flight must
  // not land on whoever signs in next.
  const controller = useMemo(
    () =>
      createSessionController({
        resetAccountState: () => {
          coachingStore.reset();
          athleteExerciseHistoryStore.reset();
          workoutFeedbackStore.reset();
          receivedFeedbackStore.reset();
          athleteWorkoutsStore.reset();
          athleteOverviewStore.reset();
          programOffersStore.reset();
          programPreparationStore.reset();
          dailyCheckinStore.reset();
          accountDeletionStore.reset();
          recoveryStore.reset();
          // A half-finished first Google/Apple sign-in belongs to nobody once the account changes.
          onboardingStore.clear();
          // The rest countdown belongs to the account's workout.
          restTimerStore.reset();
          setDraftStore.reset();
        },
        apply: (view) => {
          // Whoever signs in next is not told about the account that was deleted.
          if (view.status === "signedIn") {
            clearAccountDeletedNotice();
            clearPasswordChangedNotice();
          }
          setUser(view.user);
          setStatus(view.status);
        },
        announceDeletion: showAccountDeletedNotice,
      }),
    [],
  );

  // What happens, in which order, and what is guaranteed is in sessionController.ts.
  const signOut = useCallback(async () => {
    await controller.signOut();
  }, [controller]);

  // The HTTP client cannot import this provider without a cycle, so it calls
  // back here when a refresh fails and the session is unrecoverable. It has
  // already ended the account's epoch; this is a forced sign-out, treated like a
  // voluntary one for everything the device remembers about the account.
  useEffect(() => {
    setOnSessionExpired(controller.sessionExpired);
    return () => setOnSessionExpired(null);
  }, [controller]);

  // Once the server has confirmed a deletion, this ends the session on the device.
  // The store passes the sign-in the deletion was made under; a deletion answered
  // after another account signed in does nothing to that account.
  useEffect(() => {
    accountDeletionStore.setOnDeleted(async (epoch) => {
      await controller.accountDeleted(epoch);
    });
    return () => accountDeletionStore.setOnDeleted(null);
  }, [controller]);

  // Restore the session on launch.
  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      // Null when the account changed while this ran: its answer is obsolete.
      const restored = await controller.restore();
      if (!cancelled && restored) {
        setUser(restored.user);
        setStatus(restored.status);
      }
    };

    void restore();
    return () => {
      cancelled = true;
    };
  }, [controller, restoreAttempt]);

  const signIn = controller.signIn;
  const signUp = useCallback((input: RegisterInput) => controller.signUp(input), [controller]);
  const signInWithProvider = controller.signInWithProvider;
  const establish = controller.establish;

  const refreshProfile = useCallback(async () => {
    setUser(await authApi.fetchMe());
  }, []);

  // The person revoked Aures in their Apple ID settings. The server learns of it from Apple
  // and ends the sessions of an account that has no other way in; asking for the profile
  // here makes this device find out now instead of at its next request. An account with a
  // password simply stays signed in (the Apple link is gone, the account is not).
  const signedIn = status === "signedIn";
  useEffect(() => {
    if (!signedIn) return undefined;
    return nativeProviders.watchAppleRevocation(() => {
      void authApi.fetchMe().catch(() => undefined);
    });
  }, [signedIn]);

  const value = useMemo(
    () => ({
      status,
      user,
      signIn,
      signUp,
      signInWithProvider,
      establish,
      signOut,
      refreshProfile,
      retryRestore,
    }),
    [status, user, signIn, signUp, signInWithProvider, establish, signOut, refreshProfile, retryRestore],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return context;
}
