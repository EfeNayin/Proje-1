import { randomUUID } from "expo-crypto";

import * as coachingApi from "../api/coaching";
import { createProgramOffersStore } from "./programOffers";

/**
 * The app-wide store for program offers. A single instance so that AuthContext
 * can clear it at sign-out without any screen being mounted.
 */
export const programOffersStore = createProgramOffersStore(
  {
    listReceived: coachingApi.listReceivedOffers,
    getReceived: coachingApi.getReceivedOffer,
    accept: coachingApi.acceptOffer,
    decline: coachingApi.declineOffer,
    listSent: coachingApi.listSentOffers,
    send: coachingApi.sendProgramOffer,
  },
  randomUUID,
);
