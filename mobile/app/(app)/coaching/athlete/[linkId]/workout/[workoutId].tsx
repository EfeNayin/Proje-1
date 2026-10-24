/**
 * One completed workout of a connected athlete, read-only: date, the duration
 * the athlete's own history would show, and every exercise with its sets.
 *
 * There is nothing to edit here and no way into the athlete's own workout
 * screen: the data comes from a coach-only endpoint that returns just these
 * fields, and the backend re-checks the connection and the athlete's sharing
 * switch on every load.
 */

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
import { athleteWorkoutsStore } from "../../../../../../src/coaching/athleteWorkoutsSession";
import { useAthleteWorkouts } from "../../../../../../src/coaching/useAthleteWorkouts";
import { useAuth } from "../../../../../../src/auth/AuthContext";
import { roman, romanFont, useRomanFonts } from "../../../../../../src/romanTheme";
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
  useRomanFonts();
  const view = useAthleteWorkouts(userId, linkId);
  const { detail, denied } = view;
  const shown = detail.workoutId === workoutId ? detail : null;
  const data = shown?.data ?? null;

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      athleteWorkoutsStore.bind({ userId, linkId });
      void athleteWorkoutsStore.loadDetail(workoutId);
      return () => athleteWorkoutsStore.closeDetail();
    }, [userId, linkId, workoutId]),
  );

  const padding = { paddingBottom: insets.bottom + 24 };

  if (denied) {
    return (
      <View style={[styles.screen, styles.content, padding]}>
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
        <Text accessibilityRole="alert" style={styles.empty}>
          This workout is no longer available.
        </Text>
      </View>
    );
  }
  if (!data) {
    return (
      <View style={[styles.screen, styles.content, padding]}>
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
          <ActivityIndicator color={roman.gold} accessibilityLabel="Loading workout" />
        )}
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, padding]}>
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.title}>
          {data.title ?? "Workout"}
        </Text>
        <Text style={styles.meta}>{formatSessionDate(data.performed_at)}</Text>
        <Text style={styles.meta}>{durationText(data)}</Text>
        <Text style={styles.meta}>{setCountText(data.total_sets)}</Text>
        <Text style={styles.readOnly}>Read-only. Weights shown in {unit}.</Text>
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
          <ExerciseBlock key={exercise.exercise_id} exercise={exercise} unit={unit} />
        ))
      )}
    </ScrollView>
  );
}

function ExerciseBlock({ exercise, unit }: { exercise: AthleteExercise; unit: WeightUnit }) {
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.exerciseName}>
        {exercise.name}
      </Text>
      {exercise.sets.map((set, index) => (
        <SetRow key={`${set.set_number}-${index}`} set={set} unit={unit} />
      ))}
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
  screen: { flex: 1, backgroundColor: roman.background },
  content: { paddingHorizontal: 16, paddingTop: 8 },
  card: {
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    gap: 6,
  },
  title: { color: roman.text, fontFamily: romanFont.semibold, fontSize: 20, lineHeight: 26 },
  exerciseName: { color: roman.text, fontFamily: romanFont.semibold, fontSize: 16, lineHeight: 22 },
  meta: { color: roman.textMuted, fontFamily: romanFont.regular, fontSize: 13, lineHeight: 19 },
  readOnly: { color: roman.goldLight, fontFamily: romanFont.medium, fontSize: 12, marginTop: 4 },
  error: { color: roman.danger, fontFamily: romanFont.medium, fontSize: 14, lineHeight: 20 },
  banner: {
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    gap: 8,
  },
  empty: {
    color: roman.textMuted,
    fontFamily: romanFont.regular,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    paddingVertical: 16,
  },
  setRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 36 },
  badge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderColor: roman.border,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  warmupBadge: { borderColor: roman.goldLight },
  badgeText: { color: roman.text, fontFamily: romanFont.semibold, fontSize: 12 },
  warmupText: { color: roman.goldLight },
  setWeight: { color: roman.text, fontFamily: romanFont.semibold, fontSize: 15, minWidth: 84 },
  setReps: { color: roman.text, fontFamily: romanFont.regular, fontSize: 15 },
  setRir: { flex: 1, color: roman.goldLight, fontFamily: romanFont.regular, fontSize: 13, textAlign: "right" },
  rirUnknown: { color: roman.textMuted },
  secondary: {
    minHeight: MIN_TOUCH,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  secondaryText: { color: roman.goldLight, fontFamily: romanFont.semibold, fontSize: 14 },
  pressed: { backgroundColor: roman.surfaceRaised },
});
