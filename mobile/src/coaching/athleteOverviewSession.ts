import * as coachingApi from "../api/coaching";
import { createAthleteOverviewStore, followDenials } from "./athleteOverview";
import { athleteWorkoutsStore } from "./athleteWorkoutsSession";

/**
 * The app-wide store for the roster overview. A single instance so that
 * AuthContext can clear it at sign-out without any screen being mounted.
 */
export const athleteOverviewStore = createAthleteOverviewStore({
  getOverview: coachingApi.getAthleteOverview,
});

// An athlete's own workouts screen can learn before the roster does that
// sharing was switched off or the connection ended; the card follows at once.
followDenials(athleteWorkoutsStore, athleteOverviewStore);
