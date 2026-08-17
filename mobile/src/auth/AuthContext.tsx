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
import { clearTokens, getAccessToken, saveTokens } from "../api/tokens";

type AuthStatus = "loading" | "signedIn" | "signedOut";

type AuthContextValue = {
  status: AuthStatus;
  user: UserProfile | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: RegisterInput) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<UserProfile | null>(null);

  const signOut = useCallback(async () => {
    await clearTokens();
    setUser(null);
    setStatus("signedOut");
  }, []);

  // The HTTP client cannot import this provider without a cycle, so it calls
  // back here when a refresh fails and the session is unrecoverable.
  useEffect(() => {
    setOnSessionExpired(() => {
      void signOut();
    });
    return () => setOnSessionExpired(null);
  }, [signOut]);

  // Restore the session on launch.
  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      const token = await getAccessToken();
      if (!token) {
        if (!cancelled) setStatus("signedOut");
        return;
      }

      try {
        // If the access token has expired, the client refreshes transparently
        // here; only a genuinely dead session throws.
        const profile = await authApi.fetchMe();
        if (!cancelled) {
          setUser(profile);
          setStatus("signedIn");
        }
      } catch {
        if (!cancelled) {
          await clearTokens();
          setStatus("signedOut");
        }
      }
    };

    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

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
    () => ({ status, user, signIn, signUp, signOut, refreshProfile }),
    [status, user, signIn, signUp, signOut, refreshProfile],
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
