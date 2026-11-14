import type { TemplateExerciseInput } from "../api/programs";
import type { WorkoutDetail } from "../api/workouts";

/**
 * Turns what was actually logged into template targets — a plan, not a
 * record of this specific session. Warmups are excluded (target_sets counts
 * working sets only), target_rir is always null (nothing logged implies an
 * effort target; the user sets that later in the template editor), and
 * exercise order follows the order sets were first logged in, same as the
 * on-screen blocks.
 */
export function buildTemplateExercisesFromWorkout(workout: WorkoutDetail): TemplateExerciseInput[] {
  const order: string[] = [];
  const repsByExercise = new Map<string, number[]>();

  for (const set of workout.sets) {
    if (set.is_warmup || set.reps <= 0) continue;
    if (!repsByExercise.has(set.exercise_id)) {
      repsByExercise.set(set.exercise_id, []);
      order.push(set.exercise_id);
    }
    repsByExercise.get(set.exercise_id)?.push(set.reps);
  }

  return order.map((exerciseId) => {
    const reps = repsByExercise.get(exerciseId) ?? [];
    return {
      exercise_id: exerciseId,
      target_sets: reps.length,
      target_reps_min: Math.min(...reps),
      target_reps_max: Math.max(...reps),
      target_rir: null,
    };
  });
}

