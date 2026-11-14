import * as coachingApi from "../api/coaching";
import { createAthleteWorkoutsStore } from "./athleteWorkouts";

/**
 * The app-wide store for a coach viewing an athlete's workouts. A single
 * instance so that AuthContext can clear it at sign-out without any screen
 * being mounted.
 */
export const athleteWorkoutsStore = createAthleteWorkoutsStore({
  listWorkouts: coachingApi.listAthleteWorkouts,
  getWorkout: coachingApi.getAthleteWorkout,
});
