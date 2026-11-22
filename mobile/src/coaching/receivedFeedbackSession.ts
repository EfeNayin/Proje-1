import * as coachingApi from "../api/coaching";
import { createReceivedFeedbackStore } from "./receivedFeedback";

/**
 * The app-wide store for coach feedback on the athlete's own workout. A single
 * instance so that AuthContext can clear it at sign-out without any screen
 * being mounted.
 */
export const receivedFeedbackStore = createReceivedFeedbackStore({
  list: coachingApi.getReceivedFeedback,
});
