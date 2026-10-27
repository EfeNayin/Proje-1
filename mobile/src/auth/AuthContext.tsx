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
import type { RegisterInput, UserProfile } from "../api/auth";
import { setOnSessionExpired } from "../api/client";
import { athleteExerciseHistoryStore } from "../coaching/athleteExerciseHistorySession";
import { athleteOverviewStore } from "../coaching/athleteOverviewSession";
import { athleteWorkoutsStore } from "../coaching/athleteWorkoutsSession";
import { coachingStore } from "../coaching/coachingSession";
import { programOffersStore } from "../coaching/programOffersSession";
import { receivedFeedbackStore } from "../coaching/receivedFeedbackSession";
import { workoutFeedbackStore } from "../coaching/workoutFeedbackSession";
import { createSessionController } from "./sessionController";

type AuthStatus = "loading" | "signedIn" | "signedOut" | "unavailable";

type AuthContextValue = {
  status: AuthStatus;
  user: UserProfile | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: RegisterInput) => Promise<void>;
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
        },
        apply: (view) => {
          setUser(view.user);
          setStatus(view.status);
        },
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

  const refreshProfile = useCallback(async () => {
    setUser(await authApi.fetchMe());
  }, []);

  const value = useMemo(
    () => ({ status, user, signIn, signUp, signOut, refreshProfile, retryRestore }),
    [status, user, signIn, signUp, signOut, refreshProfile, retryRestore],
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
