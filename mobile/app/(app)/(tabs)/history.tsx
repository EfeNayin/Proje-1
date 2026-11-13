/**
 * History: the user's finished workouts, newest first, grouped by local day.
 *
 * The list the old Training screen showed under "Recent workouts", moved here
 * and narrowed to sessions that are over. The one session still in progress is
 * resumed from Start Workout, not listed here.
 *
 * Paging, duplicate suppression, refresh, retries and stale-response handling
 * all belong to createWorkoutHistory and are untouched; the store keeps every
 * row the server sends and the filtering for display happens afterwards
 * (src/workout/historyDisplay.ts), so a hidden row never changes how far the next
 * page request advances. Opening a row uses the existing workout screen.
 */

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";

import * as workoutsApi from "../../../src/api/workouts";
import { light } from "../../../src/lightTheme";
import { TabTopBar } from "../../../src/navigation/TabTopBar";
import { cardMetaFor, historySections } from "../../../src/workout/historyDisplay";
import { createWorkoutHistory } from "../../../src/workout/workoutHistory";

const MIN_TOUCH = 44;

export default function HistoryScreen() {
  const router = useRouter();
  const [history] = useState(() => createWorkoutHistory(workoutsApi.listWorkouts));
  const { items, loading, loadingMore, hasMore, error } = useSyncExternalStore(
    history.subscribe,
    history.getSnapshot,
  );
  const navigatingRef = useRef(false);

  // Re-run on every focus so finishing a workout is reflected on return.
  useFocusEffect(
    useCallback(() => {
      navigatingRef.current = false;
      void history.refresh();
      return () => {
        history.cancel();
      };
    }, [history]),
  );

  // Hidden rows (the session in progress) are dropped here, after paging.
  const sections = useMemo(() => historySections(items), [items]);
  const visibleCount = useMemo(
    () => sections.reduce((count, section) => count + section.data.length, 0),
    [sections],
  );

  const open = (id: string) => {
    // A double tap must not stack two copies of the workout screen.
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    router.push(`/workout/${id}`);
  };

  if (loading && items.length === 0) {
    return (
      <View style={styles.screen}>
        <TabTopBar title="History" />
        <View style={styles.centered}>
          <ActivityIndicator color={light.textSecondary} accessibilityLabel="Loading workouts" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <TabTopBar title="History" />
      <SectionList
        style={styles.list}
        contentContainerStyle={styles.content}
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        onEndReached={() => {
          void history.loadMore();
        }}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void history.refresh()}
            tintColor={light.textSecondary}
          />
        }
        ListHeaderComponent={
          error === "refresh" ? (
            <View style={styles.errorBanner}>
              <Text accessibilityRole="alert" style={styles.errorText}>
                Could not refresh your history.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Try refreshing history again"
                style={styles.retry}
                onPress={() => void history.refresh()}
              >
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          ) : null
        }
        ListEmptyComponent={
          // Not while more pages may still hold finished sessions: a page of
          // hidden rows is not "no history".
          !error && !loading && !hasMore ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No completed workouts yet</Text>
              <Text style={styles.emptyText}>Finish a workout and it will show up here.</Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          <View style={styles.footer}>
            {error === "more" ? (
              <>
                <Text accessibilityRole="alert" style={styles.errorText}>
                  Could not load older workouts.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Try loading older workouts again"
                  style={styles.retry}
                  onPress={() => void history.loadMore(true)}
                >
                  <Text style={styles.retryText}>Try again</Text>
                </Pressable>
              </>
            ) : loadingMore ? (
              <ActivityIndicator color={light.textSecondary} accessibilityLabel="Loading older workouts" />
            ) : !error && !loading && hasMore ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Load older workouts"
                style={styles.retry}
                onPress={() => void history.loadMore()}
              >
                <Text style={styles.retryText}>Load older workouts</Text>
              </Pressable>
            ) : !error && !loading && visibleCount > 0 ? (
              <Text style={styles.caption}>All workouts loaded</Text>
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) => <Text style={styles.dayHeader}>{section.title}</Text>}
        renderItem={({ item, index, section }) => {
          const meta = cardMetaFor(item);
          const title = item.title ?? "Workout";
          const first = index === 0;
          const last = index === section.data.length - 1;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${title}, ${meta.text}, ${item.total_sets} sets`}
              style={({ pressed }) => [
                styles.workoutRow,
                first && styles.rowFirst,
                last ? styles.rowLast : styles.rowDivider,
                pressed && styles.rowPressed,
              ]}
              onPress={() => open(item.id)}
            >
              <View style={styles.workoutMain}>
                <Text numberOfLines={2} style={styles.workoutTitle}>
                  {title}
                </Text>
                <View style={styles.workoutMetaRow}>
                  <Ionicons name={meta.icon} size={14} color={light.textSecondary} />
                  <Text style={styles.workoutMetaText}>{meta.text}</Text>
                </View>
              </View>
              <View style={styles.workoutStats}>
                {/* Sets as the API counts them, not tonnage: tonnage is
                    dominated by whichever muscles happen to move the most
                    weight, so a leg day always dwarfs an arm day regardless
                    of how good either was. */}
                <Text style={styles.workoutSets}>{item.total_sets}</Text>
                <Text style={styles.caption}>sets</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={light.textSecondary} />
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background },
  list: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },

  caption: { color: light.textSecondary, fontSize: 13 },
  dayHeader: {
    color: light.textSecondary,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 18,
    marginBottom: 6,
    marginLeft: 4,
  },
  // One day's workouts form a single grouped surface: the first row rounds the
  // top, the last the bottom, and a hairline separates the rows between.
  workoutRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: light.surface,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  rowFirst: { borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  rowLast: { borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
  rowDivider: { borderBottomColor: light.separator, borderBottomWidth: StyleSheet.hairlineWidth },
  rowPressed: { backgroundColor: light.pressed },
  workoutMain: { flex: 1 },
  workoutTitle: { color: light.text, fontSize: 16, fontWeight: "600" },
  workoutMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  workoutMetaText: { flexShrink: 1, color: light.textSecondary, fontSize: 13 },
  workoutStats: { alignItems: "flex-end" },
  workoutSets: { color: light.text, fontSize: 20, fontWeight: "600" },

  empty: { alignItems: "center", gap: 4, paddingVertical: 32, paddingHorizontal: 16 },
  emptyTitle: { color: light.text, fontSize: 17, fontWeight: "600", textAlign: "center" },
  emptyText: { color: light.textSecondary, fontSize: 14, textAlign: "center" },

  errorBanner: {
    alignItems: "flex-start",
    gap: 4,
    marginTop: 8,
    backgroundColor: light.surface,
    borderRadius: 12,
    padding: 14,
  },
  errorText: { color: light.danger, fontSize: 14 },
  footer: { alignItems: "center", paddingVertical: 24, gap: 8 },
  retry: {
    minHeight: MIN_TOUCH,
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: light.surface,
  },
  retryText: { color: light.text, fontSize: 15, fontWeight: "600" },
});
