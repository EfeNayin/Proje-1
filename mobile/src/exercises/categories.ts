/**
 * The broad browsing categories, shared by the workout exercise picker and the
 * Exercises tab so the two can never drift apart.
 *
 * Adım 26: the catalogue was one flat list, which made finding something a
 * scroll-and-hope. These chips are a coarser grouping than the 17-muscle
 * taxonomy used elsewhere in the app (volume screen, exercise detail) — just
 * enough to narrow "I want a chest exercise" without asking the user to know
 * which of the 17 they mean.
 */

import type { Category } from "../api/exercises";

export const CATEGORIES: { code: Category; label: string }[] = [
  { code: "chest", label: "Chest" },
  { code: "back", label: "Back" },
  { code: "biceps", label: "Biceps" },
  { code: "triceps", label: "Triceps" },
  { code: "legs", label: "Legs" },
  { code: "abs", label: "Abs" },
  { code: "shoulders", label: "Shoulders" },
];
