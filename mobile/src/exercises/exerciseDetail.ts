/**
 * How the exercise detail screen words an exercise and its muscles.
 *
 * Two independent facts about each muscle come from the catalogue (see CLAUDE.md,
 * "Hipertrofi modeli"):
 *  - role: primary or secondary. Only primary muscles count towards the weekly
 *    set totals; the screen says so rather than leaving it implied.
 *  - effectiveness (1-5): an editorial judgement of how good the movement is for
 *    THAT muscle. It is not a measurement, so it is worded as a rating and never
 *    as a percentage.
 */

import type { ExerciseDetail, MuscleInvolvement } from "../api/exercises";
import { formatMuscleName } from "../volume/volumePresentation";

export type MuscleLine = {
  /** Readable muscle name, e.g. "Front Delts". */
  name: string;
  effectiveness: number;
  /** "Effectiveness 4 of 5". */
  effectivenessLabel: string;
  accessibilityLabel: string;
};

export type ExerciseView = {
  title: string;
  /** "Barbell · Compound", skipping the parts that are unknown. */
  summary: string;
  primary: MuscleLine[];
  secondary: MuscleLine[];
};

function line(muscle: MuscleInvolvement): MuscleLine {
  const name = formatMuscleName(muscle.name);
  const effectivenessLabel = `Effectiveness ${muscle.effectiveness} of 5`;
  return {
    name,
    effectiveness: muscle.effectiveness,
    effectivenessLabel,
    accessibilityLabel: `${name}, ${effectivenessLabel}`,
  };
}

/** Best-fit first, then by name so the order is stable between visits. */
function ordered(muscles: MuscleInvolvement[]): MuscleLine[] {
  return muscles
    .slice()
    .sort((a, b) => b.effectiveness - a.effectiveness || a.name.localeCompare(b.name))
    .map(line);
}

export function describeExercise(exercise: ExerciseDetail): ExerciseView {
  return {
    title: exercise.name,
    summary: [exercise.equipment, exercise.is_compound ? "compound" : "isolation"]
      .filter((part): part is string => Boolean(part))
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" · "),
    primary: ordered(exercise.muscles.filter((muscle) => muscle.role === "primary")),
    secondary: ordered(exercise.muscles.filter((muscle) => muscle.role === "secondary")),
  };
}
