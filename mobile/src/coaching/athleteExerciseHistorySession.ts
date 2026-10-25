import * as coachingApi from "../api/coaching";
import { createAthleteExerciseHistoryStore } from "./athleteExerciseHistory";
import { athleteWorkoutsStore } from "./athleteWorkoutsSession";
import { coachingStore } from "./coachingSession";
import { refreshAthleteView } from "./openAthlete";

/**
 * The app-wide store for a coach's exercise-history panel. A single instance so
 * that AuthContext can clear it at sign-out without any screen being mounted.
 *
 * Refusals go through the access-loss path the workout screens already use:
 * - 403 (sharing is off): `athleteWorkoutsStore.revoke("not_shared")`. That
 *   closes the athlete's workout views and, through `followDenials`, the
 *   roster card's numbers.
 * - 404 could mean the connection ended or only that this workout or exercise
 *   is gone, and the reply does not say which. Rather than guess, the usual
 *   refresh of the athlete view runs (connection list, then workouts), which
 *   revokes with the right reason when the connection or sharing is gone.
 */
export const athleteExerciseHistoryStore = createAthleteExerciseHistoryStore(
  { getHistory: coachingApi.getAthleteExerciseHistory },
  {
    onForbidden: ({ userId, linkId }) => {
      const scope = athleteWorkoutsStore.getSnapshot().scope;
      if (scope?.userId === userId && scope.linkId === linkId) {
        athleteWorkoutsStore.revoke("not_shared");
      }
    },
    onUnavailable: ({ userId, linkId }) => {
      void refreshAthleteView(coachingStore, athleteWorkoutsStore, { userId, linkId });
    },
  },
);

// The panel must not outlive the view it was opened from: another account or
// athlete, or a view that lost access (revoked, reset at sign-out).
athleteWorkoutsStore.subscribe(() => {
  const { context } = athleteExerciseHistoryStore.getSnapshot();
  if (!context) return;
  const { scope, denied } = athleteWorkoutsStore.getSnapshot();
  const sameView = scope?.userId === context.userId && scope.linkId === context.linkId;
  if (!sameView || denied) athleteExerciseHistoryStore.close();
});
