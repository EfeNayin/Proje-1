/**
 * HTTP client.
 *
 * Attaches the access token, and on a 401 refreshes once and retries.
 *
 * The refresh is deliberately single-flight, and that is not just an
 * optimisation. The backend rotates refresh tokens and treats a second use of
 * an already-rotated token as a stolen-token replay, revoking *every* session
 * for that account. If two screens each hit a 401 at the same moment and both
 * called /auth/refresh with the same stored token, the second call would look
 * exactly like a replay and log the user out. So concurrent callers share one
 * in-flight refresh instead.
 *
 * Every authenticated request, and every refresh, also belongs to the sign-in
 * that was current when it started (the "auth epoch"). Signing out, the session
 * expiring and starting a new sign-in each move the epoch on, and whatever was
 * still in flight from the earlier one is obsolete from then on: it may not
 * write tokens, clear tokens, report a session expiry, or hand its answer to a
 * caller, because by then those would land on, or against, a different account.
 */

import { API_PREFIX, API_URL } from "../config";
import {
  clearTokens,
  clearTokensIfOwner,
  getAccessToken,
  getRefreshToken,
  saveTokensIf,
} from "./tokens";
import type { TokenPair } from "./tokens";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** An obsolete request: the account it was made for is no longer the signed-in one. */
export class SessionChangedError extends ApiError {
  constructor() {
    // 401 because the credentials it used are gone; nothing may retry it.
    super(401, "Your session changed while this request was running.");
    this.name = "SessionChangedError";
  }
}

let authEpoch = 0;

export function currentAuthEpoch(): number {
  return authEpoch;
}

/** Ends the current epoch: everything still in flight from it becomes obsolete. */
export function advanceAuthEpoch(): number {
  authEpoch += 1;
  return authEpoch;
}

/**
 * Stores a token pair for the sign-in `epoch`, unless that sign-in is over.
 * Resolves false (and leaves storage as it was) when it is. The currency check
 * runs in the storage queue immediately before the write, and again after it:
 * if the epoch moved on while the write was still running, the write is taken
 * back, but only if nothing newer has replaced it.
 */
export async function persistTokens(pair: TokenPair, epoch: number): Promise<boolean> {
  const owner = {};
  const saved = await saveTokensIf(pair, owner, () => authEpoch === epoch);
  if (saved && authEpoch !== epoch) {
    await clearTokensIfOwner(owner);
    return false;
  }
  return saved;
}

/** Called when the session cannot be recovered, so the UI can send the user to login. */
let onSessionExpired: (() => void) | null = null;

export function setOnSessionExpired(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

/**
 * The refresh currently in flight, shared by every caller that hits a 401 in
 * the same epoch. A caller from a later epoch does not join an earlier one: its
 * answer would belong to the wrong account.
 */
let refreshInFlight: { epoch: number; promise: Promise<boolean> } | null = null;

async function performRefresh(epoch: number): Promise<boolean> {
  const refreshToken = await getRefreshToken();
  if (authEpoch !== epoch) throw new SessionChangedError();
  if (!refreshToken) return false;

  const response = await fetchWithNetworkError(`${API_URL}${API_PREFIX}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  // Only an explicit authentication rejection proves the session invalid.
  // Network errors, rate limits and server failures must preserve tokens.
  if (response.status === 401) return false;
  if (!response.ok) {
    throw new ApiError(response.status, await extractError(response));
  }

  const pair: TokenPair = await response.json();
  // The server has rotated the token by now. If the sign-in ended while it was
  // answering (signed out, expired, replaced), the new pair is dropped; keeping
  // it would bring a signed-out session back, or overwrite the next account's.
  if (!(await persistTokens(pair, epoch))) throw new SessionChangedError();
  return true;
}

async function fetchWithNetworkError(url: string, options: RequestInit): Promise<Response> {
  try {
    return await fetch(url, options);
  } catch {
    throw new ApiError(0, "Cannot connect right now. Check your connection and try again.");
  }
}

async function expireSession(): Promise<never> {
  // Only ever called straight after assertCurrent(), with no await in between,
  // so the sign-in that was refused is still the current one: a request from an
  // earlier sign-in never gets here to sign out whoever is signed in now.
  advanceAuthEpoch();
  // Tell the auth layer first, so the screens leave the account at once and do
  // not wait for storage. It also clears account-scoped device state beyond the
  // tokens (the active-workout pointer, the coaching stores): this HTTP layer
  // only knows about tokens, and `onSessionExpired` is exactly the hook that
  // exists so the caller who does know about that state can react to a forced
  // sign-out the same way as to an explicit one.
  onSessionExpired?.();
  await clearTokens();
  throw new ApiError(401, "Your session has expired. Please sign in again.");
}

function refreshSession(epoch: number): Promise<boolean> {
  if (refreshInFlight?.epoch === epoch) return refreshInFlight.promise;
  const promise = performRefresh(epoch).finally(() => {
    if (refreshInFlight?.promise === promise) refreshInFlight = null;
  });
  refreshInFlight = { epoch, promise };
  return promise;
}

async function extractError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    // FastAPI returns {detail: "..."} for our AppError, or a list of objects
    // for Pydantic validation failures.
    if (typeof body?.detail === "string") return body.detail;
    if (Array.isArray(body?.detail)) {
      return body.detail.map((item: { msg?: string }) => item.msg).filter(Boolean).join(", ");
    }
  } catch {
    // Response was not JSON.
  }
  return `Request failed (${response.status})`;
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Skip the Authorization header, for login and register. */
  anonymous?: boolean;
};

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, anonymous = false } = options;

  // The sign-in this request was made for. Anonymous requests (login, register,
  // logout) carry no session; their callers guard them.
  const epoch = authEpoch;
  const assertCurrent = (): void => {
    if (!anonymous && authEpoch !== epoch) throw new SessionChangedError();
  };

  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };

    if (!anonymous) {
      const token = await getAccessToken();
      // Not sent under credentials that were read for another account.
      assertCurrent();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    return fetchWithNetworkError(`${API_URL}${API_PREFIX}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };

  let response = await send();
  assertCurrent();

  // Access tokens are short-lived, so a 401 usually just means "expired".
  if (response.status === 401 && !anonymous) {
    const recovered = await refreshSession(epoch);
    assertCurrent();
    if (!recovered) {
      return expireSession();
    }
    response = await send();
    assertCurrent();
    if (response.status === 401) return expireSession();
  }

  if (!response.ok) {
    const error = new ApiError(response.status, await extractError(response));
    assertCurrent();
    throw error;
  }

  // 204 No Content has an empty body; calling .json() on it throws.
  if (response.status === 204) return undefined as T;

  const data = (await response.json()) as T;
  // An answer for an account that has since signed out is not handed on.
  assertCurrent();
  return data;
}
