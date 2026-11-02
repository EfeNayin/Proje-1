import type { ReadinessLog, ReadinessPatch } from "../api/readiness";
import { parseSleepText, SLEEP_HOURS_HELP, sleepTextOf } from "./checkinPayload";

/**
 * The standalone daily check-in: record today's sleep (and how it felt) without
 * starting a workout. State lives here, not in the screen, so the rules that matter can
 * be tested without rendering anything.
 *
 * - Only fields the user changed are sent (PATCH), so mood, notes, soreness and anything
 *   else recorded earlier today are never replaced by this screen. Clearing a field is a
 *   change too (sent as null).
 * - The day comes from the server (GET today); the save names that day, and the server
 *   refuses it if the user's local day has changed. The draft is kept and re-based.
 * - Nothing here can start or create a workout: the API has no workout calls.
 * - One save at a time, held here and not in React state. A failed save (unclear or
 *   refused) keeps the draft; saving again is safe because the same fields give the
 *   same result.
 * - Everything belongs to one signed-in user: reset() (sign-out) and bind() with another
 *   user drop it and void every request still in flight.
 */

export type CheckinApi = {
  getToday: () => Promise<ReadinessLog>;
  patchToday: (payload: ReadinessPatch) => Promise<ReadinessLog>;
};

export type Draft = {
  sleepText: string;
  sleepQuality: number | null;
  energy: number | null;
};

export type DailyCheckinState = {
  userId: string | null;
  phase: "idle" | "loading" | "ready" | "failed";
  /** Today's record as the server last returned it (the base the draft is compared against). */
  log: ReadinessLog | null;
  draft: Draft;
  saving: boolean;
  /** A load problem (phase "failed") or a save problem; the draft is kept either way. */
  error: string | null;
  /** A validation message for the sleep field, shown beside it. */
  sleepError: string | null;
};

export type SaveOutcome =
  | { kind: "done"; log: ReadinessLog }
  /** Nothing differs from what is recorded: no request was made. */
  | { kind: "nothing" }
  | { kind: "invalid"; message: string }
  | { kind: "ignored" }
  | { kind: "stale" }
  /** The local day changed since the screen loaded; nothing was saved, the draft is kept. */
  | { kind: "day-changed"; message: string }
  | { kind: "failed"; message: string }
  /** Unconfirmed (no answer or a server error). Saving again repeats the same fields. */
  | { kind: "unknown"; message: string };

const emptyDraft = (): Draft => ({ sleepText: "", sleepQuality: null, energy: null });

export function draftOf(log: ReadinessLog): Draft {
  return {
    sleepText: sleepTextOf(log.sleep_hours),
    sleepQuality: log.sleep_quality,
    energy: log.energy,
  };
}

export function initialDailyCheckinState(userId: string | null = null): DailyCheckinState {
  return {
    userId, phase: "idle", log: null, draft: emptyDraft(), saving: false, error: null, sleepError: null,
  };
}

const statusOf = (error: unknown): number | null => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
};
const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;
const isDefinitive = (error: unknown): boolean => {
  const status = statusOf(error);
  return status !== null && status >= 400 && status < 500 && status !== 408;
};

type Changes = { payload: ReadinessPatch; fields: (keyof Draft)[] };

/** The fields whose draft value differs from what is recorded, ready to send; or an error. */
function changesOf(
  log: ReadinessLog,
  draft: Draft,
): { ok: true; changes: Changes } | { ok: false; message: string } {
  const payload: ReadinessPatch = {};
  const fields: (keyof Draft)[] = [];
  const sleep = parseSleepText(draft.sleepText);
  if (sleep.kind === "invalid") return { ok: false, message: SLEEP_HOURS_HELP };
  const recorded = log.sleep_hours === null ? null : Number(log.sleep_hours);
  const wanted = sleep.kind === "valid" ? sleep.hours : null;
  if (wanted !== recorded) {
    payload.sleep_hours = wanted;
    fields.push("sleepText");
  }
  if (draft.sleepQuality !== log.sleep_quality) {
    payload.sleep_quality = draft.sleepQuality;
    fields.push("sleepQuality");
  }
  if (draft.energy !== log.energy) {
    payload.energy = draft.energy;
    fields.push("energy");
  }
  return { ok: true, changes: { payload, fields } };
}

export function createDailyCheckinStore(api: CheckinApi) {
  let state = initialDailyCheckinState();
  let generation = 0;
  let loading = false;
  let saving = false;
  const listeners = new Set<() => void>();

  const publish = (changes: Partial<DailyCheckinState>) => {
    state = { ...state, ...changes };
    listeners.forEach((listener) => listener());
  };

  function resetTo(userId: string | null) {
    generation += 1;
    loading = saving = false;
    state = initialDailyCheckinState(userId);
    listeners.forEach((listener) => listener());
  }

  /**
   * Load (or re-load) today's record. A draft the user already changed is kept: only the
   * fields they did not touch take the server's values.
   */
  async function load(): Promise<void> {
    if (!state.userId || loading) return;
    const request = generation;
    loading = true;
    const keepEdits = state.log !== null;
    const previous = state;
    publish({ phase: previous.log ? "ready" : "loading", error: null });
    try {
      const log = await api.getToday();
      if (request !== generation) return;
      let draft = draftOf(log);
      if (keepEdits && previous.log) {
        // A field the user changed relative to the OLD base keeps their draft value, even
        // if it is not valid yet (a typo is theirs to fix, not ours to drop).
        const base = draftOf(previous.log);
        draft = {
          sleepText: previous.draft.sleepText !== base.sleepText ? previous.draft.sleepText : draft.sleepText,
          sleepQuality: previous.draft.sleepQuality !== base.sleepQuality ? previous.draft.sleepQuality : draft.sleepQuality,
          energy: previous.draft.energy !== base.energy ? previous.draft.energy : draft.energy,
        };
      }
      publish({ phase: "ready", log, draft, error: null });
    } catch (error) {
      if (request !== generation) return;
      // A failed re-load keeps the draft on screen; a failed first load has nothing to show.
      publish({
        phase: state.log ? "ready" : "failed",
        error: messageOf(error, "Could not load today's check-in"),
      });
    } finally {
      if (request === generation) loading = false;
    }
  }

  function edit(changes: Partial<Draft>) {
    if (state.phase !== "ready" || state.saving) return;
    publish({
      draft: { ...state.draft, ...changes },
      error: null,
      sleepError: "sleepText" in changes ? null : state.sleepError,
    });
  }

  async function save(): Promise<SaveOutcome> {
    const { userId, log, draft } = state;
    if (!userId || !log || state.phase !== "ready") return { kind: "stale" };
    if (saving) return { kind: "ignored" };
    const computed = changesOf(log, draft);
    if (!computed.ok) {
      publish({ sleepError: computed.message });
      return { kind: "invalid", message: computed.message };
    }
    if (computed.changes.fields.length === 0) return { kind: "nothing" };

    const request = generation;
    saving = true;
    publish({ saving: true, error: null, sleepError: null });
    try {
      const saved = await api.patchToday({
        ...computed.changes.payload,
        expected_log_date: log.log_date,
      });
      if (request !== generation) return { kind: "stale" };
      publish({ log: saved, draft: draftOf(saved) });
      return { kind: "done", log: saved };
    } catch (error) {
      if (request !== generation) return { kind: "stale" };
      if (statusOf(error) === 409) {
        const message =
          "The day changed while you were editing, so nothing was saved. Your entries are kept; check them and save again for today.";
        publish({ error: message });
        // Re-base on the new day without touching what the user typed.
        saving = false;
        publish({ saving: false });
        await load();
        return { kind: "day-changed", message };
      }
      const message = messageOf(error, "Could not save the check-in");
      if (isDefinitive(error)) {
        publish({ error: message });
        return { kind: "failed", message };
      }
      const unclear =
        "We could not confirm the check-in was saved. Your entries are kept: save again, it will not be saved twice.";
      publish({ error: unclear });
      return { kind: "unknown", message: unclear };
    } finally {
      if (request === generation) {
        saving = false;
        publish({ saving: false });
      }
    }
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Point the store at a user. Switching to a different one drops everything. */
    bind: (userId: string | null) => {
      if (state.userId !== userId) resetTo(userId);
    },
    /** Sign-out and session expiry: forget everything and ignore what is still in flight. */
    reset: () => resetTo(null),
    load,
    edit,
    save,
  };
}
