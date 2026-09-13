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
import { clearTokens, saveTokens } from "../api/tokens";
import { clearActiveWorkout } from "../workout/activeWorkout";
import { restoreSession } from "./restoreSession";

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

  const signOut = useCallback(async () => {
    await clearTokens();
    // The active-workout pointer is a device key (see src/workout/activeWorkout.ts),
    // not scoped to an account. Left in place, it would resume — or, worse,
    // silently point at — this account's in-progress session for whoever
    // signs in next on this device. Preferences such as rest length are
    // deliberately per-device and are not cleared here; this is only about
    // state that identifies a specific workout belonging to THIS account.
    await clearActiveWorkout();
    setUser(null);
    setStatus("signedOut");
  }, []);

  // The HTTP client cannot import this provider without a cycle, so it calls
  // back here when a refresh fails and the session is unrecoverable.
  useEffect(() => {
    setOnSessionExpired(() => {
      // The client has already cleared tokens before notifying us. This is
      // a forced sign-out, not a voluntary one, but the account-switch
      // reasoning is identical to signOut() below — the active-workout
      // pointer must not survive to whoever is signed in next on this
      // device — so it is cleared the same way. Fire-and-forget: nothing
      // useful can be done if this SecureStore write fails, and the
      // sign-out itself must not wait on it.
      void clearActiveWorkout();
      setUser(null);
      setStatus("signedOut");
    });
    return () => setOnSessionExpired(null);
  }, []);

  // Restore the session on launch.
  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      const restored = await restoreSession();
      if (!cancelled) {
        setUser(restored.user);
        setStatus(restored.status);
      }
    };

    void restore();
    return () => {
      cancelled = true;
    };
  }, [restoreAttempt]);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await authApi.login(email, password);
    await saveTokens(result.tokens);
    setUser(result.user);
    setStatus("signedIn");
  }, []);

  const signUp = useCallback(async (input: RegisterInput) => {
    const result = await authApi.register(input);
    await saveTokens(result.tokens);
    setUser(result.user);
    setStatus("signedIn");
  }, []);

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
