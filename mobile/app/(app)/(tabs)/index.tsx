/**
 * Training home: resume or start a session, and browse past ones.
 */

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import * as programsApi from "../../../src/api/programs";
import type { WorkoutTemplate } from "../../../src/api/programs";
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
  const [activeTemplates, setActiveTemplates] = useState<WorkoutTemplate[]>([]);
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

    // The active program's templates offer a quick way to start a planned
    // session. Isolated in its own try/catch: a programs-API hiccup must not
    // take down the workout history this screen exists to show.
    try {
      const programs = await programsApi.listPrograms();
      const active = programs.find((program) => program.is_active);
      setActiveTemplates(active ? (await programsApi.getProgram(active.id)).templates : []);
    } catch {
      setActiveTemplates([]);
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

              {activeTemplates.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.templateRow}
                  contentContainerStyle={styles.templateRowContent}
                >
                  {activeTemplates.map((template) => (
                    <Pressable
                      key={template.id}
                      style={styles.templateChip}
                      onPress={() => void handleStart(template.id)}
                      disabled={starting}
                    >
                      <Text style={styles.templateChipText}>{template.name}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
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
  templateRow: { marginTop: spacing.sm },
  templateRowContent: { gap: spacing.sm },
  templateChip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  templateChipText: { color: colors.text, fontSize: 14, fontWeight: "600" },
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