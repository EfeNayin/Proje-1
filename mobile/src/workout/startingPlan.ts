import type { TemplateExerciseTarget } from "../api/programs";
import type { WorkoutDetail } from "../api/workouts";

type StartingPlan = { targets: TemplateExerciseTarget[]; description: string | null };
const NO_PLAN: StartingPlan = { targets: [], description: null };

/** Only the saved plan can describe a session's targets, including after template deletion. */
export function getStartingPlan(workout: WorkoutDetail | null): StartingPlan {
  if (!workout) return NO_PLAN;
  const snapshot = workout.template_snapshot;
  if (snapshot) {
    return {
      targets: snapshot.exercises,
      description: `Starting plan: ${snapshot.name}` +
        (snapshot.exercises.length === 0 ? " — no exercise targets" : ""),
    };
  }
  if (workout.template_id) {
    return { targets: [], description: "Starting targets were not saved for this workout." };
  }
  return NO_PLAN;
}
