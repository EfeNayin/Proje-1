/**
 * "Add to my programs" for an example program, without ever making a second copy.
 *
 * The server makes the copy exactly once per (account, request id). This module owns
 * the request id:
 *
 *  - It is created and SAVED on the device before anything is sent, so a storage
 *    failure can never leave an untracked write in flight.
 *  - It is kept after an uncertain result (no connection, a lost response, a 5xx, the
 *    app being killed), and the next attempt for the same example and version sends
 *    the same id, so the server hands back the program the first attempt made.
 *  - It is removed once the outcome is known for certain: the copy exists, or the
 *    server refused without creating anything (the example changed, does not exist,
 *    cannot be resolved, or the earlier copy was deleted).
 *  - It is scoped by account. A different account never sees it, and a result for a
 *    session that is no longer current is dropped by the caller (see `isCurrent`).
 *
 * One attempt at a time per copier (the guard is a plain flag, not React state, so a
 * fast double tap cannot pass twice).
 */

import type { ProgramDetail } from "../api/programs";
import type { ExampleCopyBody } from "../api/examplePrograms";

export type PendingStore = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

export type CopyOutcome =
  | { kind: "ignored" } // an attempt is already running; it owns the busy state
  | { kind: "abandoned" } // the signed-in account changed; nothing may be shown or opened
  | { kind: "copied"; programId: string }
  | { kind: "stale"; message: string } // the example changed: reopen the preview
  | { kind: "failed"; message: string; retryable: boolean };

export type ExampleCopierDeps = {
  store: PendingStore;
  newRequestId: () => string;
  copy: (requestId: string, body: ExampleCopyBody) => Promise<Pick<ProgramDetail, "id">>;
  /** True while the account that started the attempt is still the signed-in one. */
  isCurrent: (userId: string) => boolean;
};

const key = (userId: string, exampleId: string, version: number) =>
  `bodytrack.example_copy.${userId}.${exampleId}.${version}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Failure = { status?: number; code?: string; message?: string };
const failureOf = (err: unknown): Failure =>
  typeof err === "object" && err !== null ? (err as Failure) : {};

/** The server said no and created nothing, so the id is spent and a new tap starts fresh. */
const DEFINITIVE_CODES = new Set([
  "example_version_changed",
  "example_unavailable",
  "example_request_mismatch",
]);

export function createExampleCopier(deps: ExampleCopierDeps) {
  let inFlight = false;

  /** The saved id for this exact example and version, or a new one, saved before use. */
  async function requestIdFor(userId: string, body: ExampleCopyBody): Promise<string> {
    const storageKey = key(userId, body.example_id, body.version);
    const saved = await deps.store.get(storageKey);
    if (saved !== null && UUID.test(saved)) return saved;
    const created = deps.newRequestId();
    await deps.store.set(storageKey, created);
    return created;
  }

  async function attempt(userId: string, body: ExampleCopyBody, again: boolean): Promise<CopyOutcome> {
    const storageKey = key(userId, body.example_id, body.version);
    let requestId: string;
    try {
      requestId = await requestIdFor(userId, body);
    } catch {
      // Nothing was sent. Without a saved id a retry could not be made safe.
      return {
        kind: "failed",
        message: "Could not prepare the request on this device. Nothing was added.",
        retryable: true,
      };
    }

    try {
      const program = await deps.copy(requestId, body);
      // If cleanup fails the id stays; replaying it later just returns this program.
      await deps.store.remove(storageKey).catch(() => undefined);
      return { kind: "copied", programId: program.id };
    } catch (err) {
      const { status, code, message } = failureOf(err);
      if (code === "example_copy_deleted" && again) {
        // The earlier attempt did commit, and the program was deleted since. This tap is
        // a new request.
        await deps.store.remove(storageKey).catch(() => undefined);
        return attempt(userId, body, false);
      }
      if (code === "example_version_changed") {
        await deps.store.remove(storageKey).catch(() => undefined);
        return {
          kind: "stale",
          message: message || "This example was updated. Open it again to see the current version.",
        };
      }
      const definitive =
        (code !== undefined && (DEFINITIVE_CODES.has(code) || code === "example_copy_deleted")) ||
        status === 404 ||
        status === 422;
      if (definitive) {
        await deps.store.remove(storageKey).catch(() => undefined);
        return { kind: "failed", message: message || "Could not add this example.", retryable: false };
      }
      // Unknown whether the server committed: keep the id so the retry cannot double up.
      return {
        kind: "failed",
        message:
          "Could not confirm that the program was added. Tap Add to my programs again; it will not " +
          "create a second copy.",
        retryable: true,
      };
    }
  }

  /** Adds the example, or finishes the earlier unresolved attempt for it. */
  return async function copy(
    userId: string,
    body: ExampleCopyBody,
    onStart?: () => void,
  ): Promise<CopyOutcome> {
    if (inFlight) return { kind: "ignored" };
    inFlight = true;
    onStart?.();
    try {
      const outcome = await attempt(userId, body, true);
      // The account changed while this ran: the result belongs to nobody on screen now.
      // (The id stays in the old account's own key.)
      if (!deps.isCurrent(userId)) return { kind: "abandoned" };
      return outcome;
    } finally {
      inFlight = false;
    }
  };
}

export type ExampleCopier = ReturnType<typeof createExampleCopier>;
