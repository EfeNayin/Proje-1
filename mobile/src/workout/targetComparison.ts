import type { TemplateExerciseTarget } from "../api/programs";
import type { LoggedSet } from "../api/workouts";

type TargetResult = { status: "missing" | "mixed" } | {
  status: "compared";
  below: number;
  within: number;
  above: number;
  unrecorded: number;
};

export type ExerciseTargetComparison = {
  workingSets: number;
  reps: TargetResult;
  rir: TargetResult;
};

function countRange(values: (number | null)[], min: number | null, max: number | null): TargetResult {
  const result: TargetResult = { status: "compared", below: 0, within: 0, above: 0, unrecorded: 0 };
  for (const value of values) {
    if (value === null) result.unrecorded++;
    else if (min !== null && value < min) result.below++;
    else if (max !== null && value > max) result.above++;
    else result.within++;
  }
  return result;
}

/** All positive working sets, including extras, compared with a common starting target.
 * Different blocks are not assigned to sets: the log has no block-level link.
 */
export function compareExerciseTargets(
  targets: TemplateExerciseTarget[], sets: LoggedSet[],
): ExerciseTargetComparison | null {
  const first = targets[0];
  if (!first) return null;
  const working = sets.filter(set => set.exercise_id === first.exercise_id &&
    !set.is_warmup && set.reps > 0);
  const min = first.target_reps_min ?? null;
  const max = first.target_reps_max ?? null;
  const targetRir = first.target_rir ?? null;
  const mixedReps = targets.some(target =>
    (target.target_reps_min ?? null) !== min || (target.target_reps_max ?? null) !== max);
  const mixedRir = targets.some(target => (target.target_rir ?? null) !== targetRir);
  return {
    workingSets: working.length,
    reps: mixedReps ? { status: "mixed" } : min === null && max === null
      ? { status: "missing" } : countRange(working.map(set => set.reps), min, max),
    rir: mixedRir ? { status: "mixed" } : targetRir === null
      ? { status: "missing" } : countRange(working.map(set => set.rir ?? null), targetRir, targetRir),
  };
}

/** Neutral observations, never a completion score or a recommendation to change effort. */
export function describeTargetComparison(comparison: ExerciseTargetComparison | null): string[] {
  if (!comparison) return [];
  const lines: string[] = [];
  if (comparison.reps.status === "mixed") {
    lines.push("Reps: different starting targets; sets are not linked to individual target blocks.");
  } else if (comparison.reps.status === "compared") {
    const { below, within, above } = comparison.reps;
    lines.push(comparison.workingSets === 0 ? "Reps: no working sets recorded." :
      `Reps vs target: ${below} below · ${within} within range · ${above} above`);
  }
  if (comparison.rir.status === "mixed") {
    lines.push("RIR: different starting targets; sets are not linked to individual target blocks.");
  } else if (comparison.rir.status === "compared") {
    const { below, within, above, unrecorded } = comparison.rir;
    lines.push(comparison.workingSets === 0 ? "RIR: no working sets recorded." :
      `RIR vs target: ${below} below · ${within} at target · ${above} above · ${unrecorded} not recorded`);
  }
  return lines;
}
