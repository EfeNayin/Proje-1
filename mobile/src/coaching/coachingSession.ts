import * as coachingApi from "../api/coaching";
import { createCoachingStore } from "./coachingStore";

/**
 * The app-wide store. A single instance so that AuthContext can clear it at
 * sign-out without any screen being mounted.
 */
export const coachingStore = createCoachingStore(coachingApi);
