/**
 * Write actions of the Programs screens, kept out of the components so the
 * rules that matter can be tested without rendering anything.
 *
 * Each action owns an in-flight flag here rather than in React state: a
 * `busy` state only updates on the next render, so a keyboard "done" followed
 * immediately by a button tap could both read busy === false and fire two
 * requests. The flag is released in `finally`, so a failed request (or a
 * navigation back) can never leave an action permanently locked.
 */

import type { ProgramDetail, WorkoutTemplate } from "../api/programs";

export type ActionOutcome<T> =
  | { kind: "ignored" } // the same action is already running; it owns the busy state
  | { kind: "invalid"; message: string }
  | { kind: "done"; value: T }
  | { kind: "failed"; message: string };

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function createAction<Args extends unknown[], T>(
  work: (...args: Args) => Promise<T>,
  fallback: string,
  validate?: (...args: Args) => string | null,
): (...args: [...Args, onStart?: () => void]) => Promise<ActionOutcome<T>> {
  let inFlight = false;

  return async (...all) => {
    // The optional trailing argument is a callback, never part of the payload.
    const last = all[all.length - 1];
    const onStart = typeof last === "function" ? (last as () => void) : undefined;
    const args = (onStart ? all.slice(0, -1) : all) as unknown as Args;

    if (inFlight) return { kind: "ignored" };

    const message = validate?.(...args) ?? null;
    if (message) return { kind: "invalid", message };

    inFlight = true;
    onStart?.();
    try {
      return { kind: "done", value: await work(...args) };
    } catch (err) {
      return { kind: "failed", message: messageOf(err, fallback) };
    } finally {
      inFlight = false;
    }
  };
}

const requireName = (message: string) => (name: string) => (name.trim() ? null : message);

type CreateProgram = (name: string) => Promise<Pick<ProgramDetail, "id">>;

/** Programs list: create a program. The name is trimmed; an empty one is not sent. */
export function createProgramCreator(create: CreateProgram) {
  return createAction(
    (name: string) => create(name.trim()),
    "Could not create the program",
    requireName("Enter a program name."),
  );
}

export type ProgramApi = {
  updateProgram: (id: string, changes: { name: string }) => Promise<ProgramDetail>;
  activateProgram: (id: string) => Promise<ProgramDetail>;
  deleteProgram: (id: string) => Promise<void>;
  createTemplate: (
    programId: string,
    input: { name: string; day_order: number },
  ) => Promise<WorkoutTemplate>;
};

/** Program detail: each write has its own lock, so a rename started by a blur never swallows a tap on another button. */
export function createProgramMutations(api: ProgramApi, programId: string) {
  return {
    rename: createAction(
      (name: string) => api.updateProgram(programId, { name: name.trim() }),
      "Could not rename the program",
      requireName("Enter a program name."),
    ),
    activate: createAction(() => api.activateProgram(programId), "Could not activate the program"),
    remove: createAction(() => api.deleteProgram(programId), "Could not delete the program"),
    addTemplate: createAction(
      (name: string, dayOrder: number) =>
        api.createTemplate(programId, { name: name.trim(), day_order: dayOrder }),
      "Could not add the template",
      requireName("Enter a template name."),
    ),
  };
}
