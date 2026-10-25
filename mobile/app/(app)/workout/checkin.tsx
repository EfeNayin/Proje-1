/**
 * Readiness check-in: shown before a workout starts, skippable at every step.
 *
 * Deliberately does not block starting the workout on anything: a failed
 * save here, a failed muscle-group fetch, or the user tapping Skip all lead
 * to the same place — the workout screen. The check-in is a bonus signal for
 * the diagnostic screen later, never a gate in front of training.
 */

import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import * as exercisesApi from "../../../src/api/exercises";
import type { MuscleGroupSummary } from "../../../src/api/exercises";
import * as programsApi from "../../../src/api/programs";
import * as readinessApi from "../../../src/api/readiness";
import * as workoutsApi from "../../../src/api/workouts";
import { light } from "../../../src/lightTheme";
import { setActiveWorkout } from "../../../src/workout/activeWorkout";

function RatingRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <View style={styles.ratingRow}>
      <Text style={styles.ratingLabel}>{label}</Text>
      <View style={styles.ratingOptions}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            accessibilityRole="button"
            accessibilityLabel={`${label}, ${n} of 5`}
            accessibilityState={{ selected: value === n }}
            style={[styles.ratingDot, value === n && styles.ratingDotActive]}
            // Tapping the already-selected value clears it: every field here
            // is optional, so there must be a way back to "unanswered".
            onPress={() => onChange(value === n ? null : n)}
          >
            <Text style={[styles.ratingDotText, value === n && styles.ratingDotTextActive]}>
              {n}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function SorenessSection({
  muscles,
  soreness,
  onChangeMuscle,
}: {
  muscles: MuscleGroupSummary[];
  soreness: Record<string, number>;
  onChangeMuscle: (name: string, value: number | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const answeredCount = Object.keys(soreness).length;

  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        style={styles.sectionHeader}
        onPress={() => setExpanded((value) => !value)}
      >
        <Text style={styles.sectionTitle}>
          Soreness{answeredCount > 0 ? ` (${answeredCount})` : ""}
        </Text>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={18}
          color={light.textSecondary}
        />
      </Pressable>

      {expanded &&
        muscles.map((muscle) => (
          <RatingRow
            key={muscle.name}
            label={muscle.name_tr}
            value={soreness[muscle.name] ?? null}
            onChange={(value) => onChangeMuscle(muscle.name, value)}
          />
        ))}
    </View>
  );
}

function parseSleepHours(raw: string): number | null {
  if (raw.trim() === "") return null;
  const parsed = Number(raw.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 24 ? parsed : null;
}

export default function ReadinessCheckin() {
  const router = useRouter();
  const { templateId } = useLocalSearchParams<{ templateId?: string }>();

  const [sleepHours, setSleepHours] = useState("");
  const [energy, setEnergy] = useState<number | null>(null);
  const [soreness, setSoreness] = useState<Record<string, number>>({});
  const [muscles, setMuscles] = useState<MuscleGroupSummary[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    exercisesApi
      .listMuscleGroups()
      .then((list) => {
        if (!cancelled) setMuscles(list);
      })
      .catch(() => {
        // Soreness becomes unavailable rather than blocking the rest of the
        // check-in; sleep and energy do not depend on this list.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChangeMuscle = (name: string, value: number | null) => {
    setSoreness((current) => {
      if (value === null) {
        const { [name]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [name]: value };
    });
  };

  const startWorkoutAndLeave = async () => {
    const workoutId = templateId
      ? (await programsApi.startWorkoutFromTemplate(templateId)).workout_id
      : (await workoutsApi.startWorkout()).id;
    await setActiveWorkout(workoutId);
    router.replace(`/workout/${workoutId}`);
  };

  const handleSkip = async () => {
    setSubmitting(true);
    try {
      await startWorkoutAndLeave();
    } catch {
      setError("Could not start the workout. Try again.");
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await readinessApi.upsertTodayReadiness({
        sleep_hours: parseSleepHours(sleepHours),
        energy,
        soreness: Object.keys(soreness).length > 0 ? soreness : null,
      });
    } catch {
      // Best-effort: a failed save should not stand between the user and
      // the workout they came here to start.
    }

    try {
      await startWorkoutAndLeave();
    } catch {
      setError("Could not start the workout. Try again.");
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>How are you feeling today?</Text>
        <Pressable
          accessibilityRole="button"
          style={styles.skipButton}
          onPress={() => void handleSkip()}
          disabled={submitting}
        >
          <Text style={styles.skip}>Skip</Text>
        </Pressable>
      </View>

      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Sleep (hours)</Text>
        <TextInput
          style={styles.sleepInput}
          accessibilityLabel="Sleep in hours"
          value={sleepHours}
          onChangeText={setSleepHours}
          placeholder="7.5"
          placeholderTextColor={light.textSecondary}
          keyboardType="decimal-pad"
          returnKeyType="done"
        />
      </View>

      <RatingRow label="Energy" value={energy} onChange={setEnergy} />

      {muscles.length > 0 ? (
        <SorenessSection
          muscles={muscles}
          soreness={soreness}
          onChangeMuscle={handleChangeMuscle}
        />
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy: submitting, disabled: submitting }}
        style={({ pressed }) => [
          styles.submit,
          pressed && styles.submitPressed,
          submitting && styles.submitDisabled,
        ]}
        onPress={() => void handleSubmit()}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color={light.onPrimary} />
        ) : (
          <Text style={styles.submitText}>Continue to workout</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background },
  content: { padding: 16, paddingBottom: 32 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  title: { color: light.text, fontSize: 22, fontWeight: "700", lineHeight: 28, flex: 1, marginRight: 16 },
  skipButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  skip: { color: light.text, fontSize: 15, fontWeight: "600", textDecorationLine: "underline" },
  error: { color: light.danger, fontSize: 14, lineHeight: 20, marginBottom: 16 },

  field: { marginBottom: 24 },
  fieldLabel: { color: light.textSecondary, fontSize: 13, fontWeight: "600", marginBottom: 6 },
  sleepInput: {
    minHeight: 52,
    backgroundColor: light.surface,
    borderColor: light.separator,
    borderWidth: 1,
    borderRadius: 12,
    color: light.text,
    fontSize: 17,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },

  // The label sits above its five choices so long muscle names and larger
  // text wrap instead of squeezing the buttons.
  ratingRow: { marginBottom: 20 },
  ratingLabel: { color: light.text, fontSize: 15, lineHeight: 20, marginBottom: 8 },
  ratingOptions: { flexDirection: "row", gap: 8 },
  ratingDot: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: light.surface,
    borderColor: light.separator,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  ratingDotActive: { backgroundColor: light.primary, borderColor: light.primary },
  ratingDotText: { color: light.text, fontSize: 15, fontWeight: "600" },
  ratingDotTextActive: { color: light.onPrimary },

  section: {
    backgroundColor: light.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  sectionHeader: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: { color: light.text, fontSize: 16, fontWeight: "600" },

  submit: {
    minHeight: 52,
    backgroundColor: light.primary,
    borderRadius: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  submitPressed: { backgroundColor: light.primaryPressed },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: light.onPrimary, fontSize: 16, fontWeight: "600" },
});
