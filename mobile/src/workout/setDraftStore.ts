/**
 * Unsaved workout input, kept while the workout screen is closed.
 *
 * The workout screen is the only way into a workout and its Back button pops
 * it, so everything typed into it lived only as long as the screen did. With a
 * rest countdown that follows the user around the app, "go look at something,
 * come back via the pill" became a normal path, and it must not throw away a
 * half-typed set.
 *
 * Two things are kept, both per account and workout:
 *  - the new-set form of each exercise (weight, reps, RIR, warm-up toggle),
 *  - exercises picked but not yet logged (they exist nowhere else until their
 *    first set lands).
 *
 * Memory only, on purpose: this carries a draft across screens within one app
 * session. It is not a recovery mechanism (a set that was submitted has its own
 * durable receipt, see setSaveRequest.ts), and a draft is not worth writing to
 * the Keychain. It ends with the workout, with a successful save of its set,
 * and with the account.
 */

export type SetDraft = {
  weight: string;
  reps: string;
  rir: string;
  isWarmup: boolean;
};

export type PendingExercise = { id: string; name: string };

export const EMPTY_SET_DRAFT: SetDraft = { weight: "", reps: "", rir: "", isWarmup: false };

function isEmpty(draft: SetDraft): boolean {
  return draft.weight === "" && draft.reps === "" && draft.rir === "" && !draft.isWarmup;
}

export function createSetDraftStore() {
  const drafts = new Map<string, SetDraft>();
  const pending = new Map<string, PendingExercise[]>();

  // Ids are uuids and user ids are uuids; a separator that cannot occur in
  // either keeps one account's key from ever matching another's.
  const workoutKey = (userId: string, workoutId: string) => `${userId}|${workoutId}`;
  const formKey = (userId: string, workoutId: string, exerciseId: string) =>
    `${workoutKey(userId, workoutId)}|${exerciseId}`;

  function getDraft(userId: string, workoutId: string, exerciseId: string): SetDraft {
    return drafts.get(formKey(userId, workoutId, exerciseId)) ?? EMPTY_SET_DRAFT;
  }

  function saveDraft(userId: string, workoutId: string, exerciseId: string, draft: SetDraft): void {
    const key = formKey(userId, workoutId, exerciseId);
    if (isEmpty(draft)) drafts.delete(key);
    else drafts.set(key, { ...draft });
  }

  function clearDraft(userId: string, workoutId: string, exerciseId: string): void {
    drafts.delete(formKey(userId, workoutId, exerciseId));
  }

  function getPending(userId: string, workoutId: string): PendingExercise[] {
    return pending.get(workoutKey(userId, workoutId)) ?? [];
  }

  function savePending(userId: string, workoutId: string, exercises: PendingExercise[]): void {
    const key = workoutKey(userId, workoutId);
    if (exercises.length === 0) pending.delete(key);
    else pending.set(key, exercises.map((exercise) => ({ ...exercise })));
  }

  /** The workout is over: nothing typed into it matters any more. */
  function clearWorkout(userId: string, workoutId: string): void {
    const prefix = `${workoutKey(userId, workoutId)}|`;
    for (const key of [...drafts.keys()]) if (key.startsWith(prefix)) drafts.delete(key);
    pending.delete(workoutKey(userId, workoutId));
  }

  /** Sign-out, expired session, account deletion: nothing of the account stays. */
  function reset(): void {
    drafts.clear();
    pending.clear();
  }

  return { getDraft, saveDraft, clearDraft, getPending, savePending, clearWorkout, reset };
}

export type SetDraftStore = ReturnType<typeof createSetDraftStore>;

export const setDraftStore = createSetDraftStore();
