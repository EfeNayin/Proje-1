import type {
  AcceptanceEffect,
  OfferExercise,
  OfferProgram,
  OfferStatus,
  ReceivedOffer,
} from "../api/coaching";

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

/** The athlete's word for where an offer stands. */
export function offerStatusLabel(status: OfferStatus): string {
  return status === "pending"
    ? "Waiting"
    : status === "accepted"
      ? "Added"
      : status === "declined"
        ? "Declined"
        : "Replaced";
}

/**
 * The coach's word. "Accepted" only says the athlete added a copy to their programs;
 * nothing here says they are following or finishing it, and the backend does not tell.
 */
export function coachStatusLabel(status: OfferStatus): string {
  return status === "pending"
    ? "Waiting for answer"
    : status === "accepted"
      ? "Accepted"
      : status === "declined"
        ? "Declined"
        : "Replaced by a newer version";
}

/** The icon beside a status word; the word, never the icon or colour alone, carries the meaning. */
export const OFFER_STATUS_ICON = {
  pending: "time-outline",
  accepted: "checkmark-circle-outline",
  declined: "close-circle-outline",
  superseded: "swap-horizontal-outline",
} as const;

/** "Version 2", or null for a standalone offer that has no version. */
export function versionLabel(version: number | null): string | null {
  return version === null ? null : `Version ${version}`;
}

/** What the athlete is told accepting will do, from the server's reading of their programs. */
export function acceptanceText(
  effect: AcceptanceEffect,
  from: string,
  version: number | null = null,
): string[] {
  const independent = `It is an independent copy: it will not change if ${from} edits theirs, and ${from} cannot open or edit it.`;
  // Only an update has an earlier copy whose personal edits could be expected to follow.
  const common =
    version !== null && version > 1
      ? `${independent} Personal edits you made to an earlier copy are not carried into it.`
      : independent;
  if (effect.kind === "replaces_active_copy") {
    const replaced = effect.replaces_program_name
      ? `“${effect.replaces_program_name}”`
      : "your copy of the earlier version";
    return [
      `Your copy of version ${effect.replaces_version ?? "?"}, ${replaced}, is your active program. If it still is when you add this, the new copy becomes your active program and ${replaced} is switched off, not deleted. Your workouts and personal edits stay as they are.`,
      common,
    ];
  }
  return [
    effect.keeps_active_program_name
      ? `Adding this puts a new copy among your programs, switched off. Your active program, “${effect.keeps_active_program_name}”, stays active.`
      : "Adding this puts a new copy among your programs, switched off. You choose when to activate it.",
    common,
  ];
}

/** What to tell the athlete right after they accepted. */
export function acceptedNotice(offer: Pick<ReceivedOffer, "activated" | "version">): string {
  return offer.activated
    ? "Added, and it is now your active program. Your earlier copy is kept, switched off, with your edits."
    : "Added to your programs. It is not active, so your active program was not changed.";
}

export function summaryText(templates: number, exercises: number): string {
  const days = `${templates} ${templates === 1 ? "day" : "days"}`;
  return `${days} · ${exercises} ${exercises === 1 ? "exercise" : "exercises"}`;
}

/** Where a preparation stands for the coach, from its newest published version. */
export function lineageStatusText(
  latestVersion: number | null,
  latestStatus: OfferStatus | null,
): string {
  if (latestVersion === null || latestStatus === null) return "Draft · not published yet";
  return `Version ${latestVersion} · ${coachStatusLabel(latestStatus)}`;
}
