import { fetchMe } from "../api/auth";
import type { UserProfile } from "../api/auth";
import { ApiError } from "../api/client";
import { getAccessToken, getRefreshToken } from "../api/tokens";

export type RestoredSession =
  | { status: "signedIn"; user: UserProfile }
  | { status: "signedOut" | "unavailable"; user: null };

/** A failed connection cannot prove a stored session invalid. The API client
 * owns token invalidation; startup only decides which screen can be shown. */
export async function restoreSession(): Promise<RestoredSession> {
  try {
    const accessToken = await getAccessToken();
    const refreshToken = await getRefreshToken();
    if (!accessToken && !refreshToken) return { status: "signedOut", user: null };

    return { status: "signedIn", user: await fetchMe() };
  } catch (error) {
    return {
      status: error instanceof ApiError && error.status === 401 ? "signedOut" : "unavailable",
      user: null,
    };
  }
}
