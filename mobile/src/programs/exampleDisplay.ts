/**
 * Wording for the example-program cards and preview, kept out of the components so it
 * can be tested and read in one place. Only formatting lives here; the content itself
 * (days, targets, sources) comes from the server.
 */

import type { ExampleDay, ExampleExercise, ExampleSummary } from "../api/examplePrograms";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "3 sessions per week" */
export function frequencyLabel(example: Pick<ExampleSummary, "sessions_per_week">): string {
  return `${plural(example.sessions_per_week, "session", "sessions")} per week`;
}

/** The card's second line: level and weekly frequency are always both visible. */
export function cardMeta(example: ExampleSummary): string {
  return `${example.level} · ${frequencyLabel(example)}`;
}

/** What a screen reader hears for a card. */
export function cardAccessibilityLabel(example: ExampleSummary): string {
  return `${example.name}, ${example.level}, ${frequencyLabel(example)}`;
}

/** "3 × 6–10" (a fixed count when min equals max). */
export function repsLabel(exercise: Pick<ExampleExercise, "target_reps_min" | "target_reps_max">): string {
  const { target_reps_min: min, target_reps_max: max } = exercise;
  return min === max ? `${min}` : `${min}–${max}`;
}

/** "3 sets × 6–10 reps · RIR 2" */
export function targetLabel(exercise: ExampleExercise): string {
  const sets = plural(exercise.target_sets, "set", "sets");
  return `${sets} × ${repsLabel(exercise)} reps · RIR ${exercise.target_rir}`;
}

export function targetAccessibilityLabel(exercise: ExampleExercise): string {
  const sets = plural(exercise.target_sets, "set", "sets");
  return (
    `${exercise.exercise_name}, ${sets}, ${repsLabel(exercise)} reps, ` +
    `reps in reserve ${exercise.target_rir}`
  );
}

/** "7 exercises · 21 sets" for a day header. */
export function dayTotals(day: ExampleDay): string {
  const sets = day.exercises.reduce((sum, exercise) => sum + exercise.target_sets, 0);
  return `${plural(day.exercises.length, "exercise", "exercises")} · ${plural(sets, "set", "sets")}`;
}

/** The approximate weekly total, always worded as approximate. */
export function weeklySetsLabel(example: Pick<ExampleSummary, "weekly_working_sets">): string {
  return `About ${example.weekly_working_sets} working sets per week`;
}

/** Only PubMed record links are opened from the app, whatever the server sends. */
export function isSourceUrl(url: string): boolean {
  return /^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\d+\/?$/.test(url);
}
