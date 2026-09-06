/**
 * Readiness check-in: shown before a workout starts, skippable at every step.
 *
 * Deliberately does not block starting the workout on anything: a failed
 * save here, a failed muscle-group fetch, or the user tapping Skip all lead
 * to the same place — the workout screen. The check-in is a bonus signal for
 * the diagnostic screen later, never a gate in front of training.
 */

import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
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
import * as readinessApi from "../../../src/api/readiness";
import * as workoutsApi from "../../../src/api/workouts";
import { colors, radius, spacing } from "../../../src/theme";
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
            style={[styles.ratingDot, value === n && styles.ratingDotActive]}
            // Tapping the already-selected value clears it: every field here
            // is optional, so there must be a way back to "unanswered".
            onPress={() => onChange(value === n ? null : n)}
            hitSlop={4}
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
      <Pressable style={styles.sectionHeader} onPress={() => setExpanded((value) => !value)}>
        <Text style={styles.sectionTitle}>
          Soreness{answeredCount > 0 ? ` (${answeredCount})` : ""}
        </Text>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={18}
          color={colors.textMuted}
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
    const workout = await workoutsApi.startWorkout();
    await setActiveWorkout(workout.id);
    router.replace(`/workout/${workout.id}`);
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
        <Pressable onPress={() => void handleSkip()} disabled={submitting} hitSlop={8}>
          <Text style={styles.skip}>Skip</Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Sleep (hours)</Text>
        <TextInput
          style={styles.sleepInput}
          value={sleepHours}
          onChangeText={setSleepHours}
          placeholder="7.5"
          placeholderTextColor={colors.textMuted}
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
        style={[styles.submit, submitting && styles.submitDisabled]}
        onPress={() => void handleSubmit()}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color={colors.accentText} />
        ) : (
          <Text style={styles.submitText}>Continue to workout</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  title: { color: colors.text, fontSize: 20, fontWeight: "700", flex: 1, marginRight: spacing.md },
  skip: { color: colors.textMuted, fontSize: 16, fontWeight: "600" },
  error: { color: colors.danger, marginBottom: spacing.md },

  field: { marginBottom: spacing.lg },
  fieldLabel: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.xs },
  sleepInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: 18,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },

  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  ratingLabel: { color: colors.text, fontSize: 15, flex: 1 },
  ratingOptions: { flexDirection: "row", gap: spacing.xs },
  ratingDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderColor: colors.border,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  ratingDotActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  ratingDotText: { color: colors.textMuted, fontSize: 14, fontWeight: "600" },
  ratingDotTextActive: { color: colors.accentText },

  section: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },

  submit: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
  },
  submitDisabled: { opacity: 0.7 },
  submitText: { color: colors.accentText, fontSize: 17, fontWeight: "700" },
});
