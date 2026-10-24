import type { Connection, InviteCreated, InvitePreview } from "../api/coaching";

/**
 * Client-side state for coach mode, invites and connections, kept out of the
 * screens so the rules that matter can be tested without rendering anything.
 *
 * - Everything belongs to one signed-in user. `reset()` (sign-out, session
 *   expiry) and `bind()` with a different id drop the lists, the invite code
 *   and every pending result, and invalidate requests still in flight: their
 *   answers come back as `stale` and change nothing.
 * - Each action has an in-flight lock held here, not in React state (state only
 *   updates on the next render, so two quick taps could both read "idle").
 * - A failed reload keeps the list already on screen.
 * - When a write fails in a way that does not tell us whether it happened
 *   (network loss, a timeout, a 5xx), the result is re-read from the server
 *   instead of being reported as a plain failure.
 */

export type CoachingApi = {
  enableCoach: () => Promise<unknown>;
  createInvite: () => Promise<InviteCreated>;
  previewInvite: (code: string) => Promise<InvitePreview>;
  acceptInvite: (code: string) => Promise<Connection>;
  listAthletes: () => Promise<Connection[]>;
  listCoaches: () => Promise<Connection[]>;
  endConnection: (linkId: string) => Promise<void>;
};

export type ListState = {
  items: Connection[];
  /** True once a load has succeeded for this user. */
  loaded: boolean;
  loading: boolean;
  /** The last load failed; `items`, if any, are older than this. */
  error: string | null;
};

export type CoachingState = {
  /** Whose data this is. */
  userId: string | null;
  coaches: ListState;
  athletes: ListState;
  invite: { creating: boolean; created: InviteCreated | null; error: string | null };
  enabling: boolean;
  accepting: boolean;
  /** Connections with an end request running. */
  ending: string[];
};

export type Role = "coach" | "athlete";

export type ActionOutcome =
  | { kind: "done" }
  | { kind: "ignored" } // the same action is already running
  | { kind: "stale" } // the user changed while it ran; touch nothing
  | { kind: "failed"; message: string; ambiguous: boolean }
  /** A write whose result could not be confirmed either way. */
  | { kind: "unknown"; message: string };

export type PreviewOutcome =
  | { kind: "ok"; preview: InvitePreview }
  | { kind: "ignored" }
  | { kind: "stale" }
  | { kind: "failed"; message: string };

export type AcceptOutcome =
  | { kind: "done"; connection: Connection }
  | Exclude<ActionOutcome, { kind: "done" }>;

const emptyList = (): ListState => ({ items: [], loaded: false, loading: false, error: null });

export function initialCoachingState(userId: string | null = null): CoachingState {
  return {
    userId,
    coaches: emptyList(),
    athletes: emptyList(),
    invite: { creating: false, created: null, error: null },
    enabling: false,
    accepting: false,
    ending: [],
  };
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * True when the server clearly answered "no" (a 4xx): nothing was changed. A
 * missing status (network failure), a timeout or a 5xx leaves it open.
 */
function isDefinitive(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 400 && status < 500 && status !== 408;
}

const statusOf = (error: unknown): number | null => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
};

export function createCoachingStore(api: CoachingApi) {
  let state = initialCoachingState();
  let generation = 0;
  const listeners = new Set<() => void>();
  const loads: Record<Role, Promise<void> | null> = { coach: null, athlete: null };
  let creating = false;
  let enabling = false;
  let accepting = false;
  let previewing = false;
  const endingNow = new Set<string>();

  const publish = (changes: Partial<CoachingState>) => {
    state = { ...state, ...changes };
    listeners.forEach((listener) => listener());
  };
  const listKey = (role: Role) => (role === "coach" ? "athletes" : "coaches");
  const patchList = (role: Role, changes: Partial<ListState>) => {
    const key = listKey(role);
    publish({ [key]: { ...state[key], ...changes } } as Partial<CoachingState>);
  };
  const fetchList = (role: Role) => (role === "coach" ? api.listAthletes() : api.listCoaches());

  function resetFor(userId: string | null) {
    generation += 1;
    loads.coach = loads.athlete = null;
    creating = enabling = accepting = previewing = false;
    endingNow.clear();
    state = initialCoachingState(userId);
    listeners.forEach((listener) => listener());
  }

  /** Point the store at a user. Switching to a different one drops everything. */
  function bind(userId: string | null) {
    if (state.userId !== userId) resetFor(userId);
  }

  /**
   * `role` is the list's owner's role: "coach" loads that coach's athletes,
   * "athlete" loads that athlete's coaches. Concurrent calls share one request.
   */
  function load(role: Role): Promise<void> {
    const running = loads[role];
    if (running) return running;
    const request = generation;
    patchList(role, { loading: true });
    const current = (async () => {
      try {
        const items = await fetchList(role);
        if (request !== generation) return;
        patchList(role, { items, loaded: true, loading: false, error: null });
      } catch (error) {
        if (request !== generation) return;
        patchList(role, { loading: false, error: messageOf(error, "Could not load connections") });
      } finally {
        if (request === generation) loads[role] = null;
      }
    })();
    loads[role] = current;
    return current;
  }

  async function enableCoach(): Promise<ActionOutcome> {
    if (enabling) return { kind: "ignored" };
    const request = generation;
    enabling = true;
    publish({ enabling: true });
    try {
      await api.enableCoach();
      return request === generation ? { kind: "done" } : { kind: "stale" };
    } catch (error) {
      if (request !== generation) return { kind: "stale" };
      return {
        kind: "failed",
        message: messageOf(error, "Could not turn on coach tools"),
        ambiguous: !isDefinitive(error),
      };
    } finally {
      if (request === generation) {
        enabling = false;
        publish({ enabling: false });
      }
    }
  }

  async function createInvite(): Promise<ActionOutcome> {
    if (creating) return { kind: "ignored" };
    const request = generation;
    creating = true;
    publish({ invite: { creating: true, created: null, error: null } });
    try {
      const created = await api.createInvite();
      if (request !== generation) return { kind: "stale" };
      publish({ invite: { creating: false, created, error: null } });
      return { kind: "done" };
    } catch (error) {
      if (request !== generation) return { kind: "stale" };
      const ambiguous = !isDefinitive(error);
      // The code is never stored in readable form, so a lost response cannot be
      // looked up afterwards. Say that, instead of implying nothing happened.
      const message = ambiguous
        ? "Could not confirm the code was created. Create a new one; any unseen code expires on its own."
        : messageOf(error, "Could not create an invite code");
      publish({ invite: { creating: false, created: null, error: message } });
      return { kind: "failed", message, ambiguous };
    } finally {
      if (request === generation) creating = false;
    }
  }

  async function previewCode(code: string): Promise<PreviewOutcome> {
    if (previewing) return { kind: "ignored" };
    const request = generation;
    previewing = true;
    try {
      const preview = await api.previewInvite(code);
      return request === generation ? { kind: "ok", preview } : { kind: "stale" };
    } catch (error) {
      if (request !== generation) return { kind: "stale" };
      return { kind: "failed", message: messageOf(error, "Could not check this code") };
    } finally {
      if (request === generation) previewing = false;
    }
  }

  /**
   * `coachUsername` is who the athlete saw in the preview. If the accept
   * request fails without telling us whether it worked, the athlete's coach
   * list is re-read and that name looked for in it.
   */
  async function acceptCode(code: string, coachUsername: string): Promise<AcceptOutcome> {
    if (accepting) return { kind: "ignored" };
    const request = generation;
    accepting = true;
    publish({ accepting: true });

    const adopt = (connection: Connection) => {
      const rest = state.coaches.items.filter((item) => item.id !== connection.id);
      patchList("athlete", { items: [connection, ...rest] });
    };

    try {
      const connection = await api.acceptInvite(code);
      if (request !== generation) return { kind: "stale" };
      adopt(connection);
      return { kind: "done", connection };
    } catch (error) {
      if (request !== generation) return { kind: "stale" };
      const message = messageOf(error, "Could not connect");
      if (isDefinitive(error)) return { kind: "failed", message, ambiguous: false };

      try {
        const items = await api.listCoaches();
        if (request !== generation) return { kind: "stale" };
        patchList("athlete", { items, loaded: true, error: null });
        const wanted = coachUsername.toLowerCase();
        const found = items.find((item) => item.person.username.toLowerCase() === wanted);
        if (found) return { kind: "done", connection: found };
        return {
          kind: "failed",
          message: "The connection was not created. Check your connection and try again.",
          ambiguous: false,
        };
      } catch {
        if (request !== generation) return { kind: "stale" };
        return {
          kind: "unknown",
          message:
            "We could not confirm whether you are connected. Open My coaches to check before trying again.",
        };
      }
    } finally {
      if (request === generation) {
        accepting = false;
        publish({ accepting: false });
      }
    }
  }

  /** `role` is the caller's side: "coach" ends from "My athletes", "athlete" from "My coaches". */
  async function endConnection(role: Role, linkId: string): Promise<ActionOutcome> {
    if (endingNow.has(linkId)) return { kind: "ignored" };
    const request = generation;
    endingNow.add(linkId);
    publish({ ending: [...endingNow] });

    const drop = () =>
      patchList(role, { items: state[listKey(role)].items.filter((item) => item.id !== linkId) });

    try {
      await api.endConnection(linkId);
      if (request !== generation) return { kind: "stale" };
      drop();
      return { kind: "done" };
    } catch (error) {
      if (request !== generation) return { kind: "stale" };
      // 404 means it is not there for us any more, which is what was asked for.
      if (statusOf(error) === 404) {
        drop();
        return { kind: "done" };
      }
      const message = messageOf(error, "Could not end the connection");
      if (isDefinitive(error)) return { kind: "failed", message, ambiguous: false };

      try {
        const items = await fetchList(role);
        if (request !== generation) return { kind: "stale" };
        patchList(role, { items, loaded: true, error: null });
        if (!items.some((item) => item.id === linkId)) return { kind: "done" };
        return { kind: "failed", message, ambiguous: false };
      } catch {
        if (request !== generation) return { kind: "stale" };
        return {
          kind: "unknown",
          message: "We could not confirm whether the connection ended. Pull to refresh and check.",
        };
      }
    } finally {
      if (request === generation) {
        endingNow.delete(linkId);
        publish({ ending: [...endingNow] });
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
    bind,
    /** Sign-out and session expiry: forget everything and ignore what is still in flight. */
    reset: () => resetFor(null),
    load,
    enableCoach,
    createInvite,
    previewCode,
    acceptCode,
    endConnection,
    /** Hide a shown invite code (the coach is done with it). */
    clearInvite: () => publish({ invite: { creating: false, created: null, error: null } }),
  };
}
