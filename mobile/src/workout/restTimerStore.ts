/**
 * The rest countdown, shared by every screen.
 *
 * It used to live in the active workout screen's own state, so leaving that
 * screen (another tab, a past workout) threw the countdown away. It lives here
 * instead so the workout screen, the floating pill and the exercise-history
 * panel all read one timer.
 *
 * Rules:
 *  - The timer is a start timestamp plus a length. Remaining time is always
 *    derived from the clock (as the old screen-local timer did), never counted
 *    down, so navigating or backgrounding the app cannot lose or add seconds.
 *  - It belongs to one account and one workout. Another account, or a read of
 *    it for another workout, sees nothing.
 *  - Starting is always a direct user action, so nothing here runs on a delay.
 *    An answer that arrives late (a set save, a workout load) has no way to
 *    start, restart or stop a timer: the only writers are the explicit calls
 *    below, made by the screen the user is holding.
 *  - Expiry is not a state change. The record keeps its start time; "expired"
 *    is simply "no seconds remaining", so coming back to the foreground after
 *    expiry cannot revive it.
 */

export type RestTimer = {
  userId: string;
  workoutId: string;
  /** Epoch milliseconds when the countdown began. */
  startedAt: number;
  durationSeconds: number;
};

export type RestTimerState = {
  timer: RestTimer | null;
  /**
   * Open full-screen panels (the exercise-history modal) that hide the screen's
   * own countdown. They show their own, so the screen's is hidden meanwhile.
   */
  covers: number;
  /** Screens that need the bottom of the display (editing a past workout). */
  pillSuppressions: number;
};

/** Seconds left, never negative. Same arithmetic the screen-local timer used. */
export function remainingSeconds(timer: RestTimer, now: number): number {
  const elapsed = Math.max(0, Math.floor((now - timer.startedAt) / 1000));
  return Math.max(0, timer.durationSeconds - elapsed);
}

export function isLive(timer: RestTimer | null, now: number): timer is RestTimer {
  return timer !== null && remainingSeconds(timer, now) > 0;
}

/** "1 minute 12 seconds" for screen readers; "1:12" is read as a time of day by some. */
export function spokenDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  const parts: string[] = [];
  if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  if (rest > 0 || minutes === 0) parts.push(`${rest} ${rest === 1 ? "second" : "seconds"}`);
  return parts.join(" ");
}

/**
 * Whether the floating pill belongs on this route. `segments` are the router's
 * segments of the focused screen. The four tabs draw their own strip (it sits
 * in the tab bar), so this decides only the overlay used on pushed screens:
 * a workout page for a different workout than the timer's.
 */
export function pillOverlayAllowed(
  segments: readonly string[],
  routeWorkoutId: string | undefined,
  timerWorkoutId: string,
): boolean {
  const onWorkoutPage =
    segments.length === 3 &&
    segments[0] === "(app)" &&
    segments[1] === "workout" &&
    segments[2] === "[id]";
  return onWorkoutPage && routeWorkoutId !== undefined && routeWorkoutId !== timerWorkoutId;
}

const EMPTY: RestTimerState = { timer: null, covers: 0, pillSuppressions: 0 };

export function createRestTimerStore(clock: () => number = Date.now) {
  let state: RestTimerState = EMPTY;
  const listeners = new Set<() => void>();
  // Workout screens currently in the navigation stack, focused or not. A screen
  // that is still in the stack can be returned to by popping; one that is not
  // has to be pushed. Counted, because the same workout can be stacked twice.
  const openScreens = new Map<string, number>();

  function set(next: RestTimerState): void {
    state = next;
    for (const listener of [...listeners]) listener();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function getSnapshot(): RestTimerState {
    return state;
  }

  /** Starts (or restarts) the countdown for this account's workout. Returns false for an unusable request. */
  function start(owner: { userId: string; workoutId: string }, durationSeconds: number): boolean {
    if (!owner.userId || !owner.workoutId) return false;
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return false;
    set({
      ...state,
      timer: {
        userId: owner.userId,
        workoutId: owner.workoutId,
        startedAt: clock(),
        durationSeconds: Math.floor(durationSeconds),
      },
    });
    return true;
  }

  function stop(): void {
    if (state.timer !== null) set({ ...state, timer: null });
  }

  /** The workout was finished, replaced or turned read-only: its timer ends with it. */
  function clearForWorkout(workoutId: string): void {
    if (state.timer?.workoutId === workoutId) set({ ...state, timer: null });
  }

  /** Sign-out, expired session, deleted account: nothing of the account stays. */
  function reset(): void {
    // Open panels and screens report their own release; only the timer is the account's.
    if (state.timer !== null) set({ ...state, timer: null });
  }

  /** The timer for this account, or null: never another account's. */
  function timerFor(userId: string | undefined): RestTimer | null {
    return userId && state.timer?.userId === userId ? state.timer : null;
  }

  function counted(key: "covers" | "pillSuppressions"): () => void {
    set({ ...state, [key]: state[key] + 1 });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      set({ ...state, [key]: Math.max(0, state[key] - 1) });
    };
  }

  /** A full-screen panel is open over the workout; hides the screen's own countdown until released. */
  function coverInline(): () => void {
    return counted("covers");
  }

  /** This screen needs the bottom of the display (a past workout open for editing). */
  function suppressPill(): () => void {
    return counted("pillSuppressions");
  }

  function registerWorkoutScreen(workoutId: string): () => void {
    openScreens.set(workoutId, (openScreens.get(workoutId) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (openScreens.get(workoutId) ?? 1) - 1;
      if (left <= 0) openScreens.delete(workoutId);
      else openScreens.set(workoutId, left);
    };
  }

  function isWorkoutScreenOpen(workoutId: string): boolean {
    return (openScreens.get(workoutId) ?? 0) > 0;
  }

  return {
    subscribe,
    getSnapshot,
    start,
    stop,
    clearForWorkout,
    reset,
    timerFor,
    coverInline,
    suppressPill,
    registerWorkoutScreen,
    isWorkoutScreenOpen,
  };
}

export type RestTimerStore = ReturnType<typeof createRestTimerStore>;

export const restTimerStore = createRestTimerStore();
