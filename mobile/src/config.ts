/**
 * App configuration.
 *
 * The API URL comes from EXPO_PUBLIC_API_URL in .env. Anything prefixed with
 * EXPO_PUBLIC_ is inlined at build time and readable from the client — fine
 * for a base URL, never for secrets.
 *
 * For the iOS Simulator use http://localhost:8000: the development backend is
 * published on 127.0.0.1 only (see README.md), so a physical phone, for which
 * localhost is the phone itself, cannot reach it.
 */

const url = process.env.EXPO_PUBLIC_API_URL;

if (!url) {
  throw new Error(
    "EXPO_PUBLIC_API_URL is not set. Copy .env.example to .env " +
      "(http://localhost:8000 for the iOS Simulator).",
  );
}

export const API_URL = url.replace(/\/$/, "");
export const API_PREFIX = "/api/v1";
