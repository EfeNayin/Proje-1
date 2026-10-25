/**
 * One completed workout of a connected athlete, read-only: date, the duration
 * the athlete's own history would show, and every exercise with its sets.
 *
 * There is nothing to edit here and no way into the athlete's own workout
 * screen: the data comes from a coach-only endpoint that returns just these
 * fields, and the backend re-checks the connection and the athlete's sharing
 * switch on every load.
 */

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { AthleteExercise, AthleteSet } from "../../../../../../src/api/coaching";
import {
  durationText,
  formatSessionDate,
  rirText,
  setBadgeText,
  setCountText,
  setWeightText,
} from "../../../../../../src/coaching/athleteWorkoutDisplay";
import { CoachFeedbackSection } from "../../../../../../src/coaching/CoachFeedbackSection";
import { AthleteExerciseHistoryPanel } from "../../../../../../src/coaching/AthleteExerciseHistoryPanel";
import { athleteExerciseHistoryStore } from "../../../../../../src/coaching/athleteExerciseHistorySession";
import { athleteWorkoutsStore } from "../../../../../../src/coaching/athleteWorkoutsSession";
import { personName } from "../../../../../../src/coaching/presentation";
import { useAthleteExerciseHistory } from "../../../../../../src/coaching/useAthleteExerciseHistory";
import { useAthleteWorkouts } from "../../../../../../src/coaching/useAthleteWorkouts";
import { useCoaching } from "../../../../../../src/coaching/useCoaching";
import { useWorkoutFeedback } from "../../../../../../src/coaching/useWorkoutFeedback";
import { workoutFeedbackStore } from "../../../../../../src/coaching/workoutFeedbackSession";
import { useAuth } from "../../../../../../src/auth/AuthContext";
import { FocusedDarkStatusBar } from "../../../../../../src/FocusedDarkStatusBar";
import { light } from "../../../../../../src/lightTheme";
import type { WeightUnit } from "../../../../../../src/units/weight";

const MIN_TOUCH = 44;

export default function AthleteWorkoutScreen() {
  const { linkId, workoutId } = useLocalSearchParams<{ linkId: string; workoutId: string }>();
  const { user } = useAuth();
  return (
    <AthleteWorkout
      key={`${user?.id ?? "signed-out"}:${linkId}:${workoutId}`}
      userId={user?.id ?? null}
      linkId={linkId}
      workoutId={workoutId}
      unit={user?.weight_unit ?? "kg"}
    />
  );
}

function AthleteWorkout({
  userId,
  linkId,
  workoutId,
  unit,
}: {
  userId: string | null;
  linkId: string;
  workoutId: string;
  unit: WeightUnit;
}) {
  const insets = useSafeAreaInsets();
  const view = useAthleteWorkouts(userId, linkId);
  const history = useAthleteExerciseHistory(userId, linkId, workoutId);
  const feedback = useWorkoutFeedback(userId, linkId, workoutId);
  const coaching = useCoaching(userId);
  const athlete = coaching.athletes.items.find((item) => item.id === linkId);
  const { detail, denied } = view;
  const shown = detail.workoutId === workoutId ? detail : null;
  const data = shown?.data ?? null;

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      athleteWorkoutsStore.bind({ userId, linkId });
      void athleteWorkoutsStore.loadDetail(workoutId);
      // Re-reads on every focus unless a draft is open; a draft survives leaving and returning.
      void workoutFeedbackStore.open({ userId, linkId, workoutId });
      return () => {
        // Leaving the workout takes the athlete's earlier sessions with it.
        athleteExerciseHistoryStore.close();
        athleteWorkoutsStore.closeDetail();
      };
    }, [userId, linkId, workoutId]),
  );

  const padding = { paddingBottom: insets.bottom + 24 };

  if (denied) {
    return (
      <View style={[styles.screen, styles.content, padding]}>
        <FocusedDarkStatusBar />
        <Text accessibilityRole="alert" style={styles.empty}>
          {denied === "ended"
            ? "This connection has ended, so this workout is no longer available."
            : "This athlete is no longer sharing workouts with you."}
        </Text>
      </View>
    );
  }
  if (shown?.missing) {
    return (
      <View style={[styles.screen, styles.content, padding]}>
        <FocusedDarkStatusBar />
        <Text accessibilityRole="alert" style={styles.empty}>
          This workout is no longer available.
        </Text>
      </View>
    );
  }
  if (!data) {
    return (
      <View style={[styles.screen, styles.content, padding]}>
        <FocusedDarkStatusBar />
        {shown?.error ? (
          <View style={styles.banner}>
            <Text accessibilityRole="alert" style={styles.error}>
              {shown.error}
            </Text>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
              onPress={() => void athleteWorkoutsStore.loadDetail(workoutId)}
            >
              <Text style={styles.secondaryText}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <ActivityIndicator color={light.textSecondary} accessibilityLabel="Loading workout" />
        )}
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, padding]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >
      <FocusedDarkStatusBar />
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.title}>
          {data.title ?? "Workout"}
        </Text>
        <Text style={styles.meta}>{formatSessionDate(data.performed_at)}</Text>
        <Text style={styles.meta}>{durationText(data)}</Text>
        <Text style={styles.meta}>{setCountText(data.total_sets)}</Text>
        <View style={styles.readOnlyRow}>
          <Ionicons name="lock-closed-outline" size={14} color={light.textSecondary} />
          <Text style={styles.readOnly}>Read-only. Weights shown in {unit}.</Text>
        </View>
      </View>
      {shown?.error ? (
        <View style={styles.banner}>
          <Text accessibilityRole="alert" style={styles.error}>
            Could not refresh. {shown.error}
          </Text>
        </View>
      ) : null}
      {data.exercises.length === 0 ? (
        <Text style={styles.empty}>No sets were recorded in this workout.</Text>
      ) : (
        data.exercises.map((exercise) => (
          <ExerciseBlock
            key={exercise.exercise_id}
            exercise={exercise}
            unit={unit}
            onOpenHistory={() => {
              if (userId) {
                void athleteExerciseHistoryStore.open({
                  userId,
                  linkId,
                  workoutId,
                  exerciseId: exercise.exercise_id,
                });
              }
            }}
          />
        ))
      )}
      <CoachFeedbackSection
        state={feedback}
        athleteName={athlete ? personName(athlete.person) : "This athlete"}
      />
      <AthleteExerciseHistoryPanel
        state={history}
        exerciseName={
          data.exercises.find((item) => item.exercise_id === history.context?.exerciseId)?.name ??
          "Exercise"
        }
        athleteName={athlete ? personName(athlete.person) : "This athlete"}
        unit={unit}
      />
    </ScrollView>
  );
}

function ExerciseBlock({
  exercise,
  unit,
  onOpenHistory,
}: {
  exercise: AthleteExercise;
  unit: WeightUnit;
  onOpenHistory: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" numberOfLines={3} style={styles.exerciseName}>
        {exercise.name}
      </Text>
      {exercise.sets.map((set, index) => (
        <SetRow key={`${set.set_number}-${index}`} set={set} unit={unit} />
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Earlier sessions of ${exercise.name}`}
        accessibilityHint="Opens this athlete's earlier completed sessions of the exercise, read-only"
        style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
        onPress={onOpenHistory}
      >
        <Text style={styles.secondaryText}>Earlier sessions</Text>
      </Pressable>
    </View>
  );
}

function SetRow({ set, unit }: { set: AthleteSet; unit: WeightUnit }) {
  const weight = setWeightText(set, unit);
  const rir = rirText(set.rir);
  return (
    <View
      accessible
      accessibilityLabel={`${set.is_warmup ? "Warm-up set" : `Set ${set.set_number}`}, ${weight}, ${set.reps} reps, ${rir}`}
      style={styles.setRow}
    >
      <View style={[styles.badge, set.is_warmup && styles.warmupBadge]}>
        <Text style={[styles.badgeText, set.is_warmup && styles.warmupText]}>
          {setBadgeText(set)}
        </Text>
      </View>
      <Text style={styles.setWeight}>{weight}</Text>
      <Text style={styles.setReps}>× {set.reps}</Text>
      <Text style={[styles.setRir, set.rir == null && styles.rirUnknown]}>{rir}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background },
  content: { paddingHorizontal: 16, paddingTop: 8 },
  card: {
    backgroundColor: light.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    gap: 6,
  },
  title: { color: light.text, fontSize: 22, fontWeight: "700", lineHeight: 28 },
  exerciseName: { color: light.text, fontSize: 17, fontWeight: "600", lineHeight: 22 },
  meta: { color: light.textSecondary, fontSize: 13, lineHeight: 19 },
  readOnlyRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  readOnly: { flex: 1, color: light.textSecondary, fontSize: 13, fontWeight: "500", lineHeight: 18 },
  error: { color: light.danger, fontSize: 14, lineHeight: 20 },
  banner: {
    backgroundColor: light.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    gap: 8,
  },
  empty: {
    color: light.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    paddingVertical: 16,
  },
  // Fixed columns so weight, reps and RIR line up from set to set.
  setRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 40 },
  badge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: light.background,
    alignItems: "center",
    justifyContent: "center",
  },
  // A warm-up is marked by its "W" and a ring, so it is not told apart by colour alone.
  warmupBadge: { backgroundColor: light.surface, borderColor: light.textSecondary, borderWidth: 1.5 },
  badgeText: { color: light.text, fontSize: 12, fontWeight: "600" },
  warmupText: { color: light.textSecondary },
  setWeight: { color: light.text, fontSize: 16, fontWeight: "600", minWidth: 84, fontVariant: ["tabular-nums"] },
  setReps: { color: light.text, fontSize: 16, minWidth: 44, fontVariant: ["tabular-nums"] },
  setRir: { flex: 1, color: light.text, fontSize: 14, textAlign: "right" },
  rirUnknown: { color: light.textSecondary },
  secondary: {
    minHeight: MIN_TOUCH,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  secondaryText: { color: light.text, fontSize: 15, fontWeight: "600", textDecorationLine: "underline" },
  pressed: { backgroundColor: light.pressed },
});
