/**
 * The exercise browser: search, Muscles and Equipment filters, the paged list
 * and its loading / empty / failed states. ONE implementation, used by
 *  - the Exercises tab (mode "browse": a row opens the exercise's details), and
 *  - the workout/program exercise picker (mode "select": a row chooses it).
 *
 * The browser never decides what a tap means and never navigates: it reports
 * `onRowPress` and `onInfo` and the host screen acts. That is what keeps
 * browsing from ever depositing a pick, and choosing from ever being a side
 * effect of looking something up.
 *
 * Filtering and paging happen on the server (src/exercises/exerciseBrowserStore.ts);
 * the query, the muscle and the equipment always go out together.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import * as exercisesApi from "../api/exercises";
import type { Equipment, ExerciseFilters, ExerciseSummary, MuscleGroupSummary } from "../api/exercises";
import { light } from "../lightTheme";
import { ExerciseRow } from "./ExerciseRow";
import { FilterPanel } from "./FilterPanel";
import { browserView, createExerciseBrowser } from "./exerciseBrowserStore";
import { EQUIPMENT_OPTIONS, NO_FILTERS, hasFilters, muscleLabel, muscleOptions } from "./exerciseFilters";

const MIN_TOUCH = 44;
const DEBOUNCE_MS = 250;

type Panel = "muscles" | "equipment" | null;
type MuscleCatalogue =
  | { status: "idle" | "loading" | "error" }
  | { status: "ready"; groups: MuscleGroupSummary[] };

export function ExerciseBrowser({
  mode,
  onRowPress,
  onInfo,
  autoFocus = false,
}: {
  mode: "browse" | "select";
  onRowPress: (exercise: ExerciseSummary) => void;
  onInfo: (exercise: ExerciseSummary) => void;
  autoFocus?: boolean;
}) {
  const [browser] = useState(() => createExerciseBrowser(exercisesApi.searchExercises));
  const state = useSyncExternalStore(browser.subscribe, browser.getSnapshot);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<ExerciseFilters>(NO_FILTERS);
  const [panel, setPanel] = useState<Panel>(null);
  const [muscles, setMuscles] = useState<MuscleCatalogue>({ status: "idle" });
  const firstSearch = useRef(true);
  const mounted = useRef(true);

  // Debounced: without this every keystroke fires a request. Out-of-order answers
  // are already ignored by the store, so the debounce only saves requests. The
  // first search (the unfiltered catalogue) does not wait.
  useEffect(() => {
    const delay = firstSearch.current ? 0 : DEBOUNCE_MS;
    firstSearch.current = false;
    const handle = setTimeout(() => {
      void browser.search(query, filters);
    }, delay);
    return () => clearTimeout(handle);
  }, [browser, query, filters]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      browser.cancel();
    };
  }, [browser]);

  // The muscle groups are the server's catalogue, asked for when the panel is
  // first opened and kept for as long as this browser lives.
  const loadMuscles = () => {
    setMuscles({ status: "loading" });
    exercisesApi
      .listMuscleGroups()
      .then((groups) => {
        if (mounted.current) setMuscles({ status: "ready", groups });
      })
      .catch(() => {
        if (mounted.current) setMuscles({ status: "error" });
      });
  };

  const openPanel = (next: Exclude<Panel, null>) => {
    Keyboard.dismiss();
    setPanel((current) => (current === next ? null : next));
    if (next === "muscles" && (muscles.status === "idle" || muscles.status === "error")) loadMuscles();
  };

  const view = browserView(state);
  const filtered = query.trim() !== "" || hasFilters(filters);
  const muscleName = filters.muscle ? muscleLabel(filters.muscle) : null;
  const equipmentName =
    EQUIPMENT_OPTIONS.find((option) => option.value === filters.equipment)?.label ?? null;

  return (
    <View style={styles.browser}>
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
          autoFocus={autoFocus}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        <View style={styles.filters}>
          <FilterButton
            title="Muscles"
            selected={muscleName}
            emptyLabel="all muscles"
            expanded={panel === "muscles"}
            onPress={() => openPanel("muscles")}
          />
          <FilterButton
            title="Equipment"
            selected={equipmentName}
            emptyLabel="all equipment"
            expanded={panel === "equipment"}
            onPress={() => openPanel("equipment")}
          />
          {hasFilters(filters) ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear filters"
              style={styles.clear}
              onPress={() => {
                setFilters(NO_FILTERS);
                setPanel(null);
              }}
            >
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {panel === "muscles" ? (
        <FilterPanel
          title="Muscles"
          allLabel="All muscles"
          options={muscles.status === "ready" ? muscleOptions(muscles.groups) : []}
          value={filters.muscle}
          status={muscles.status === "ready" ? "ready" : muscles.status === "error" ? "error" : "loading"}
          loadingLabel="Loading muscles"
          errorText="Could not load the muscle list."
          retryLabel="Try loading muscles again"
          onRetry={loadMuscles}
          onSelect={(muscle) => {
            setFilters((current) => ({ ...current, muscle }));
            setPanel(null);
          }}
          onClose={() => setPanel(null)}
        />
      ) : panel === "equipment" ? (
        <FilterPanel
          title="Equipment"
          allLabel="All equipment"
          options={EQUIPMENT_OPTIONS}
          value={filters.equipment}
          onSelect={(equipment) => {
            setFilters((current) => ({ ...current, equipment: equipment as Equipment | null }));
            setPanel(null);
          }}
          onClose={() => setPanel(null)}
        />
      ) : null}

      {/* Hidden, not unmounted, while a panel is open: closing it without a change keeps the list where it was. */}
      <View style={[styles.results, panel !== null && styles.hidden]}>
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
              onPress={() => void browser.search(query, filters)}
            >
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : view === "empty" ? (
          <View style={styles.centered}>
            <Text style={styles.emptyTitle}>No exercises found</Text>
            <Text style={styles.emptyText}>
              {filtered ? "Try a different word or filter." : "The catalogue has no exercises yet."}
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
            renderItem={({ item, index }) => (
              <ExerciseRow
                exercise={item}
                mode={mode}
                first={index === 0}
                last={index === state.items.length - 1}
                onPress={() => onRowPress(item)}
                onInfo={() => onInfo(item)}
              />
            )}
          />
        )}
      </View>
    </View>
  );
}

function FilterButton({
  title,
  selected,
  emptyLabel,
  expanded,
  onPress,
}: {
  title: string;
  selected: string | null;
  emptyLabel: string;
  expanded: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title} filter, ${selected ? `${selected} selected` : emptyLabel}`}
      accessibilityState={{ expanded }}
      style={[styles.filter, selected !== null && styles.filterActive]}
      onPress={onPress}
    >
      <Text numberOfLines={1} style={[styles.filterText, selected !== null && styles.filterTextActive]}>
        {selected ?? title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  browser: { flex: 1 },
  controls: { paddingHorizontal: 16 },
  results: { flex: 1 },
  hidden: { display: "none" },
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
  filters: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 12 },
  filter: {
    minHeight: MIN_TOUCH,
    maxWidth: "100%",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 12,
    borderColor: light.separator,
    borderWidth: 1,
    backgroundColor: light.surface,
  },
  filterActive: { backgroundColor: light.primary, borderColor: light.primary },
  filterText: { color: light.text, fontSize: 15, fontWeight: "600" },
  filterTextActive: { color: light.onPrimary },
  clear: { minHeight: MIN_TOUCH, justifyContent: "center", paddingHorizontal: 8 },
  clearText: { color: light.text, fontSize: 15, fontWeight: "600", textDecorationLine: "underline" },
  count: { color: light.textSecondary, fontSize: 13, marginLeft: 4, marginBottom: 8 },

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
