/**
 * Training home: resume or start a session, and browse past ones.
 */

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export default function TrainingHome() {
  const router = useRouter();
  const [workouts, setWorkouts] = useState<WorkoutSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeProgram, setActiveProgram] = useState<ProgramDetail | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    const stored = await getActiveWorkout();

    // The stored id could point at a workout deleted from another device, so
    // confirm it still exists rather than routing into a dead screen.
    if (stored) {
      try {
        await workoutsApi.getWorkout(stored);
        setActiveId(stored);
      } catch {
        await clearActiveWorkout();
        setActiveId(null);
      }
    } else {
      setActiveId(null);
    }

    const list = await workoutsApi.listWorkouts();
    setWorkouts(list.items);

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
      let cancelled = false;
      setLoading(true);
      load()
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [load]),
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await load().catch(() => undefined);
    setRefreshing(false);
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

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <>
      <FlatList
        style={styles.screen}
        contentContainerStyle={styles.content}
        data={workouts}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} />
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
          <Text style={styles.empty}>No workouts yet. Start one and it will show up here.</Text>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => router.push(`/workout/${item.id}`)}>
            <View style={styles.cardMain}>
              <Text style={styles.cardTitle}>{item.title ?? "Workout"}</Text>
              <Text style={styles.cardMeta}>{formatDate(item.performed_at)}</Text>
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