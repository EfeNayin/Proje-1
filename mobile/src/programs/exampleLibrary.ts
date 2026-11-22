/**
 * What the Start Workout tab knows about the example programs.
 *
 * Deliberately separate from the user's own programs (programsHub.ts): the example
 * section can be unavailable (an older backend that has no such endpoint answers
 * 404, a server or network problem fails the same way) without touching My programs,
 * the primary workout action or Create program. A failure here only puts a short
 * message and a retry inside the Example programs section.
 *
 * `examples` is null until the first load settles, so "not loaded yet" is never
 * confused with "none". A failed refresh keeps what is already on screen. Only the
 * newest request may apply its result.
 */

import type { ExampleSummary } from "../api/examplePrograms";

export type ExampleLibraryState = {
  examples: ExampleSummary[] | null;
  /** The last load failed; the section shows UNAVAILABLE_MESSAGE with a retry. */
  unavailable: boolean;
  loading: boolean;
};

export const UNAVAILABLE_MESSAGE = "Example programs are not available right now.";

export function createExampleLibrary(api: { listExamples: () => Promise<ExampleSummary[]> }) {
  let state: ExampleLibraryState = { examples: null, unavailable: false, loading: false };
  let generation = 0;
  const listeners = new Set<() => void>();
  const publish = (changes: Partial<ExampleLibraryState>) => {
    state = { ...state, ...changes };
    listeners.forEach((listener) => listener());
  };

  async function refresh(): Promise<void> {
    const request = ++generation;
    publish({ loading: true });
    try {
      const examples = await api.listExamples();
      if (request !== generation) return;
      publish({ examples, unavailable: false });
    } catch {
      if (request === generation) publish({ unavailable: true });
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

export type ExampleLibrary = ReturnType<typeof createExampleLibrary>;
