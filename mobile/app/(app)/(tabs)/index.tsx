/**
 * Training home: resume or start a session, and browse past ones.
 */

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState, useSyncExternalStore } from "react";
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

import * as programsApi from "../../../src/api/programs";
import type { ProgramDetail } from "../../../src/api/programs";
import * as readinessApi from "../../../src/api/readiness";
import * as workoutsApi from "../../../src/api/workouts";
import type { WorkoutSummary } from "../../../src/api/workouts";
import { colors, radius, spacing } from "../../../src/theme";
import { clearActiveWorkout, getActiveWorkout, setActiveWorkout } from "../../../src/workout/activeWorkout";
import { isReadinessCheckinEnabled } from "../../../src/workout/readinessPreference";
import { resolveActiveWorkoutId } from "../../../src/workout/resolveActiveWorkout";
import { createWorkoutHistory } from "../../../src/workout/workoutHistory";

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
  const [history] = useState(() => createWorkoutHistory(workoutsApi.listWorkouts));
  const { items: workouts, loading, loadingMore, hasMore, error } = useSyncExternalStore(
    history.subscribe, history.getSnapshot,
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeProgram, setActiveProgram] = useState<ProgramDetail | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [starting, setStarting] = useState(false);

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
      setStarting(false);
    }
  };

  if (loading && workouts.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const sections = groupByDay(workouts);

  return (
    <>
      <SectionList
        style={styles.screen}
        contentContainerStyle={styles.content}
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        onEndReached={() => { void history.loadMore(); }}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={handleRefresh} tintColor={colors.accent} />
        }
        ListHeaderComponent={
          <View>
            {activeId ? (
              <Pressable style={styles.resume} onPress={() => router.push(`/workout/${activeId}`)}>
                <View style={styles.resumeText}>
                  <Text style={styles.resumeTitle}>Workout in progress</Text>
                  <Text style={styles.resumeSubtitle}>Tap to continue</Text>
                </View>
                <Ionicons name="chevron-forward" size={22} color={colors.accentText} />
              </Pressable>
            ) : (
              <>
                <Pressable style={styles.start} onPress={() => void handleStart()} disabled={starting}>
                  {starting ? (
                    <ActivityIndicator color={colors.accentText} />
                  ) : (
                    <Text style={styles.startText}>Start workout</Text>
                  )}
                </Pressable>

                {activeProgram ? (
                  <Pressable
                    style={styles.programChip}
                    onPress={() => setSheetVisible(true)}
                    disabled={starting}
                  >
                    <Ionicons name="clipboard-outline" size={16} color={colors.text} />
                    <Text style={styles.programChipText}>{activeProgram.name}</Text>
                    <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
                  </Pressable>
                ) : null}
              </>
            )}

            <Text style={styles.sectionTitle}>History</Text>
          </View>
        }
        ListEmptyComponent={
          !error ? <Text style={styles.empty}>No workouts yet. Start one and it will show up here.</Text> : null
        }
        ListFooterComponent={
          <View style={styles.historyFooter}>
            {error ? (
              <>
                <Text style={styles.historyError}>
                  {error === "more" ? "Could not load older workouts." : "Could not refresh your history."}
                </Text>
                <Pressable accessibilityRole="button" style={styles.historyRetry}
                  onPress={() => { if (error === "refresh") handleRefresh(); else void history.loadMore(true); }}>
                  <Text style={styles.historyRetryText}>Try again</Text>
                </Pressable>
              </>
            ) : loadingMore ? (
              <ActivityIndicator color={colors.accent} />
            ) : !loading && hasMore ? (
              <Pressable accessibilityRole="button" style={styles.historyRetry}
                onPress={() => { void history.loadMore(); }}>
                <Text style={styles.historyRetryText}>Load older workouts</Text>
              </Pressable>
            ) : !loading && workouts.length > 0 ? (
              <Text style={styles.cardMeta}>All workouts loaded</Text>
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text style={styles.dayHeader}>{section.title}</Text>
        )}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => router.push(`/workout/${item.id}`)}>
            <View style={styles.cardMain}>
              <Text style={styles.cardTitle}>{item.title ?? "Workout"}</Text>
              {/* The day is already the section header above; each row adds
                  what the header can't — its duration once finished, or its
                  start time while it's the one still in progress. */}
              <Text style={styles.cardMeta}>
                {item.finished_at
                  ? item.finished_automatically === false
                    ? formatCardDuration(item.performed_at, item.finished_at)
                    : item.finished_automatically ? "Auto-closed · duration unknown" : "Duration unavailable"
                  : formatTimeOfDay(item.performed_at)}
              </Text>
            </View>
            <View style={styles.cardStats}>
              {/* Working sets, not tonnage: tonnage is dominated by whichever
                  muscles happen to move the most weight, so a leg day always
                  dwarfs an arm day regardless of how good either was. */}
              <Text style={styles.cardSets}>{item.total_sets}</Text>
              <Text style={styles.cardMeta}>sets</Text>
            </View>
          </Pressable>
        )}
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
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>{activeProgram?.name}</Text>
            {activeProgram?.templates.map((template) => (
              <Pressable
                key={template.id}
                style={styles.sheetRow}
                onPress={() => {
                  setSheetVisible(false);
                  void handleStart(template.id);
                }}
              >
                <Text style={styles.sheetRowText}>{template.name}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </Pressable>
            ))}
            {activeProgram?.templates.length === 0 ? (
              <Text style={styles.sheetEmpty}>No templates in this program yet.</Text>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  historyFooter: { alignItems: "center", paddingVertical: spacing.lg, gap: spacing.sm },
  historyError: { color: colors.danger, textAlign: "center" },
  historyRetry: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface },
  historyRetryText: { color: colors.accent, fontWeight: "600" },
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  start: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
  },
  startText: { color: colors.accentText, fontSize: 17, fontWeight: "700" },
  programChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing.xs,
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  programChipText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  sheetBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  sheetTitle: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.md,
  },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetRowText: { color: colors.text, fontSize: 16, fontWeight: "600" },
  sheetEmpty: { color: colors.textMuted, paddingVertical: spacing.md },
  resume: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  resumeText: { flex: 1 },
  resumeTitle: { color: colors.accentText, fontSize: 17, fontWeight: "700" },
  resumeSubtitle: { color: colors.accentText, opacity: 0.75, fontSize: 13 },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  empty: { color: colors.textMuted, textAlign: "center", marginTop: spacing.lg },
  dayHeader: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
  },
  cardMain: { flex: 1 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
  cardMeta: { color: colors.textMuted, fontSize: 13 },
  cardStats: { alignItems: "flex-end" },
  cardSets: { color: colors.accent, fontSize: 20, fontWeight: "700" },
});
