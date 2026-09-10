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
 */

import { API_PREFIX, API_URL } from "../config";
import { clearTokens, getAccessToken, getRefreshToken, saveTokens } from "./tokens";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Called when the session cannot be recovered, so the UI can send the user to login. */
let onSessionExpired: (() => void) | null = null;

export function setOnSessionExpired(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

/** The refresh currently in flight, shared by every caller that hits a 401. */
let refreshInFlight: Promise<boolean> | null = null;

async function performRefresh(): Promise<boolean> {
  const refreshToken = await getRefreshToken();
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

  await saveTokens(await response.json());
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
  await clearTokens();
  onSessionExpired?.();
  throw new ApiError(401, "Your session has expired. Please sign in again.");
}

async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= performRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
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

  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };

    if (!anonymous) {
      const token = await getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    return fetchWithNetworkError(`${API_URL}${API_PREFIX}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };

  let response = await send();

  // Access tokens are short-lived, so a 401 usually just means "expired".
  if (response.status === 401 && !anonymous) {
    const recovered = await refreshSession();
    if (!recovered) {
      return expireSession();
    }
    response = await send();
    if (response.status === 401) return expireSession();
  }

  if (!response.ok) {
    throw new ApiError(response.status, await extractError(response));
  }

  // 204 No Content has an empty body; calling .json() on it throws.
  if (response.status === 204) return undefined as T;

  return response.json() as Promise<T>;
}
