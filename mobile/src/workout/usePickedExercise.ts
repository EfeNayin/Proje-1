/**
 * Delivers one picked exercise from the shared exercise picker back to
 * whichever screen opened it — without a route-param round trip.
 *
 * router.replace() back to the caller's own route does not resume the
 * screen instance the user was on; it mounts a brand new one. Every local
 * state variable resets, silently discarding anything accumulated before
 * the picker was opened — a previously picked-but-unsaved exercise, an
 * in-progress edit, all of it. This bit a template editor that accumulates
 * several picks before a single Save: the second pick's fresh mount wiped
 * the first.
 *
 * router.back() resumes the exact instance the user left, so nothing is
 * lost. The cost is that back() cannot hand a new value to the screen it
 * returns to, hence the mailbox below.
 *
 * The mailbox is a bare module-level variable rather than a state library:
 * only one exercise picker is ever open at a time, and the value is read
 * exactly once, immediately, when the caller regains focus. depositPickedExercise
 * and takePickedExercise are exported separately from the hook so this
 * one-shot behaviour (write once, first read returns it, second read is
 * empty) can be checked without rendering anything.
 */

import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useLayoutEffect, useRef } from "react";

export type PickedExercise = {
  id: string;
  name: string;
};

let mailbox: PickedExercise | null = null;

/** Called by the picker screen when the user makes a choice. */
export function depositPickedExercise(exercise: PickedExercise): void {
  mailbox = exercise;
}

/** Consumes the mailbox: returns the pick once, then empties it. */
export function takePickedExercise(): PickedExercise | null {
  const picked = mailbox;
  mailbox = null;
  return picked;
}

/**
 * Opens the shared exercise picker and calls `onPick` exactly once for
 * whatever was chosen, the moment this screen regains focus after the
 * picker is popped. `onPick` decides how to fold the result into this
 * screen's own local state — the hook only guarantees delivery, not shape.
 */
export function usePickedExercise(onPick: (exercise: PickedExercise) => void): {
  openPicker: () => void;
} {
  const router = useRouter();

  // Ref rather than a dependency of the focus effect: onPick is a fresh
  // closure most renders (it usually captures a setState call), and
  // resubscribing the effect every render would be wasteful.
  const onPickRef = useRef(onPick);
  useLayoutEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  useFocusEffect(
    useCallback(() => {
      const picked = takePickedExercise();
      if (picked) onPickRef.current(picked);
    }, []),
  );

  const openPicker = useCallback(() => {
    router.push("/workout/exercise-picker");
  }, [router]);

  return { openPicker };
}
