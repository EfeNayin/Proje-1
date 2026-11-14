/**
 * Exercises: browse the real catalogue and open an exercise's details.
 *
 * The list, the search and the Muscles / Equipment filters are the shared
 * browser (src/exercises/ExerciseBrowser.tsx), the same one the workout and
 * program exercise picker uses. This screen only decides what a tap means here:
 * the row and its information button both open the details.
 *
 * Browsing only. Choosing an exercise for a workout or a program is a separate,
 * explicit action in the picker (app/(app)/workout/exercise-picker.tsx); this
 * screen never deposits a pick (usePickedExercise) and so can never drop an
 * exercise into a form the user is not looking at.
 */

import { useRouter } from "expo-router";
import { useRef } from "react";
import { StyleSheet, View } from "react-native";

import type { ExerciseSummary } from "../../../src/api/exercises";
import { ExerciseBrowser } from "../../../src/exercises/ExerciseBrowser";
import { light } from "../../../src/lightTheme";
import { TabTopBar } from "../../../src/navigation/TabTopBar";

/** Taps closer together than this are one double tap and open one screen. */
const DOUBLE_TAP_MS = 600;

export default function ExercisesScreen() {
  const router = useRouter();
  const lastOpenRef = useRef(0);

  // One screen per tap. The guard is a short time window and releases itself.
  // It used to be a flag that only the tab's next focus event cleared: if a push
  // was ever not followed by that event (it failed, or a development reload came
  // in between), every row and information button stayed dead until the app was
  // restarted.
  const open = (exercise: ExerciseSummary) => {
    const now = Date.now();
    if (now - lastOpenRef.current < DOUBLE_TAP_MS) return;
    lastOpenRef.current = now;
    router.push({ pathname: "/exercise/[id]", params: { id: exercise.id } });
  };

  return (
    <View style={styles.screen}>
      <TabTopBar title="Exercises" />
      <ExerciseBrowser mode="browse" onRowPress={open} onInfo={open} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background },
});
