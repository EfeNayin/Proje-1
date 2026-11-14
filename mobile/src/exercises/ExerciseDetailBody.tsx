/**
 * An exercise's details: the muscles the movement works, whether each is
 * primary or secondary, and how good the movement is for it (a 1-5 rating, see
 * exerciseDetail.ts).
 *
 * Read-only, and it has no "choose" action on purpose. It is shown by the
 * exercise detail screen and, in place, by the exercise picker's information
 * button; in neither does looking at an exercise select it.
 */

import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import * as exercisesApi from "../api/exercises";
import type { ExerciseDetail } from "../api/exercises";
import { light } from "../lightTheme";
import { describeExercise } from "./exerciseDetail";
import type { MuscleLine } from "./exerciseDetail";

const MIN_TOUCH = 44;

export function ExerciseDetailBody({
  id,
  selecting = false,
  onTitle,
}: {
  id: string | undefined;
  /** Shown inside the picker: the closing note says how to add THIS exercise from here. */
  selecting?: boolean;
  /** Called with the exercise's name once it is known (the detail screen titles its header with it). */
  onTitle?: (title: string) => void;
}) {
  const [exercise, setExercise] = useState<ExerciseDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    exercisesApi
      .getExercise(id)
      .then((detail) => {
        if (!cancelled) {
          setExercise(detail);
          setFailed(false);
          onTitle?.(detail.name);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // onTitle is a setter in practice; re-fetching because its identity changed would be wrong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, attempt]);

  // An answer for a previous id must not be shown for this one.
  const view = exercise && exercise.id === id ? describeExercise(exercise) : null;

  if (view) {
    return (
      <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={styles.title}>
          {view.title}
        </Text>
        {view.summary ? <Text style={styles.summary}>{view.summary}</Text> : null}

        <MuscleSection
          title="Primary muscles"
          note="These count towards your weekly set totals."
          muscles={view.primary}
        />
        <MuscleSection
          title="Secondary muscles"
          note="Helped by this exercise, but not counted as direct sets."
          muscles={view.secondary}
        />

        <Text style={styles.footnote}>
          Effectiveness is a 1–5 rating of how well the movement suits that muscle. It is a judgement, not a
          measurement.{" "}
          {selecting
            ? "To add this exercise, go back to the list and tap its row."
            : "To add this exercise to a workout, use Add exercise while you train."}
        </Text>
      </ScrollView>
    );
  }

  if (failed) {
    return (
      <View style={styles.centered}>
        <Text accessibilityRole="alert" style={styles.errorText}>
          Could not load this exercise.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Try loading the exercise again"
          style={styles.retry}
          onPress={() => {
            setFailed(false);
            setAttempt((value) => value + 1);
          }}
        >
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.centered}>
      <ActivityIndicator color={light.textSecondary} accessibilityLabel="Loading exercise" />
    </View>
  );
}

function MuscleSection({ title, note, muscles }: { title: string; note: string; muscles: MuscleLine[] }) {
  if (muscles.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      <Text style={styles.sectionNote}>{note}</Text>
      <View style={styles.card}>
        {muscles.map((muscle, index) => (
          <View
            key={muscle.name}
            accessible
            accessibilityLabel={muscle.accessibilityLabel}
            style={[styles.muscleRow, index < muscles.length - 1 && styles.rowDivider]}
          >
            <Text style={styles.muscleName}>{muscle.name}</Text>
            <Text style={styles.muscleRating}>{muscle.effectivenessLabel}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 24 },
  title: { color: light.text, fontSize: 24, fontWeight: "700" },
  summary: { color: light.textSecondary, fontSize: 15, marginTop: 4 },
  section: { marginTop: 24 },
  sectionTitle: { color: light.text, fontSize: 18, fontWeight: "700" },
  sectionNote: { color: light.textSecondary, fontSize: 13, marginTop: 2, marginBottom: 8 },
  card: { backgroundColor: light.surface, borderRadius: 12 },
  muscleRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  rowDivider: { borderBottomColor: light.separator, borderBottomWidth: StyleSheet.hairlineWidth },
  muscleName: { flexShrink: 1, color: light.text, fontSize: 16, fontWeight: "500" },
  muscleRating: { color: light.textSecondary, fontSize: 14 },
  footnote: { color: light.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 24 },
  errorText: { color: light.danger, fontSize: 14, textAlign: "center" },
  retry: {
    minHeight: MIN_TOUCH,
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: light.surface,
  },
  retryText: { color: light.text, fontSize: 15, fontWeight: "600" },
});
