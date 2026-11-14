import type { LoggedSet } from "../api/workouts";
import { formatWeight, toDisplayWeight, type WeightUnit } from "../units/weight";

type Group = { reps: number; rir: number; maxWeightCents: number; setCount: number };
export type SessionWeightComparison = {
  reps: number;
  rir: number;
  previousWeightKg: number;
  currentWeightKg: number;
  previousSetCount: number;
  currentSetCount: number;
  deltaKg: number;
};

function groupSets(exerciseId: string, sets: LoggedSet[]): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const set of sets) {
    const weight = Number(set.weight_kg);
    if (set.exercise_id !== exerciseId || set.is_warmup || set.reps <= 0 ||
        set.rir == null || !Number.isFinite(weight) || weight < 0) continue;
    const key = `${set.reps}:${set.rir}`;
    // The API stores kg to two decimal places. Compare integer hundredths
    // so decimal representation cannot create a spurious weight change.
    const cents = Math.round(weight * 100);
    const group = groups.get(key);
    if (group) {
      group.maxWeightCents = Math.max(group.maxWeightCents, cents);
      group.setCount++;
    } else {
      groups.set(key, { reps: set.reps, rir: set.rir, maxWeightCents: cents, setCount: 1 });
    }
  }
  return groups;
}

/** Compare observed maxima only, without inferring equivalent training conditions. */
export function compareSessionWeights(
  exerciseId: string, current: LoggedSet[], previous: LoggedSet[],
): SessionWeightComparison[] {
  const currentGroups = groupSets(exerciseId, current);
  const previousGroups = groupSets(exerciseId, previous);
  const rows: SessionWeightComparison[] = [];
  for (const [key, group] of currentGroups) {
    const prior = previousGroups.get(key);
    if (!prior) continue;
    rows.push({
      reps: group.reps, rir: group.rir,
      previousWeightKg: prior.maxWeightCents / 100,
      currentWeightKg: group.maxWeightCents / 100,
      previousSetCount: prior.setCount, currentSetCount: group.setCount,
      deltaKg: (group.maxWeightCents - prior.maxWeightCents) / 100,
    });
  }
  return rows.sort((a, b) => a.reps - b.reps || a.rir - b.rir);
}

export function formatRecordedWeightChange(deltaKg: number, unit: WeightUnit): string {
  if (deltaKg === 0) return "Recorded weight unchanged";
  const amount = Math.abs(deltaKg);
  // Display rounds to one decimal. Do not turn a real small change into +0.
  if (Math.round(toDisplayWeight(amount, unit) * 10) === 0) {
    return `Recorded weight ${deltaKg > 0 ? "increase" : "decrease"} under 0.1 ${unit}`;
  }
  return `Recorded weight ${deltaKg > 0 ? "+" : "−"}${formatWeight(amount, unit)}`;
}
