import type { OfferExercise, OfferProgram, OfferStatus } from "../api/coaching";

/** "6–8 reps", "8 reps", "at least 5 reps" or null when no rep target was set. */
export function repsText(min: number | null, max: number | null): string | null {
  if (min !== null && max !== null) return min === max ? `${min} reps` : `${min}–${max} reps`;
  if (min !== null) return `at least ${min} reps`;
  if (max !== null) return `up to ${max} reps`;
  return null;
}

/** RPE as the backend stores it ("8.5", "8.0"): drop a trailing ".0". */
function rpeText(rpe: string): string {
  const value = Number(rpe);
  return Number.isFinite(value) ? String(value) : rpe;
}

/**
 * One exercise's prescription, e.g. "4 sets · 6–8 reps · RIR 0". RIR 0 is a real
 * target and is shown; a target that was not set is simply left out.
 */
export function prescriptionText(
  exercise: Pick<
    OfferExercise,
    "target_sets" | "target_reps_min" | "target_reps_max" | "target_rir" | "target_rpe"
  >,
): string {
  const parts = [`${exercise.target_sets} ${exercise.target_sets === 1 ? "set" : "sets"}`];
  const reps = repsText(exercise.target_reps_min, exercise.target_reps_max);
  if (reps) parts.push(reps);
  if (exercise.target_rir !== null) parts.push(`RIR ${exercise.target_rir}`);
  if (exercise.target_rpe !== null) parts.push(`RPE ${rpeText(exercise.target_rpe)}`);
  return parts.join(" · ");
}

export function exerciseCount(program: OfferProgram): number {
  return program.templates.reduce((sum, template) => sum + template.exercises.length, 0);
}

export function offerStatusLabel(status: OfferStatus): string {
  return status === "pending" ? "Waiting" : status === "accepted" ? "Added" : "Declined";
}

export function summaryText(templates: number, exercises: number): string {
  const days = `${templates} ${templates === 1 ? "day" : "days"}`;
  return `${days} · ${exercises} ${exercises === 1 ? "exercise" : "exercises"}`;
}
