/**
 * Exercises: browse the real catalogue and open an exercise's details.
 *
 * Browsing only. Choosing an exercise for a workout or a program is a separate,
 * explicit action in the existing picker (app/(app)/workout/exercise-picker.tsx);
 * this screen never deposits a pick (usePickedExercise) and so can never drop an
 * exercise into a form the user is not looking at.
 *
 * The workout picker stops at the first 50 matches. This screen pages with the
 * API's offset (src/exercises/exerciseBrowser.ts) so every matching entry is
 * reachable, and tells loading, "nothing matches" and "the request failed" apart.
 */

import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
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
import type { Category } from "../../../src/api/exercises";
import { CategoryChips } from "../../../src/exercises/CategoryChips";
import { browserView, createExerciseBrowser } from "../../../src/exercises/exerciseBrowser";
import { light } from "../../../src/lightTheme";
import { TabTopBar } from "../../../src/navigation/TabTopBar";

const MIN_TOUCH = 44;
const DEBOUNCE_MS = 250;

export default function ExercisesScreen() {
  const router = useRouter();
  const [browser] = useState(() => createExerciseBrowser(exercisesApi.searchExercises));
  const state = useSyncExternalStore(browser.subscribe, browser.getSnapshot);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category | null>(null);
  const firstSearch = useRef(true);
  const navigatingRef = useRef(false);

  // Debounced: without this every keystroke fires a request. Out-of-order answers
  // are already ignored by the store, so the debounce only saves requests. The
  // first search (the unfiltered catalogue) does not wait.
  useEffect(() => {
    const delay = firstSearch.current ? 0 : DEBOUNCE_MS;
    firstSearch.current = false;
    const handle = setTimeout(() => {
      void browser.search(query, category);
    }, delay);
    return () => clearTimeout(handle);
  }, [browser, query, category]);

  useEffect(() => () => browser.cancel(), [browser]);

  // The tab stays mounted underneath the detail screen: each return allows the next tap.
  useFocusEffect(
    useCallback(() => {
      navigatingRef.current = false;
    }, []),
  );

  const view = browserView(state);
  const filtered = query.trim() !== "" || category !== null;

  const open = (id: string) => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    router.push({ pathname: "/exercise/[id]", params: { id } });
  };

  return (
    <View style={styles.screen}>
      <TabTopBar title="Exercises" />
      <View style={styles.controls}>
        <TextInput
          style={styles.search}
          accessibilityLabel="Search exercises"
          value={query}
          onChangeText={setQuery}
          placeholder="Search exercises"
          placeholderTextColor={light.textSecondary}
          selectionColor={light.text}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        <CategoryChips value={category} onChange={setCategory} />
      </View>

      {view === "loading" ? (
        <View style={styles.centered}>
          <ActivityIndicator color={light.textSecondary} accessibilityLabel="Loading exercises" />
        </View>
      ) : view === "error" ? (
        <View style={styles.centered}>
          <Text accessibilityRole="alert" style={styles.errorText}>
            Could not load exercises.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try loading exercises again"
            style={styles.retry}
            onPress={() => void browser.search(query, category)}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : view === "empty" ? (
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>No exercises found</Text>
          <Text style={styles.emptyText}>
            {filtered ? "Try a different word or category." : "The catalogue has no exercises yet."}
          </Text>
        </View>
      ) : (
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.content}
          data={state.items}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onEndReached={() => {
            void browser.loadMore();
          }}
          onEndReachedThreshold={0.4}
          ListHeaderComponent={
            <Text accessibilityLiveRegion="polite" style={styles.count}>
              {state.loading
                ? "Searching…"
                : `${state.total} ${state.total === 1 ? "exercise" : "exercises"}`}
            </Text>
          }
          ListFooterComponent={
            <View style={styles.footer}>
              {state.error === "more" ? (
                <>
                  <Text accessibilityRole="alert" style={styles.errorText}>
                    Could not load more exercises.
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Try loading more exercises again"
                    style={styles.retry}
                    onPress={() => void browser.loadMore(true)}
                  >
                    <Text style={styles.retryText}>Try again</Text>
                  </Pressable>
                </>
              ) : state.loadingMore ? (
                <ActivityIndicator color={light.textSecondary} accessibilityLabel="Loading more exercises" />
              ) : state.hasMore && !state.loading ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Load more exercises"
                  style={styles.retry}
                  onPress={() => void browser.loadMore()}
                >
                  <Text style={styles.retryText}>Load more exercises</Text>
                </Pressable>
              ) : null}
            </View>
          }
          renderItem={({ item, index }) => {
            const meta = [item.equipment, item.is_compound ? "compound" : "isolation"]
              .filter(Boolean)
              .join(" · ");
            const first = index === 0;
            const last = index === state.items.length - 1;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.name}, ${meta}`}
                accessibilityHint="Opens the exercise details"
                style={({ pressed }) => [
                  styles.row,
                  first && styles.rowFirst,
                  last ? styles.rowLast : styles.rowDivider,
                  pressed && styles.rowPressed,
                ]}
                onPress={() => open(item.id)}
              >
                <View style={styles.rowMain}>
                  <Text numberOfLines={2} style={styles.rowTitle}>
                    {item.name}
                  </Text>
                  <Text style={styles.rowMeta}>{meta}</Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background },
  controls: { paddingHorizontal: 16 },
  list: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 24 },

  search: {
    minHeight: 48,
    backgroundColor: light.surface,
    borderRadius: 10,
    color: light.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  count: { color: light.textSecondary, fontSize: 13, marginLeft: 4, marginBottom: 8 },

  row: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: light.surface,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  rowFirst: { borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  rowLast: { borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
  rowDivider: { borderBottomColor: light.separator, borderBottomWidth: StyleSheet.hairlineWidth },
  rowPressed: { backgroundColor: light.pressed },
  rowMain: { flex: 1, minWidth: 0, rowGap: 2 },
  rowTitle: { color: light.text, fontSize: 16, fontWeight: "600" },
  rowMeta: { color: light.textSecondary, fontSize: 13 },

  footer: { alignItems: "center", paddingVertical: 24, gap: 8 },
  errorText: { color: light.danger, fontSize: 14, textAlign: "center" },
  retry: {
    minHeight: MIN_TOUCH,
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: light.surface,
  },
  retryText: { color: light.text, fontSize: 15, fontWeight: "600" },
  emptyTitle: { color: light.text, fontSize: 17, fontWeight: "600", textAlign: "center" },
  emptyText: { color: light.textSecondary, fontSize: 14, textAlign: "center" },
});
