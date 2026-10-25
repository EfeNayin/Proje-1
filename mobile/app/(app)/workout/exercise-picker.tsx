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

import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
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
import { light } from "../../../src/lightTheme";
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
  const { appearance } = useLocalSearchParams<{ appearance?: string }>();
  const isLight = appearance === "light";
  const palette = isLight ? lightPalette : defaultPalette;
  const styles = useMemo(() => createStyles(palette), [palette]);

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
      {isLight ? (
        // Opted in by the athlete workout screen only. The modal header comes
        // from the app Stack; this restyles just this instance of it.
        <Stack.Screen
          options={{
            headerStyle: { backgroundColor: light.surface },
            headerTintColor: light.text,
            headerTitleStyle: { color: light.text },
            headerShadowVisible: false,
          }}
        />
      ) : null}
      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        placeholder="Search exercises"
        placeholderTextColor={palette.textMuted}
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
        <ActivityIndicator color={palette.accent} style={styles.loading} />
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

// The picker is shared with the program template editor, which keeps its
// current look. Only a caller that passes appearance=light (the athlete
// workout screen, via usePickedExercise) gets the light palette.
type Palette = {
  background: string;
  surface: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accentText: string;
  inputRadius: number;
  inputBorder: number;
};

const defaultPalette: Palette = {
  background: colors.background,
  surface: colors.surface,
  border: colors.border,
  text: colors.text,
  textMuted: colors.textMuted,
  accent: colors.accent,
  accentText: colors.accentText,
  inputRadius: radius.sm,
  inputBorder: 1,
};

const lightPalette: Palette = {
  background: light.background,
  surface: light.surface,
  border: light.separator,
  text: light.text,
  textMuted: light.textSecondary,
  accent: light.primary,
  accentText: light.onPrimary,
  inputRadius: 10,
  inputBorder: 0,
};

const createStyles = (p: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: p.background, padding: spacing.md },
  search: {
    backgroundColor: p.surface,
    borderColor: p.border,
    borderWidth: p.inputBorder,
    borderRadius: p.inputRadius,
    color: p.text,
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
    borderColor: p.border,
    borderWidth: 1,
    backgroundColor: p.surface,
    alignSelf: "center",
  },
  chipActive: { backgroundColor: p.accent, borderColor: p.accent },
  chipText: { color: p.textMuted, fontSize: 14, fontWeight: "600" },
  chipTextActive: { color: p.accentText },
  loading: { marginTop: spacing.lg },
  list: { paddingBottom: spacing.xl },
  empty: { color: p.textMuted, textAlign: "center", marginTop: spacing.lg },
  row: {
    paddingVertical: spacing.md,
    borderBottomColor: p.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowMain: { flex: 1 },
  rowTitle: { color: p.text, fontSize: 16 },
  rowMeta: { color: p.textMuted, fontSize: 13, marginTop: 2 },
});
