import type { AthleteWorkoutsState, Scope } from "./athleteWorkouts";
import type { CoachingState, Role } from "./coachingStore";

/**
 * Refreshing the coach's view of one athlete: first the coach's connection
 * list (it says whether the athlete still shares), then the workouts, and the
 * workouts are not even requested when the list already says they are closed.
 *
 * The stores are passed in so this rule can be tested with fakes.
 */

type CoachingLike = {
  bind: (userId: string | null) => void;
  load: (role: Role) => Promise<void>;
  getSnapshot: () => CoachingState;
};

type WorkoutsLike = {
  bind: (scope: Scope | null) => void;
  revoke: (reason: "not_shared" | "ended") => void;
  refresh: () => Promise<void>;
  getSnapshot: () => AthleteWorkoutsState;
};

export async function refreshAthleteView(
  coaching: CoachingLike,
  workouts: WorkoutsLike,
  scope: Scope,
): Promise<void> {
  coaching.bind(scope.userId);
  workouts.bind(scope);
  await coaching.load("coach");

  // The account or the athlete may have changed while the list loaded.
  const bound = workouts.getSnapshot().scope;
  if (bound?.userId !== scope.userId || bound.linkId !== scope.linkId) return;
  const snapshot = coaching.getSnapshot();
  if (snapshot.userId !== scope.userId) return;

  // Only a list that loaded cleanly may close the view on its own say-so; if
  // it could not be refreshed, the backend answers for itself on the next call.
  if (snapshot.athletes.loaded && snapshot.athletes.error === null) {
    const link = snapshot.athletes.items.find((item) => item.id === scope.linkId);
    if (!link) return workouts.revoke("ended");
    if (!link.shares_workouts) return workouts.revoke("not_shared");
  }
  await workouts.refresh();
}
