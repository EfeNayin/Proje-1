/**
 * How the History tab words and groups finished workouts.
 *
 * Moved out of the old Training screen unchanged in wording (Adım 3, Adım 48):
 * the screen only draws what these return. Nothing here fetches or pages —
 * that is createWorkoutHistory's job, and it keeps every row the server sent.
 * What is hidden from display is decided here, AFTER paging, so a hidden row
 * can never change how far the next page request advances.
 */

import type { WorkoutSummary } from "../api/workouts";

/** A session counts as history once it has been closed, by the user or automatically. */
export function isCompleted(workout: WorkoutSummary): boolean {
  return workout.finished_at !== null && workout.finished_at !== undefined;
}

/**
 * The rows History shows: completed sessions, newest first. Empty finished
 * sessions and automatically closed ones are kept on purpose — they are real
 * entries in the record, and hiding them would make the list disagree with the
 * workout detail screen. The one session still in progress belongs to "Resume
 * workout" on Start Workout, not here.
 *
 * The sort is stable and only reorders what the server's order does not already
 * settle (rows with the same start keep the server's relative order).
 */
export function completedWorkouts(workouts: readonly WorkoutSummary[]): WorkoutSummary[] {
  return workouts
    .filter(isCompleted)
    .map((workout, index) => ({ workout, index, time: new Date(workout.performed_at).getTime() }))
    .sort((a, b) => (b.time - a.time) || (a.index - b.index))
    .map((entry) => entry.workout);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * "Today" / "Yesterday" / a full date — grouping is by the device's LOCAL
 * calendar day, same reasoning as the server's per-user-timezone weekly
 * volume cutoff: a workout performed_at close to midnight UTC must land in
 * the day it actually happened in for the person doing it, not in UTC's.
 */
export function sectionTitleFor(performedAt: string, now: Date = new Date()): string {
  const day = new Date(performedAt);
  if (isSameLocalDay(day, now)) return "Today";

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameLocalDay(day, yesterday)) return "Yesterday";

  return formatDate(performedAt);
}

/** For a session still in progress, shown instead of a duration it doesn't have yet. */
function formatTimeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Fixed session length, for a finished workout only — nothing to show for one still in progress. */
export function formatCardDuration(performedAt: string, finishedAt: string): string {
  const seconds = Math.max(
    0,
    Math.floor((new Date(finishedAt).getTime() - new Date(performedAt).getTime()) / 1000),
  );
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export type CardMeta = {
  icon: "timer-outline" | "time-outline" | "information-circle-outline";
  text: string;
};

/**
 * The line under a card's title. The day is already the section header above;
 * each row adds what the header can't — its duration once finished, or its
 * start time while it's the one still in progress.
 */
export function cardMetaFor(item: WorkoutSummary): CardMeta {
  if (!item.finished_at) return { icon: "time-outline", text: formatTimeOfDay(item.performed_at) };
  if (item.finished_automatically === false) {
    return { icon: "timer-outline", text: formatCardDuration(item.performed_at, item.finished_at) };
  }
  return {
    icon: "information-circle-outline",
    text: item.finished_automatically ? "Auto-closed · duration unknown" : "Duration unavailable",
  };
}

export type HistorySection = { title: string; data: WorkoutSummary[] };

/**
 * Groups an already newest-first list into local-day sections in one linear
 * pass — no bucketing into a map first.
 */
export function groupByDay(workouts: readonly WorkoutSummary[], now: Date = new Date()): HistorySection[] {
  const sections: HistorySection[] = [];
  let currentDay: string | null = null;

  for (const workout of workouts) {
    const day = new Date(workout.performed_at);
    const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
    if (key !== currentDay) {
      sections.push({ title: sectionTitleFor(workout.performed_at, now), data: [] });
      currentDay = key;
    }
    sections[sections.length - 1].data.push(workout);
  }

  return sections;
}

/** The History list as the screen draws it: completed sessions, newest first, by local day. */
export function historySections(workouts: readonly WorkoutSummary[], now: Date = new Date()): HistorySection[] {
  return groupByDay(completedWorkouts(workouts), now);
}
