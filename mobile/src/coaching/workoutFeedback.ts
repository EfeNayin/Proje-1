import type { CoachFeedback, CoachFeedbackResult } from "../api/coaching";

/**
 * A coach's feedback entry on one completed workout of a sharing athlete, kept
 * out of the screen so the rules that matter can be tested without rendering.
 *
 * - Everything belongs to one context (account, connection, workout). A
 *   different context starts from nothing; `close()` and `reset()` (sign-out,
 *   session expiry, a loss of access) drop the entry, the draft and every
 *   answer still in flight.
 * - One operation at a time (load, save, delete). Taps while one runs are
 *   ignored, so nothing is sent twice.
 * - The draft lives here, not in the screen, and survives an ordinary failed
 *   save. A new entry is created under a request id that is reused only for
 *   the exact same text: a retry after a lost answer cannot make a second
 *   entry, and an edited draft never rides on an earlier operation identity.
 *   Edits and deletes name the version they saw.
 * - A 409 means the entry changed (or appeared, or went) elsewhere. The latest
 *   copy is fetched and the coach must choose: keep their text (then save
 *   again against the latest version) or take the latest. Nothing is
 *   overwritten silently.
 * - The backend decides access on every call. A 403 (sharing off) closes
 *   everything and reports it; a 404 (connection ended, workout gone) clears
 *   everything and reports it so the caller can find out which. Nothing,
 *   draft included, is kept after a refusal.
 */

export const FEEDBACK_MAX_LENGTH = 2000;

export type WorkoutFeedbackApi = {
  get: (linkId: string, workoutId: string) => Promise<CoachFeedbackResult>;
  create: (
    linkId: string,
    workoutId: string,
    requestId: string,
    body: string,
  ) => Promise<CoachFeedback>;
  update: (
    linkId: string,
    workoutId: string,
    body: string,
    expectedVersion: number,
  ) => Promise<CoachFeedback>;
  remove: (linkId: string, workoutId: string, expectedVersion: number) => Promise<void>;
};

export type FeedbackContext = { userId: string; linkId: string; workoutId: string };

export type FeedbackRefusals = {
  /** The athlete's sharing switch is off (403). */
  onForbidden: (context: FeedbackContext) => void;
  /** 404: the connection ended, or the workout is no longer there. */
  onUnavailable: (context: FeedbackContext) => void;
};

export type FeedbackConflict = {
  /** What the coach was doing when the entry turned out to have changed. */
  action: "save" | "delete";
  /** The entry as it is now; null: it is gone. Meaningful only once `loaded`. */
  latest: CoachFeedback | null;
  /** False while the latest copy could not be fetched; nothing may be resolved yet. */
  loaded: boolean;
};

export type WorkoutFeedbackState = {
  /** null: nothing is held. */
  context: FeedbackContext | null;
  /** The coach's entry as last read from or written to the server. */
  saved: CoachFeedback | null;
  /** True once the entry (or its absence) was read for this context. */
  loaded: boolean;
  loading: boolean;
  /** The first read failed. */
  loadError: boolean;
  editing: boolean;
  draft: string;
  saving: boolean;
  deleting: boolean;
  /** An ordinary failure of the last save or delete; the draft is kept. */
  error: string | null;
  conflict: FeedbackConflict | null;
  /** The backend says this workout is no longer reachable for this coach. */
  unavailable: boolean;
};

const closed = (): WorkoutFeedbackState => ({
  context: null,
  saved: null,
  loaded: false,
  loading: false,
  loadError: false,
  editing: false,
  draft: "",
  saving: false,
  deleting: false,
  error: null,
  conflict: null,
  unavailable: false,
});

export const initialWorkoutFeedbackState = closed;

export function sameFeedbackContext(
  a: FeedbackContext | null | undefined,
  b: FeedbackContext | null | undefined,
): boolean {
  return (
    !!a && !!b && a.userId === b.userId && a.linkId === b.linkId && a.workoutId === b.workoutId
  );
}

/** What is wrong with a draft, judged on the text the backend would store. */
export function draftProblem(draft: string): "empty" | "too_long" | "invalid" | null {
  const body = draft.trim();
  if (body.length === 0) return "empty";
  if (draft.length > FEEDBACK_MAX_LENGTH) return "too_long";
  if (body.includes("\u0000")) return "invalid";
  return null;
}

const PROBLEM_TEXT = {
  empty: "Write some feedback first.",
  too_long: `Feedback can be at most ${FEEDBACK_MAX_LENGTH} characters.`,
  invalid: "This text contains a character that cannot be saved.",
} as const;

const statusOf = (error: unknown): number | null => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
};

const messageOf = (error: unknown): string => {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && message.length > 0
    ? message
    : "Something went wrong. Try again.";
};

function validEntry(value: unknown): value is CoachFeedback {
  const entry = value as CoachFeedback | null;
  return (
    entry !== null &&
    typeof entry === "object" &&
    typeof entry.id === "string" &&
    typeof entry.body === "string" &&
    typeof entry.version === "number" &&
    typeof entry.created_at === "string" &&
    typeof entry.updated_at === "string"
  );
}

/** A reply of the wrong shape is a failed call, not something to draw. */
function validEntryOrThrow(value: unknown): CoachFeedback {
  if (!validEntry(value)) throw new Error("Unexpected feedback response");
  return value;
}

function validResult(value: CoachFeedbackResult): CoachFeedback | null {
  const feedback = (value as CoachFeedbackResult | null)?.feedback;
  if (feedback === null) return null;
  return validEntryOrThrow(feedback);
}

export function createWorkoutFeedbackStore(
  api: WorkoutFeedbackApi,
  refusals: FeedbackRefusals,
  newRequestId: () => string,
) {
  let state = closed();
  // Bumped by every open of another context, close and reset: everything in flight is void.
  let generation = 0;
  let busy = false;
  // The create that may or may not have reached the server, tied to its exact text.
  let attempt: { requestId: string; body: string } | null = null;
  const listeners = new Set<() => void>();

  const publish = (changes: Partial<WorkoutFeedbackState>) => {
    state = { ...state, ...changes };
    listeners.forEach((listener) => listener());
  };

  function close() {
    generation += 1;
    busy = false;
    attempt = null;
    state = closed();
    listeners.forEach((listener) => listener());
  }

  /** True when the error was a refusal; everything has then been cleared. */
  function refused(error: unknown, context: FeedbackContext): boolean {
    const status = statusOf(error);
    if (status === 403) {
      close();
      refusals.onForbidden(context);
      return true;
    }
    if (status === 404) {
      generation += 1;
      busy = false;
      attempt = null;
      state = { ...closed(), context, unavailable: true };
      listeners.forEach((listener) => listener());
      refusals.onUnavailable(context);
      return true;
    }
    return false;
  }

  /** Read the entry. `quiet`: a refresh of something already shown. */
  async function read(quiet: boolean): Promise<void> {
    const context = state.context;
    if (!context || busy) return;
    const mine = generation;
    busy = true;
    publish({ loading: !quiet, loadError: false });
    try {
      const saved = validResult(await api.get(context.linkId, context.workoutId));
      if (mine !== generation) return;
      // A draft was started while this was in flight: it is based on what was
      // shown then, so an answer that may differ must not slide under it.
      if (quiet && state.editing) {
        publish({ loading: false });
        return;
      }
      publish({ saved, loaded: true, loading: false, loadError: false });
    } catch (error) {
      if (mine !== generation) return;
      if (refused(error, context)) return;
      publish({ loading: false, loadError: !state.loaded });
    } finally {
      if (mine === generation) busy = false;
    }
  }

  /** Fetch the latest copy after a 409 so the coach can review it. Runs inside `busy`. */
  async function fetchConflict(
    context: FeedbackContext,
    mine: number,
    action: "save" | "delete",
  ): Promise<void> {
    try {
      const latest = validResult(await api.get(context.linkId, context.workoutId));
      if (mine !== generation) return;
      publish({
        saving: false,
        deleting: false,
        error: null,
        conflict: { action, latest, loaded: true },
      });
    } catch (error) {
      if (mine !== generation) return;
      if (refused(error, context)) return;
      publish({
        saving: false,
        deleting: false,
        error: null,
        conflict: { action, latest: null, loaded: false },
      });
    }
  }

  /** Open for this context and read the entry. Opening the one already open refreshes it. */
  function open(context: FeedbackContext): Promise<void> {
    if (sameFeedbackContext(state.context, context)) {
      return refresh();
    }
    close();
    state = { ...closed(), context };
    listeners.forEach((listener) => listener());
    return read(false);
  }

  /** Read again without disturbing a draft, a conflict or a running operation. */
  function refresh(): Promise<void> {
    const { context, editing, conflict, unavailable, loaded } = state;
    if (!context || busy || editing || conflict || unavailable) return Promise.resolve();
    return read(loaded);
  }

  /** Retry a first read that failed. */
  function retryLoad(): Promise<void> {
    if (!state.context || state.loaded || state.unavailable) return Promise.resolve();
    return read(false);
  }

  function startEditing() {
    if (!state.context || !state.loaded || busy || state.conflict || state.editing) return;
    publish({ editing: true, draft: state.saved?.body ?? "", error: null });
  }

  function cancelEditing() {
    if (busy || !state.editing) return;
    publish({ editing: false, draft: "", error: null });
  }

  function setDraft(text: string) {
    if (!state.editing || busy || state.conflict) return;
    publish({ draft: text, error: null });
  }

  async function save(): Promise<void> {
    const context = state.context;
    if (!context || busy || !state.loaded || !state.editing || state.conflict) return;
    const problem = draftProblem(state.draft);
    if (problem) {
      publish({ error: PROBLEM_TEXT[problem] });
      return;
    }
    const body = state.draft.trim();
    const current = state.saved;
    if (current !== null && current.body === body) {
      // Nothing changed: nothing to send.
      publish({ editing: false, draft: "", error: null });
      return;
    }
    const mine = generation;
    busy = true;
    publish({ saving: true, error: null });
    try {
      let result: CoachFeedback;
      if (current === null) {
        const requestId = attempt?.body === body ? attempt.requestId : newRequestId();
        attempt = { requestId, body };
        result = validEntryOrThrow(
          await api.create(context.linkId, context.workoutId, requestId, body),
        );
      } else {
        result = validEntryOrThrow(
          await api.update(context.linkId, context.workoutId, body, current.version),
        );
      }
      if (mine !== generation) return;
      attempt = null;
      publish({ saved: result, editing: false, draft: "", saving: false, error: null });
    } catch (error) {
      if (mine !== generation) return;
      if (refused(error, context)) return;
      if (statusOf(error) === 409) {
        await fetchConflict(context, mine, "save");
        return;
      }
      // The draft stays as typed; a repeat of the same text is safe.
      publish({ saving: false, error: messageOf(error) });
    } finally {
      if (mine === generation) busy = false;
    }
  }

  async function remove(): Promise<void> {
    const context = state.context;
    const current = state.saved;
    if (!context || busy || !current || state.conflict || state.editing) return;
    const mine = generation;
    busy = true;
    publish({ deleting: true, error: null });
    try {
      await api.remove(context.linkId, context.workoutId, current.version);
      if (mine !== generation) return;
      attempt = null;
      publish({ saved: null, editing: false, draft: "", deleting: false, error: null });
    } catch (error) {
      if (mine !== generation) return;
      if (refused(error, context)) return;
      if (statusOf(error) === 409) {
        await fetchConflict(context, mine, "delete");
        return;
      }
      publish({ deleting: false, error: messageOf(error) });
    } finally {
      if (mine === generation) busy = false;
    }
  }

  /** The latest copy could not be fetched after a 409: try that again. */
  async function retryConflict(): Promise<void> {
    const context = state.context;
    const conflict = state.conflict;
    if (!context || !conflict || conflict.loaded || busy) return;
    const mine = generation;
    busy = true;
    try {
      await fetchConflict(context, mine, conflict.action);
    } finally {
      if (mine === generation) busy = false;
    }
  }

  /**
   * "Keep my text": the latest copy is now the base, the draft stays, and the
   * coach saves again on purpose. Only after the latest copy was seen.
   */
  function keepMine() {
    const conflict = state.conflict;
    if (!conflict || !conflict.loaded || conflict.action !== "save") return;
    publish({ saved: conflict.latest, conflict: null, editing: true, error: null });
  }

  /** "Use the latest": drop the draft and show what is stored now. */
  function useLatest() {
    const conflict = state.conflict;
    if (!conflict || !conflict.loaded) return;
    attempt = null;
    publish({ saved: conflict.latest, conflict: null, editing: false, draft: "", error: null });
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open,
    close,
    reset: close,
    refresh,
    retryLoad,
    startEditing,
    cancelEditing,
    setDraft,
    save,
    remove,
    retryConflict,
    keepMine,
    useLatest,
  };
}
