/**
 * Starting a workout from the Start Workout tab: an empty one, or one from a
 * program template.
 *
 * Moved out of the old Training screen unchanged in behaviour so it can be
 * tested without rendering:
 *  - The optional readiness check-in comes first. When it is enabled and today
 *    has no entry yet, nothing is started here; the check-in screen is opened
 *    (carrying the template id) and starts the workout when it is finished.
 *  - The check-in lookup fails OPEN: a flaky "is today already logged?" call
 *    must never be the reason a workout cannot be started.
 *  - A template start goes through startFromTemplate, which is what captures the
 *    starting-plan targets on the server; this module never builds targets.
 *  - One start at a time. The flag lives here, not in React state, because state
 *    only updates on the next render and a fast double tap could pass twice.
 */

export type StartOutcome =
  | { kind: "ignored" } // a start is already running; it owns the busy state
  | { kind: "checkin"; templateId?: string }
  | { kind: "started"; workoutId: string }
  | { kind: "failed"; message: string };

export type WorkoutStarterDeps = {
  isCheckinEnabled: () => Promise<boolean>;
  /** The server's answer for today; `id === null` means nothing is logged yet. */
  getTodayReadiness: () => Promise<{ id: string | number | null }>;
  startEmptyWorkout: () => Promise<{ id: string }>;
  startFromTemplate: (templateId: string) => Promise<{ workout_id: string }>;
  setActiveWorkout: (workoutId: string) => Promise<void>;
};

export function createWorkoutStarter(deps: WorkoutStarterDeps) {
  let inFlight = false;

  /** `templateId` omitted starts a free session; given, starts from that template. */
  return async function start(templateId?: string, onStart?: () => void): Promise<StartOutcome> {
    if (inFlight) return { kind: "ignored" };
    inFlight = true;
    onStart?.();
    try {
      let showCheckin = false;
      try {
        if (await deps.isCheckinEnabled()) {
          const today = await deps.getTodayReadiness();
          showCheckin = today.id === null;
        }
      } catch {
        showCheckin = false;
      }
      if (showCheckin) return templateId ? { kind: "checkin", templateId } : { kind: "checkin" };

      const workoutId = templateId
        ? (await deps.startFromTemplate(templateId)).workout_id
        : (await deps.startEmptyWorkout()).id;
      // The server session exists now. The device pointer is a convenience that the
      // server's own "active workout" backs up (see resolveActiveWorkout.ts), so a
      // failure to write it must not turn a started workout into an error.
      try {
        await deps.setActiveWorkout(workoutId);
      } catch {
        // Recovered on the next visit.
      }
      return { kind: "started", workoutId };
    } catch (err) {
      return {
        kind: "failed",
        message: err instanceof Error && err.message ? err.message : "Could not start the workout",
      };
    } finally {
      inFlight = false;
    }
  };
}
