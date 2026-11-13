/**
 * What the Start Workout tab knows about the user's programs.
 *
 * Replaces the loading that lived in the old Programs tab (list) and the old
 * Training screen (active program, for "Start from a template"). It follows the
 * same rules as both:
 *  - `programs` is null until the first load settles, so "not loaded yet" and
 *    "no programs" are never confused.
 *  - A failed refresh keeps the list already on screen and only reports the
 *    problem; a failed first load reports it instead of looking like an empty
 *    list.
 *  - Only the newest request may apply its result; leaving the screen
 *    invalidates the outstanding one.
 *  - The active program's detail is fetched in isolation: if it fails the list
 *    is still shown, because the list is what keeps every program reachable.
 *
 * The list is the server's own, complete one (GET /programs is not paged), and
 * nothing here filters or truncates it.
 */

import type { ProgramDetail, ProgramSummary } from "../api/programs";

export type ProgramsHubState = {
  programs: ProgramSummary[] | null;
  /** The active program with its templates, for the quick "Start from a template" row. */
  activeProgram: ProgramDetail | null;
  /** The last load failed; the message is shown with a retry. */
  error: string | null;
  loading: boolean;
};

export type ProgramsHubApi = {
  listPrograms: () => Promise<ProgramSummary[]>;
  getProgram: (id: string) => Promise<ProgramDetail>;
};

export function createProgramsHub(api: ProgramsHubApi) {
  let state: ProgramsHubState = { programs: null, activeProgram: null, error: null, loading: false };
  let generation = 0;
  const listeners = new Set<() => void>();
  const publish = (changes: Partial<ProgramsHubState>) => {
    state = { ...state, ...changes };
    listeners.forEach((listener) => listener());
  };

  async function refresh(): Promise<void> {
    const request = ++generation;
    publish({ loading: true });
    try {
      const programs = await api.listPrograms();
      if (request !== generation) return;
      // The list is shown as soon as it is known; the active program's templates follow.
      publish({ programs, error: null });

      const active = programs.find((program) => program.is_active);
      let activeProgram: ProgramDetail | null = null;
      if (active) {
        try {
          activeProgram = await api.getProgram(active.id);
        } catch {
          activeProgram = null;
        }
        if (request !== generation) return;
      }
      publish({ activeProgram });
    } catch (err) {
      if (request === generation) {
        publish({ error: err instanceof Error && err.message ? err.message : "Could not load your programs" });
      }
    } finally {
      if (request === generation) publish({ loading: false });
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
    refresh,
    /** Leaving the screen: whatever is still on its way is dropped, not applied. */
    cancel: () => {
      generation += 1;
      publish({ loading: false });
    },
  };
}

export type ProgramsHub = ReturnType<typeof createProgramsHub>;
