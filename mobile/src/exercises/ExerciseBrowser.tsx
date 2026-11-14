/**
 * The exercise browser: search at the top, two equal filter buttons under it
 * (equipment on the left, muscles on the right), the paged list and its
 * loading / empty / failed states. A filter is chosen in a bottom sheet over
 * the list and only takes effect when "Show results" is pressed. ONE implementation, used by
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

type SheetKind = "equipment" | "muscles";
/** An open filter sheet and the choice made in it that has not been applied yet. */
type Sheet = { kind: SheetKind; pending: string | null };
/** How many exercises the pending choice would show, as counted by the server. */
type PendingCount = { key: string; total: number };
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
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [pendingCount, setPendingCount] = useState<PendingCount | null>(null);
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

  const openSheet = (kind: SheetKind) => {
    Keyboard.dismiss();
    setSheet({ kind, pending: kind === "muscles" ? filters.muscle : filters.equipment });
    if (kind === "muscles" && (muscles.status === "idle" || muscles.status === "error")) loadMuscles();
  };

  // What the list would be filtered by if the open sheet were applied now: the
  // sheet's pending choice, the other filter and the search text as they are.
  const pendingFilters: ExerciseFilters | null =
    sheet === null
      ? null
      : sheet.kind === "muscles"
        ? { ...filters, muscle: sheet.pending }
        : { ...filters, equipment: sheet.pending as Equipment | null };
  const pendingKey =
    pendingFilters === null ? null : `${query.trim()}|${pendingFilters.muscle}|${pendingFilters.equipment}`;

  // The number on "Show results" is the server's own total for exactly that
  // search (one row asked for, only the total used). Until it arrives, or if it
  // cannot be fetched, the button carries no number rather than a guessed one.
  useEffect(() => {
    if (pendingFilters === null || pendingKey === null) return;
    let current = true;
    exercisesApi
      .searchExercises(query.trim(), pendingFilters, 1, 0)
      .then((page) => {
        if (current) setPendingCount({ key: pendingKey, total: page.total });
      })
      .catch(() => {});
    return () => {
      current = false;
    };
    // pendingKey stands for pendingFilters and the query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey]);

  const applySheet = () => {
    if (sheet === null || pendingFilters === null) return;
    setFilters(pendingFilters);
    setSheet(null);
  };
  const changePending = (pending: string | null) => {
    setSheet((current) => (current === null ? null : { ...current, pending }));
  };
  const applyLabel =
    pendingCount !== null && pendingCount.key === pendingKey
      ? `Show ${pendingCount.total} ${pendingCount.total === 1 ? "result" : "results"}`
      : "Show results";

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
        {/* Two equal halves, equipment on the left; resetting lives inside the sheets. */}
        <View style={styles.filters}>
          <FilterButton
            title="Equipment"
            allLabel="All Equipment"
            selected={equipmentName}
            expanded={sheet?.kind === "equipment"}
            onPress={() => openSheet("equipment")}
          />
          <FilterButton
            title="Muscles"
            allLabel="All Muscles"
            selected={muscleName}
            expanded={sheet?.kind === "muscles"}
            onPress={() => openSheet("muscles")}
          />
        </View>
      </View>

      {sheet?.kind === "muscles" ? (
        <FilterPanel
          title="Muscles"
          allLabel="All Muscles"
          options={muscles.status === "ready" ? muscleOptions(muscles.groups) : []}
          value={sheet.pending}
          applyLabel={applyLabel}
          status={muscles.status === "ready" ? "ready" : muscles.status === "error" ? "error" : "loading"}
          loadingLabel="Loading muscles"
          errorText="Could not load the muscle list."
          retryLabel="Try loading muscles again"
          onRetry={loadMuscles}
          onChange={changePending}
          onApply={applySheet}
          onDismiss={() => setSheet(null)}
        />
      ) : sheet?.kind === "equipment" ? (
        <FilterPanel
          title="Equipment"
          allLabel="All Equipment"
          options={EQUIPMENT_OPTIONS}
          value={sheet.pending}
          applyLabel={applyLabel}
          onChange={changePending}
          onApply={applySheet}
          onDismiss={() => setSheet(null)}
        />
      ) : null}

      {/* The sheet opens over the list; the list stays where it was underneath. */}
      <View style={styles.results}>
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
  allLabel,
  selected,
  expanded,
  onPress,
}: {
  title: string;
  allLabel: string;
  selected: string | null;
  expanded: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title} filter, ${selected ? `${selected} selected` : allLabel}`}
      accessibilityState={{ expanded }}
      style={[styles.filter, selected !== null && styles.filterActive]}
      onPress={onPress}
    >
      <Text numberOfLines={1} style={[styles.filterText, selected !== null && styles.filterTextActive]}>
        {selected ?? allLabel}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  browser: { flex: 1 },
  controls: { paddingHorizontal: 16 },
  results: { flex: 1 },
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
  filters: { flexDirection: "row", gap: 10, marginBottom: 12 },
  filter: {
    flex: 1,
    minHeight: MIN_TOUCH,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 12,
    borderColor: light.separator,
    borderWidth: 1,
    backgroundColor: light.surface,
  },
  filterActive: { backgroundColor: light.primary, borderColor: light.primary },
  filterText: { color: light.text, fontSize: 15, fontWeight: "600" },
  filterTextActive: { color: light.onPrimary },
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
