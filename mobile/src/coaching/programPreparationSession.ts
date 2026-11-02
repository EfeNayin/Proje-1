import { randomUUID } from "expo-crypto";

import * as coachingApi from "../api/coaching";
import { createProgramPreparationStore } from "./programPreparation";

/**
 * The app-wide store for the programs a coach prepares for an athlete. A single instance
 * so that AuthContext can clear it at sign-out without any screen being mounted.
 */
export const programPreparationStore = createProgramPreparationStore(
  {
    list: coachingApi.listLineages,
    create: coachingApi.createLineage,
    get: coachingApi.getLineage,
    discard: coachingApi.discardLineage,
    preview: coachingApi.getLineagePreview,
    publish: coachingApi.publishLineageVersion,
  },
  randomUUID,
);
