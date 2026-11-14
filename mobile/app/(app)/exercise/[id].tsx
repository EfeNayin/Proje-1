/**
 * Exercise details, opened from the Exercises tab.
 *
 * Read-only: see src/exercises/ExerciseDetailBody.tsx, which the exercise picker
 * also shows in place. It has no "choose" action on purpose: adding an exercise
 * to a workout or a program happens in the picker.
 */

import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { ExerciseDetailBody } from "../../../src/exercises/ExerciseDetailBody";
import { light } from "../../../src/lightTheme";

export default function ExerciseDetailScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const [title, setTitle] = useState<string | null>(null);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: title ?? "Exercise" }} />
      <ExerciseDetailBody id={id} onTitle={setTitle} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background },
});
