import * as readinessApi from "../api/readiness";
import { createDailyCheckinStore } from "./dailyCheckin";

/**
 * The app-wide store for the standalone daily check-in. A single instance so that
 * AuthContext can clear it at sign-out without the screen being mounted.
 */
export const dailyCheckinStore = createDailyCheckinStore({
  getToday: readinessApi.getTodayReadiness,
  patchToday: readinessApi.patchTodayReadiness,
});
