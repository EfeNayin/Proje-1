import type { WorkoutDetail } from "../api/workouts";

export type ExerciseSetComparison = {
  plannedSets: number;
  recordedSets: number;
  unrecordedSets: number;
  extraSets: number;
};

export type PlanComparison = {
  plannedSets: number;
  recordedPlannedSets: number;
  unrecordedSets: number;
  extraSets: number;
  exercises: Map<string, ExerciseSetComparison>;
};

/** Compare set counts only. Extra work on one exercise never fills another's targets. */
export function compareWorkoutToPlan(workout: WorkoutDetail | null): PlanComparison | null {
  if (!workout?.template_snapshot) return null;
  const exercises = new Map<string, ExerciseSetComparison>();
  const entry = (exerciseId: string) => {
    let value = exercises.get(exerciseId);
    if (!value) {
      value = { plannedSets: 0, recordedSets: 0, unrecordedSets: 0, extraSets: 0 };
      exercises.set(exerciseId, value);
    }
    return value;
  };

  // A template can contain multiple blocks for the same exercise; combine counts
  // so its logged sets are not credited more than once.
  for (const target of workout.template_snapshot.exercises) {
    entry(target.exercise_id).plannedSets += target.target_sets;
  }
  for (const set of workout.sets) {
    if (!set.is_warmup && set.reps > 0) entry(set.exercise_id).recordedSets++;
  }

  const result: PlanComparison = {
    plannedSets: 0, recordedPlannedSets: 0, unrecordedSets: 0, extraSets: 0, exercises,
  };
  for (const exercise of exercises.values()) {
    exercise.unrecordedSets = Math.max(0, exercise.plannedSets - exercise.recordedSets);
    exercise.extraSets = Math.max(0, exercise.recordedSets - exercise.plannedSets);
    result.plannedSets += exercise.plannedSets;
    result.recordedPlannedSets += Math.min(exercise.recordedSets, exercise.plannedSets);
    result.unrecordedSets += exercise.unrecordedSets;
    result.extraSets += exercise.extraSets;
  }
  return result;
}
