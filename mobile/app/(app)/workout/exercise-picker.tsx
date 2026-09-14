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
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import * as exercisesApi from "../../../src/api/exercises";
import type { Category, ExerciseSummary } from "../../../src/api/exercises";
import { colors, radius, spacing } from "../../../src/theme";
import { depositPickedExercise } from "../../../src/workout/usePickedExercise";

// Adım 26: the catalogue is ~96 exercises deep and everything used to land
// in one flat list, which made picking something a scroll-and-hope. These
// chips are a coarser grouping than the 17-muscle taxonomy used elsewhere in
// the app (volume screen, exercise detail) — just enough to narrow "I want a
// chest exercise" without asking the user to know which of the 17 they mean.
const CATEGORIES: { code: Category; label: string }[] = [
  { code: "chest", label: "Chest" },
  { code: "back", label: "Back" },
  { code: "biceps", label: "Biceps" },
  { code: "triceps", label: "Triceps" },
  { code: "legs", label: "Legs" },
  { code: "abs", label: "Abs" },
  { code: "shoulders", label: "Shoulders" },
];

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

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.categories}
        contentContainerStyle={styles.categoriesContent}
      >
        {CATEGORIES.map(({ code, label }) => (
          <Pressable
            key={code}
            // Tapping the already-selected chip clears it, same as the
            // rating dots on the check-in screen: there must be a way back
            // to "browsing everything" without a separate "All" chip taking
            // up space of its own.
            onPress={() => setCategory((current) => (current === code ? null : code))}
            style={[styles.chip, category === code && styles.chipActive]}
          >
            <Text style={[styles.chipText, category === code && styles.chipTextActive]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

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
  // A horizontal ScrollView has no intrinsic height of its own — without one
  // set here, its cross-axis size is ambiguous and each chip's rounded
  // background stretches to fill it (default cross-axis alignItems is
  // "stretch"), which is what made the pills render as a cut-off, ghosted
  // sliver instead of a clean rounded chip. A fixed height plus centering
  // the row's content removes that ambiguity.
  categories: { flexGrow: 0, height: 44, marginBottom: spacing.md },
  categoriesContent: { gap: spacing.sm, paddingRight: spacing.md, alignItems: "center" },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    alignSelf: "center",
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.textMuted, fontSize: 14, fontWeight: "600" },
  chipTextActive: { color: colors.accentText },
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
