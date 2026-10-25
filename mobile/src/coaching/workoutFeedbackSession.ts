import { randomUUID } from "expo-crypto";

import * as coachingApi from "../api/coaching";
import { athleteWorkoutsStore } from "./athleteWorkoutsSession";
import { coachingStore } from "./coachingSession";
import { refreshAthleteView } from "./openAthlete";
import { createWorkoutFeedbackStore } from "./workoutFeedback";

/**
 * The app-wide store for a coach's feedback on one athlete workout. A single
 * instance so that AuthContext can clear it at sign-out without any screen
 * being mounted.
 *
 * Refusals go through the access-loss path the workout screens already use:
 * - 403 (sharing is off): `athleteWorkoutsStore.revoke("not_shared")`.
 * - 404 could mean the connection ended or only that this workout is gone, and
 *   the reply does not say which, so the usual refresh of the athlete view
 *   runs and revokes with the right reason when the connection is gone.
 */
export const workoutFeedbackStore = createWorkoutFeedbackStore(
  {
    get: coachingApi.getCoachFeedback,
    create: coachingApi.createCoachFeedback,
    update: coachingApi.updateCoachFeedback,
    remove: coachingApi.deleteCoachFeedback,
  },
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
  randomUUID,
);

// The entry and any draft must not outlive the view they belong to: another
// account or athlete, or a view that lost access (revoked, reset at sign-out).
athleteWorkoutsStore.subscribe(() => {
  const { context } = workoutFeedbackStore.getSnapshot();
  if (!context) return;
  const { scope, denied } = athleteWorkoutsStore.getSnapshot();
  const sameView = scope?.userId === context.userId && scope.linkId === context.linkId;
  if (!sameView || denied) workoutFeedbackStore.close();
});
