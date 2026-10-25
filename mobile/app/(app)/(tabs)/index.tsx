/**
 * Training home: resume or start a session, and browse past ones.
 */

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useIsFocused, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as programsApi from "../../../src/api/programs";
import type { ProgramDetail } from "../../../src/api/programs";
import * as readinessApi from "../../../src/api/readiness";
import * as workoutsApi from "../../../src/api/workouts";
import type { WorkoutSummary } from "../../../src/api/workouts";
import { light } from "../../../src/lightTheme";
import { clearActiveWorkout, getActiveWorkout, setActiveWorkout } from "../../../src/workout/activeWorkout";
import { isReadinessCheckinEnabled } from "../../../src/workout/readinessPreference";
import { resolveActiveWorkoutId } from "../../../src/workout/resolveActiveWorkout";
import { createWorkoutHistory } from "../../../src/workout/workoutHistory";

const MIN_TOUCH = 44;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * "Today" / "Yesterday" / a full date — grouping is by the device's LOCAL
 * calendar day, same reasoning as the server's per-user-timezone weekly
 * volume cutoff: a workout performed_at close to midnight UTC must land in
 * the day it actually happened in for the person doing it, not in UTC's.
 */
function sectionTitleFor(performedAt: string): string {
  const day = new Date(performedAt);
  const today = new Date();
  if (isSameLocalDay(day, today)) return "Today";

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (isSameLocalDay(day, yesterday)) return "Yesterday";

  return formatDate(performedAt);
}

/** For a session still in progress, shown instead of a duration it doesn't have yet. */
function formatTimeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Fixed session length, for a finished workout only — nothing to show for one still in progress. */
function formatCardDuration(performedAt: string, finishedAt: string): string {
  const seconds = Math.max(
    0,
    Math.floor((new Date(finishedAt).getTime() - new Date(performedAt).getTime()) / 1000),
  );
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * The line under a card's title. The day is already the section header above;
 * each row adds what the header can't — its duration once finished, or its
 * start time while it's the one still in progress.
 */
function cardMetaFor(item: WorkoutSummary): { icon: "timer-outline" | "time-outline" | "information-circle-outline"; text: string } {
  if (!item.finished_at) return { icon: "time-outline", text: formatTimeOfDay(item.performed_at) };
  if (item.finished_automatically === false) {
    return { icon: "timer-outline", text: formatCardDuration(item.performed_at, item.finished_at) };
  }
  return {
    icon: "information-circle-outline",
    text: item.finished_automatically ? "Auto-closed · duration unknown" : "Duration unavailable",
  };
}

type HistorySection = { title: string; data: WorkoutSummary[] };

/**
 * Workouts already arrive most-recent-first from the server, so grouping is
 * a single linear pass — no re-sorting, no bucketing into a map first.
 */
function groupByDay(workouts: WorkoutSummary[]): HistorySection[] {
  const sections: HistorySection[] = [];
  let currentDay: string | null = null;

  for (const workout of workouts) {
    const day = new Date(workout.performed_at);
    const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
    if (key !== currentDay) {
      sections.push({ title: sectionTitleFor(workout.performed_at), data: [] });
      currentDay = key;
    }
    sections[sections.length - 1].data.push(workout);
  }

  return sections;
}

export default function TrainingHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Only while this tab is focused: the app-wide status bar is light-on-dark, which
  // would be unreadable here, and the other tabs are still dark.
  const focused = useIsFocused();
  const [history] = useState(() => createWorkoutHistory(workoutsApi.listWorkouts));
  const { items: workouts, loading, loadingMore, hasMore, error } = useSyncExternalStore(
    history.subscribe, history.getSnapshot,
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeProgram, setActiveProgram] = useState<ProgramDetail | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [starting, setStarting] = useState(false);
  // State only updates on the next render, so a fast double tap could pass a
  // `starting` check twice. The refs close that gap.
  const startingRef = useRef(false);
  const navigatingRef = useRef(false);

  /** Navigates at most once per visit to this screen: a double tap must not stack two copies. */
  const go = (navigate: () => void) => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    navigate();
  };

  const load = useCallback(async () => {
    // See src/workout/resolveActiveWorkout.ts for what this reconciles and
    // why (Adım 20, PROJE_1_CODEX_INCELEME.md, Bölüm 8 madde H3): the local
    // pointer is a device key, so a stale one — left by a workout finished
    // elsewhere, deleted, or belonging to a different account previously
    // signed in on this device — must not be taken at face value.
    setActiveId(
      await resolveActiveWorkoutId({
        getActiveWorkout,
        setActiveWorkout,
        clearActiveWorkout,
        getWorkout: workoutsApi.getWorkout,
        getServerActiveWorkout: workoutsApi.getActiveWorkout,
      }),
    );

    // The active program offers a quick way to start a planned session.
    // Isolated in its own try/catch: a programs-API hiccup must not take
    // down the workout history this screen exists to show.
    try {
      const programs = await programsApi.listPrograms();
      const active = programs.find((program) => program.is_active);
      setActiveProgram(active ? await programsApi.getProgram(active.id) : null);
    } catch {
      setActiveProgram(null);
    }
  }, []);

  // Re-run on every focus so finishing a workout is reflected on return.
  useFocusEffect(
    useCallback(() => {
      navigatingRef.current = false;
      void history.refresh();
      void load().catch(() => undefined);
      return () => {
        history.cancel();
      };
    }, [history, load]),
  );

  const handleRefresh = () => {
    void history.refresh();
    void load().catch(() => undefined);
  };

  /** templateId omitted starts a free session; given, starts from that template. */
  const handleStart = async (templateId?: string) => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    try {
      let showCheckin = false;
      try {
        if (await isReadinessCheckinEnabled()) {
          const today = await readinessApi.getTodayReadiness();
          showCheckin = today.id === null;
        }
      } catch {
        // Fail open: a flaky check on whether today is already logged must
        // never be the reason a workout cannot be started.
        showCheckin = false;
      }

      if (showCheckin) {
        router.push({
          pathname: "/workout/checkin",
          params: templateId ? { templateId } : {},
        });
        return;
      }

      const workoutId = templateId
        ? (await programsApi.startWorkoutFromTemplate(templateId)).workout_id
        : (await workoutsApi.startWorkout()).id;
      await setActiveWorkout(workoutId);
      router.push(`/workout/${workoutId}`);
    } catch {
      // Errors surface on the workout screen itself; nothing useful to show
      // here beyond letting the user tap again.
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  };

  const topBar = (
    <View style={[styles.topBar, { paddingTop: insets.top }]}>
      <View style={styles.topBarRow}>
        <Text accessibilityRole="header" style={styles.topBarTitle}>
          Training
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open profile"
          hitSlop={4}
          onPress={() => go(() => router.navigate("/profile"))}
          style={({ pressed }) => [styles.profileButton, pressed && styles.profileButtonPressed]}
        >
          <Ionicons name="person-outline" size={20} color={light.text} />
        </Pressable>
      </View>
    </View>
  );

  const statusBar = focused ? <StatusBar style="dark" /> : null;

  if (loading && workouts.length === 0) {
    return (
      <View style={styles.screen}>
        {statusBar}
        {topBar}
        <View style={styles.centered}>
          <ActivityIndicator color={light.textSecondary} accessibilityLabel="Loading workouts" />
        </View>
      </View>
    );
  }

  const sections = groupByDay(workouts);

  return (
    <View style={styles.screen}>
      {statusBar}
      {topBar}
      <SectionList
        style={styles.list}
        contentContainerStyle={styles.content}
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        onEndReached={() => { void history.loadMore(); }}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={handleRefresh}
            tintColor={light.textSecondary}
          />
        }
        ListHeaderComponent={
          <View>
            {activeId ? (
              <View>
                <View style={styles.progressRow}>
                  <View style={styles.progressDot} />
                  <Text style={styles.progressLabel}>Workout in progress</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Resume workout"
                  style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
                  onPress={() => go(() => router.push(`/workout/${activeId}`))}
                >
                  <Ionicons name="play" size={16} color={light.onPrimary} />
                  <Text style={styles.primaryText}>Resume workout</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Start workout"
                  accessibilityState={{ busy: starting, disabled: starting }}
                  style={({ pressed }) => [
                    styles.primary,
                    pressed && styles.primaryPressed,
                    starting && styles.primaryBusy,
                  ]}
                  onPress={() => void handleStart()}
                  disabled={starting}
                >
                  {starting ? (
                    <ActivityIndicator color={light.onPrimary} />
                  ) : (
                    <Text style={styles.primaryText}>Start workout</Text>
                  )}
                </Pressable>

                {activeProgram ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Start from a template in ${activeProgram.name}`}
                    accessibilityHint="Choose a template to start from"
                    accessibilityState={{ disabled: starting }}
                    style={({ pressed }) => [
                      styles.programRow,
                      pressed && styles.rowPressed,
                      starting && styles.primaryBusy,
                    ]}
                    onPress={() => setSheetVisible(true)}
                    disabled={starting}
                  >
                    <View style={styles.programText}>
                      <Text style={styles.caption}>Start from a template</Text>
                      <Text numberOfLines={2} style={styles.programName}>
                        {activeProgram.name}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={light.textSecondary} />
                  </Pressable>
                ) : null}
              </>
            )}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Research, explore training research"
              style={({ pressed }) => [styles.researchRow, pressed && styles.rowPressed]}
              onPress={() => go(() => router.push("/research"))}
            >
              <View style={styles.researchText}>
                <Text style={styles.researchTitle}>Research</Text>
                <Text style={styles.caption}>Explore training research</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={light.textSecondary} />
            </Pressable>

            <Text accessibilityRole="header" style={styles.sectionTitle}>
              Recent workouts
            </Text>

            {error === "refresh" ? (
              <View style={styles.errorBanner}>
                <Text accessibilityRole="alert" style={styles.errorText}>
                  Could not refresh your history.
                </Text>
                <Pressable accessibilityRole="button" style={styles.retry} onPress={handleRefresh}>
                  <Text style={styles.retryText}>Try again</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          !error ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No workouts yet</Text>
              <Text style={styles.emptyText}>Start one and it will show up here.</Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          <View style={styles.historyFooter}>
            {error === "more" ? (
              <>
                <Text style={styles.errorText}>Could not load older workouts.</Text>
                <Pressable accessibilityRole="button" style={styles.retry}
                  onPress={() => { void history.loadMore(true); }}>
                  <Text style={styles.retryText}>Try again</Text>
                </Pressable>
              </>
            ) : loadingMore ? (
              <ActivityIndicator color={light.textSecondary} accessibilityLabel="Loading older workouts" />
            ) : !error && !loading && hasMore ? (
              <Pressable accessibilityRole="button" style={styles.retry}
                onPress={() => { void history.loadMore(); }}>
                <Text style={styles.retryText}>Load older workouts</Text>
              </Pressable>
            ) : !error && !loading && workouts.length > 0 ? (
              <Text style={styles.caption}>All workouts loaded</Text>
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text style={styles.dayHeader}>{section.title}</Text>
        )}
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
              onPress={() => go(() => router.push(`/workout/${item.id}`))}
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

      <Modal
        visible={sheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetVisible(false)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setSheetVisible(false)}>
          {/* A Pressable with its own onPress, even a no-op, is what keeps a
              tap inside the sheet from also being read as a tap on the
              backdrop behind it. */}
          <Pressable
            accessibilityViewIsModal
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}
            onPress={() => {}}
          >
            <Text style={styles.caption}>Start from a template</Text>
            <Text accessibilityRole="header" style={styles.sheetTitle}>
              {activeProgram?.name}
            </Text>
            {activeProgram?.templates.map((template) => (
              <Pressable
                key={template.id}
                accessibilityRole="button"
                style={({ pressed }) => [styles.sheetRow, pressed && styles.sheetRowPressed]}
                onPress={() => {
                  setSheetVisible(false);
                  void handleStart(template.id);
                }}
              >
                <Text style={styles.sheetRowText}>{template.name}</Text>
                <Ionicons name="chevron-forward" size={18} color={light.textSecondary} />
              </Pressable>
            ))}
            {activeProgram?.templates.length === 0 ? (
              <Text style={styles.sheetEmpty}>No templates in this program yet.</Text>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background },
  list: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },

  topBar: { backgroundColor: light.background, paddingHorizontal: 16 },
  topBarRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  topBarTitle: { flexShrink: 1, color: light.text, fontSize: 28, fontWeight: "700" },
  profileButton: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: MIN_TOUCH / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  profileButtonPressed: { backgroundColor: light.pressed },

  primary: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: light.primary,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  primaryPressed: { backgroundColor: light.primaryPressed },
  primaryBusy: { opacity: 0.6 },
  primaryText: { flexShrink: 1, color: light.onPrimary, fontSize: 17, fontWeight: "600" },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  progressDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: light.positive },
  progressLabel: { flexShrink: 1, color: light.positive, fontSize: 13, fontWeight: "600" },

  programRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 10,
    backgroundColor: light.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  programText: { flex: 1, gap: 2 },
  programName: { color: light.text, fontSize: 16, fontWeight: "600" },
  caption: { color: light.textSecondary, fontSize: 13 },

  researchRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 24,
    backgroundColor: light.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  researchText: { flex: 1, gap: 2 },
  researchTitle: { color: light.text, fontSize: 16, fontWeight: "500" },
  rowPressed: { backgroundColor: light.pressed },

  sectionTitle: { color: light.text, fontSize: 20, fontWeight: "700", marginTop: 28, marginBottom: 4 },
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
  workoutMain: { flex: 1 },
  workoutTitle: { color: light.text, fontSize: 16, fontWeight: "600" },
  workoutMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  workoutMetaText: { flexShrink: 1, color: light.textSecondary, fontSize: 13 },
  workoutStats: { alignItems: "flex-end" },
  workoutSets: { color: light.text, fontSize: 20, fontWeight: "600" },

  empty: { alignItems: "center", gap: 4, paddingVertical: 32, paddingHorizontal: 16 },
  emptyTitle: { color: light.text, fontSize: 17, fontWeight: "600" },
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
  historyFooter: { alignItems: "center", paddingVertical: 24, gap: 8 },
  retry: {
    minHeight: MIN_TOUCH,
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: light.surface,
  },
  retryText: { color: light.text, fontSize: 15, fontWeight: "600" },

  sheetBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: light.scrim },
  sheet: {
    backgroundColor: light.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  sheetTitle: { color: light.text, fontSize: 20, fontWeight: "700", marginTop: 2, marginBottom: 8 },
  sheetRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 12,
    borderBottomColor: light.separator,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetRowPressed: { opacity: 0.6 },
  sheetRowText: { flex: 1, color: light.text, fontSize: 16, fontWeight: "500" },
  sheetEmpty: { color: light.textSecondary, paddingVertical: 16 },
});
