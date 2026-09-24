import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { getPreviousExerciseSession, type LoggedSet, type PreviousExerciseSession } from "../api/workouts";
import { colors, spacing } from "../theme";
import { formatWeight, type WeightUnit } from "../units/weight";
import { compareSessionWeights, formatRecordedWeightChange } from "./sessionComparison";

type Result = { status: "loading" } | { status: "error" } |
  { status: "ready"; session: PreviousExerciseSession | null };

/** Mounted with a workout/date/exercise key so a new reference resets the view. */
export function PreviousExercise({ workoutId, exerciseId, unit, currentSets }: {
  workoutId: string; exerciseId: string; unit: WeightUnit; currentSets: LoggedSet[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result>({ status: "loading" });

  useEffect(() => {
    if (!expanded) return;
    let active = true;
    getPreviousExerciseSession(workoutId, exerciseId).then(
      session => { if (active) setResult({ status: "ready", session }); },
      () => { if (active) setResult({ status: "error" }); },
    );
    return () => { active = false; };
  }, [expanded, attempt, workoutId, exerciseId]);

  const session = result.status === "ready" ? result.session : null;
  const comparisons = session ? compareSessionWeights(exerciseId, currentSets, session.sets) : [];
  return (
    <View style={styles.container}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }}
        onPress={() => { setResult({ status: "loading" }); setExpanded(value => !value); }}
        style={styles.button}>
        <Text style={styles.link}>{expanded ? "Hide previous session" : "Previous session"}</Text>
      </Pressable>
      {expanded ? (
        <View style={styles.content}>
          {result.status === "loading" ? <ActivityIndicator color={colors.accent} /> : null}
          {result.status === "error" ? (
            <View>
              <Text style={styles.detail}>Could not load previous sets.</Text>
              <Pressable accessibilityRole="button" style={styles.button}
                onPress={() => { setResult({ status: "loading" }); setAttempt(value => value + 1); }}>
                <Text style={styles.link}>Try again</Text>
              </Pressable>
            </View>
          ) : null}
          {result.status === "ready" && !session ? (
            <Text style={styles.detail}>No earlier closed session with working sets for this exercise.</Text>
          ) : null}
          {session ? (
            <View style={styles.content}>
              <Text style={styles.title}>{session.title || "Workout"}</Text>
              <Text style={styles.detail}>{new Date(session.performed_at).toLocaleString()}</Text>
              {session.finished_automatically !== false ? (
                <Text style={styles.detail}>{session.finished_automatically === true
                  ? "Automatically closed session" : "Session closure method not recorded"}</Text>
              ) : null}
              <Text style={styles.detail}>Previous working sets. Warm-ups and zero-rep entries excluded.</Text>
              {session.sets.map(set => (
                <Text key={set.id} style={styles.detail}>
                  {set.set_number}. {formatWeight(Number(set.weight_kg), unit)} × {set.reps}
                  {set.rir === null ? " · RIR not recorded" : ` · RIR ${set.rir}`}
                </Text>
              ))}
              <Text style={styles.detail}>Reference only: reps and effort may differ from this session.</Text>
              <Text style={styles.title}>Recorded weight comparison</Text>
              <Text style={styles.detail}>
                Same reps and recorded RIR. Maximum recorded weight in each group; set counts may differ.
              </Text>
              {comparisons.length === 0 ? (
                <Text style={styles.detail}>
                  No matching working sets yet. Both sessions need sets with the same reps and recorded RIR.
                </Text>
              ) : comparisons.map(row => (
                <View key={`${row.reps}:${row.rir}`} style={styles.content}>
                  <Text style={styles.title}>{row.reps} reps · RIR {row.rir}</Text>
                  <Text style={styles.detail}>
                    Previous: {formatWeight(row.previousWeightKg, unit)} ({row.previousSetCount} {row.previousSetCount === 1 ? "set" : "sets"})
                  </Text>
                  <Text style={styles.detail}>
                    This session: {formatWeight(row.currentWeightKg, unit)} ({row.currentSetCount} {row.currentSetCount === 1 ? "set" : "sets"})
                  </Text>
                  <Text style={styles.detail}>{formatRecordedWeightChange(row.deltaKg, unit)}</Text>
                </View>
              ))}
              <Text style={styles.detail}>
                Missing RIR is excluded. Body weight is not added to recorded loads.
                This comparison alone does not establish strength progress.
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: spacing.sm },
  button: { paddingVertical: spacing.sm, minHeight: 44, justifyContent: "center" },
  link: { color: colors.accent, fontSize: 14 },
  content: { gap: spacing.xs },
  title: { color: colors.text, fontSize: 14 },
  detail: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
});
