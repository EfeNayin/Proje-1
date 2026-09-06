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

import { useRouter } from "expo-router";
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
import type { ExerciseSummary } from "../../../src/api/exercises";
import { colors, radius, spacing } from "../../../src/theme";
import { depositPickedExercise } from "../../../src/workout/usePickedExercise";

export default function ExercisePicker() {
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ExerciseSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // Debounced: without this every keystroke fires a request and the
    // responses can arrive out of order, making the list flicker.
    const handle = setTimeout(() => {
      setLoading(true);
      exercisesApi
        .searchExercises(query)
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
  }, [query]);

  const choose = (exercise: ExerciseSummary) => {
    depositPickedExercise({ id: exercise.id, name: exercise.name_tr ?? exercise.name });
    router.back();
  };

  return (
    <View style={styles.screen}>
      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        placeholder="Search exercises"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
      />

      {loading ? (
        <ActivityIndicator color={colors.accent} style={styles.loading} />
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
                <Text style={styles.rowTitle}>{item.name_tr ?? item.name}</Text>
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
  screen: { flex: 1, backgroundColor: colors.background, padding: spacing.md },
  search: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: 16,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  loading: { marginTop: spacing.lg },
  list: { paddingBottom: spacing.xl },
  empty: { color: colors.textMuted, textAlign: "center", marginTop: spacing.lg },
  row: {
    paddingVertical: spacing.md,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowMain: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: 16 },
  rowMeta: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
});
