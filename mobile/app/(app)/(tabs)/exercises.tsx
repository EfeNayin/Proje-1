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

import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef } from "react";
import { StyleSheet, View } from "react-native";

import type { ExerciseSummary } from "../../../src/api/exercises";
import { ExerciseBrowser } from "../../../src/exercises/ExerciseBrowser";
import { light } from "../../../src/lightTheme";
import { TabTopBar } from "../../../src/navigation/TabTopBar";

export default function ExercisesScreen() {
  const router = useRouter();
  const navigatingRef = useRef(false);

  // The tab stays mounted underneath the detail screen (which is why the query,
  // the filters and the scroll position are still there on return): each return
  // allows the next tap.
  useFocusEffect(
    useCallback(() => {
      navigatingRef.current = false;
    }, []),
  );

  const open = (exercise: ExerciseSummary) => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
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
