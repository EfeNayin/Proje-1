/**
 * One sign-in attempt at a time on a screen, across every way of signing in.
 *
 * The flag is a plain variable, not React state: state only changes on the next render, so
 * a keyboard "go" followed at once by a Google or Apple tap could both read "not busy" and
 * start two attempts. Two attempts would also fight over the auth epoch, and the first
 * would end with a confusing "your session changed" message.
 */
export type AttemptGate = {
  /** True if the caller may start; false if another attempt is running. */
  tryEnter: () => boolean;
  leave: () => void;
  isBusy: () => boolean;
};

export function createAttemptGate(): AttemptGate {
  let held = false;
  return {
    tryEnter() {
      if (held) return false;
      held = true;
      return true;
    },
    leave() {
      held = false;
    },
    isBusy: () => held,
  };
}
