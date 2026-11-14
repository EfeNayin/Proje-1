/**
 * Reads the shared rest timer (restTimerStore.ts) for one account.
 *
 * The clock only schedules re-renders; remaining time is always computed from
 * the timer's start timestamp, so a paused JS timer (app in the background)
 * costs nothing but a late repaint. Ticking stops once the countdown is over
 * and while there is no timer, and nothing here writes to the store: a late
 * tick cannot start, restart or stop anything.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import {
  remainingSeconds,
  restTimerStore,
  type RestTimer,
  type RestTimerState,
} from "./restTimerStore";

export type RestTimerView = {
  /** This account's timer, or null. Stays set after expiry so the workout screen can say "Rest over". */
  timer: RestTimer | null;
  remaining: number;
  /** A countdown that is still running. */
  live: boolean;
  state: RestTimerState;
};

export function useRestTimer(userId: string | undefined): RestTimerView {
  const state = useSyncExternalStore(
    restTimerStore.subscribe,
    restTimerStore.getSnapshot,
    restTimerStore.getSnapshot,
  );
  const timer = userId && state.timer?.userId === userId ? state.timer : null;
  const [now, setNow] = useState(() => Date.now());

  const remaining = timer ? remainingSeconds(timer, now) : 0;
  const live = timer !== null && remaining > 0;
  const startedAt = timer?.startedAt;

  // Ticks only while a countdown is running: the tick that reaches zero flips
  // `live` off, which ends the interval, so an expired timer costs nothing.
  useEffect(() => {
    if (startedAt === undefined || !live) return;
    const tick = () => setNow(Date.now());
    tick();
    const handle = setInterval(tick, 1000);
    // Repaint at once on return to the foreground instead of waiting for the next tick.
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") tick();
    });
    return () => {
      clearInterval(handle);
      subscription.remove();
    };
  }, [startedAt, live]);

  return { timer, remaining, live, state };
}
