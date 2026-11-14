/**
 * Exercise picker, opened from an active workout and from a program template.
 *
 * The list, the search and the Muscles / Equipment filters are the shared
 * browser (src/exercises/ExerciseBrowser.tsx), the same one the Exercises tab
 * uses, so every matching exercise is reachable here too. This screen only
 * decides what a tap means here:
 *  - the row CHOOSES the exercise, once, and goes back;
 *  - the information button shows the exercise's details and chooses nothing.
 *
 * Caller-agnostic: it does not need to know who opened it or why. It
 * deposits the choice for usePickedExercise() to collect and goes back,
 * resuming whichever screen was open rather than recreating it, so an unsaved
 * workout or template draft is still there (see usePickedExercise).
 *
 * The details are drawn inside this screen instead of being pushed as another
 * route. This screen is a native modal; what a second screen opened on top of a
 * modal looks like, and how it is dismissed, is not something expo-router's
 * documentation defines, while a view in the same screen has no such question.
 * The browser stays mounted underneath (only hidden), so the query, the filters
 * and the list position are untouched when the details are closed.
 */

import { Stack, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Keyboard, Pressable, StyleSheet, Text, View } from "react-native";

import type { ExerciseSummary } from "../../../src/api/exercises";
import { ExerciseBrowser } from "../../../src/exercises/ExerciseBrowser";
import { ExerciseDetailBody } from "../../../src/exercises/ExerciseDetailBody";
import { light } from "../../../src/lightTheme";
import { depositPickedExercise } from "../../../src/workout/usePickedExercise";

const MIN_TOUCH = 44;

export default function ExercisePicker() {
  const router = useRouter();
  const [infoId, setInfoId] = useState<string | null>(null);
  const chosen = useRef(false);

  const choose = (exercise: ExerciseSummary) => {
    // One pick per visit: a double tap, or a second row tapped while the screen
    // is closing, must not replace the pick or pop a second screen.
    if (chosen.current) return;
    chosen.current = true;
    // English name, matching what the workout/program APIs already return
    // for a logged set (workouts/service.py, programs/service.py both send
    // exercise.name, never name_tr).
    depositPickedExercise({ id: exercise.id, name: exercise.name });
    router.back();
  };

  return (
    <View style={styles.screen}>
      {/* The modal header comes from the app Stack; this makes it light too. */}
      <Stack.Screen
        options={{
          headerStyle: { backgroundColor: light.surface },
          headerTintColor: light.text,
          headerTitleStyle: { color: light.text },
          headerShadowVisible: false,
        }}
      />
      <View style={[styles.fill, infoId !== null && styles.hidden]}>
        <ExerciseBrowser
          mode="select"
          autoFocus
          onRowPress={choose}
          onInfo={(exercise) => {
            // The search field is focused when the picker opens; left up, its
            // keyboard would cover the lower half of the details.
            Keyboard.dismiss();
            setInfoId(exercise.id);
          }}
        />
      </View>
      {infoId !== null ? (
        <View style={styles.fill}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to exercises"
            style={styles.back}
            onPress={() => setInfoId(null)}
          >
            <Text style={styles.backText}>‹ Exercises</Text>
          </Pressable>
          <ExerciseDetailBody id={infoId} selecting />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background, paddingTop: 16 },
  fill: { flex: 1 },
  hidden: { display: "none" },
  back: { minHeight: MIN_TOUCH, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: 16 },
  backText: { color: light.text, fontSize: 16, fontWeight: "600" },
});
