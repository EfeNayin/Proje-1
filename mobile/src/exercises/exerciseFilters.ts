/**
 * The exercise browser's filters and the wording of a catalogue row.
 *
 * The selection is plain data ({ muscle, equipment }) keyed by the stable codes
 * the API uses. Nothing here knows how the selection was made: today it comes
 * from a list of names (FilterPanel); a later anatomical model only has to hand
 * over the same muscle code.
 *
 * Not offered, on purpose: "Cardio" and "Full body". Neither is a muscle group
 * and the catalogue has no field that classifies an exercise that way, so there
 * is nothing truthful to filter by yet.
 */

import type { Equipment, ExerciseFilters, ExerciseSummary, MuscleGroupSummary } from "../api/exercises";
import { formatMuscleName } from "../volume/volumePresentation";

export const NO_FILTERS: ExerciseFilters = { muscle: null, equipment: null };

export function hasFilters(filters: ExerciseFilters): boolean {
  return filters.muscle !== null || filters.equipment !== null;
}

export type FilterOption<Value extends string> = {
  value: Value;
  label: string;
  /** A heading the option is listed under, when the list is grouped. */
  group?: string;
};

const EQUIPMENT: Equipment[] = ["barbell", "dumbbell", "machine", "cable", "bodyweight"];

/** The equipment the API can filter by, in its own order. */
export const EQUIPMENT_OPTIONS: FilterOption<Equipment>[] = EQUIPMENT.map((value) => ({
  value,
  label: value.charAt(0).toUpperCase() + value.slice(1),
}));

const REGIONS: { code: MuscleGroupSummary["region"]; label: string }[] = [
  { code: "upper", label: "Upper body" },
  { code: "lower", label: "Lower body" },
  { code: "core", label: "Core" },
];

/** The muscle-group catalogue as choices: upper body, lower body, core; by name within each. */
export function muscleOptions(groups: MuscleGroupSummary[]): FilterOption<string>[] {
  return REGIONS.flatMap(({ code, label }) =>
    groups
      .filter((group) => group.region === code)
      .map((group) => ({ value: group.name, label: formatMuscleName(group.name), group: label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  );
}

/** The readable name of a muscle code, e.g. "front_delts" -> "Front Delts". */
export function muscleLabel(code: string): string {
  return formatMuscleName(code);
}

/**
 * The line under an exercise's name: every muscle it trains directly, in the
 * server's order (best fit first). Secondary muscles are not named here; they
 * are on the exercise's details.
 */
export function primaryMuscleLabel(exercise: Pick<ExerciseSummary, "primary_muscles">): string {
  return (exercise.primary_muscles ?? []).map((muscle) => formatMuscleName(muscle.name)).join(", ");
}
