/**
 * Exercise picker.
 *
 * Search is server-side and accent-insensitive, so "gogus" finds "Göğüs" —
 * on a phone most people do not switch to a Turkish keyboard mid-set.
 *
 * Caller-agnostic: it does not need to know who opened it or why. It
 * deposits the choice for usePickedExercise() to collect and goes back,
 * resuming whichever screen was open rather than recreating it — see
 * usePickedExercise for why that distinction matters.
 */

import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import * as exercisesApi from "../../../src/api/exercises";
import type { Category, ExerciseSummary } from "../../../src/api/exercises";
import { CategoryChips } from "../../../src/exercises/CategoryChips";
import { light } from "../../../src/lightTheme";
import { spacing } from "../../../src/theme";
import { depositPickedExercise } from "../../../src/workout/usePickedExercise";

// The category chips (Adım 26) are shared with the Exercises tab; see
// src/exercises/categories.ts. This screen is still the ONLY one that
// deposits a pick for a workout or a program.

export default function ExercisePicker() {
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category | null>(null);
  const [results, setResults] = useState<ExerciseSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // Debounced: without this every keystroke fires a request and the
    // responses can arrive out of order, making the list flicker. Switching
    // category goes through the same debounce rather than a separate
    // immediate fetch, so a quick tap-through of categories does not fire a
    // request per tap.
    const handle = setTimeout(() => {
      setLoading(true);
      exercisesApi
        .searchExercises(query, category)
        .then((data) => {
          if (!cancelled) setResults(data.items);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, category]);

  const choose = (exercise: ExerciseSummary) => {
    // English name, matching what the workout/program APIs already return
    // for a logged set (workouts/service.py, programs/service.py both send
    // exercise.name, never name_tr) — this screen was the one place still
    // showing the Turkish name.
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
      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        placeholder="Search exercises"
        placeholderTextColor={light.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
      />

      <CategoryChips value={category} onChange={setCategory} />

      {loading ? (
        <ActivityIndicator color={light.textSecondary} style={styles.loading} />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No matches.</Text>}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => choose(item)}>
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle}>{item.name}</Text>
                <Text style={styles.rowMeta}>
                  {[item.equipment, item.is_compound ? "compound" : "isolation"]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background, padding: spacing.md },
  search: {
    backgroundColor: light.surface,
    borderColor: light.separator,
    borderWidth: 0,
    borderRadius: 10,
    color: light.text,
    fontSize: 16,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  loading: { marginTop: spacing.lg },
  list: { paddingBottom: spacing.xl },
  empty: { color: light.textSecondary, textAlign: "center", marginTop: spacing.lg },
  row: {
    paddingVertical: spacing.md,
    borderBottomColor: light.separator,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowMain: { flex: 1 },
  rowTitle: { color: light.text, fontSize: 16 },
  rowMeta: { color: light.textSecondary, fontSize: 13, marginTop: 2 },
});
