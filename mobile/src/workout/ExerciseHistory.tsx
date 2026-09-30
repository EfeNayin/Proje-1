import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { getExerciseHistory, type PreviousExerciseSession } from "../api/workouts";
import { colors, spacing } from "../theme";
import { formatWeight, type WeightUnit } from "../units/weight";

type HistoryState = {
  items: PreviousExerciseSession[];
  nextCursor: string | null;
  status: "loading" | "ready" | "error";
};
const empty: HistoryState = { items: [], nextCursor: null, status: "loading" };

/** The parent keys this view by reference workout/date/exercise. No persistent cache. */
export function ExerciseHistory({ workoutId, exerciseId, unit }: {
  workoutId: string; exerciseId: string; unit: WeightUnit;
}) {
  const [expanded, setExpanded] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [history, setHistory] = useState<HistoryState>(empty);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!expanded) return;
    let active = true;
    inFlight.current = true;
    getExerciseHistory(workoutId, exerciseId, cursor).then(
      page => {
        if (!active) return;
        setHistory(previous => {
          const items = cursor === null ? [] : previous.items;
          const ids = new Set(items.map(item => item.workout_id));
          return {
            items: [...items, ...page.items.filter(item => !ids.has(item.workout_id))],
            nextCursor: page.next_cursor,
            status: "ready",
          };
        });
        inFlight.current = false;
      },
      () => {
        if (!active) return;
        setHistory(previous => ({ ...previous, status: "error" }));
        inFlight.current = false;
      },
    );
    return () => { active = false; };
  }, [expanded, cursor, attempt, workoutId, exerciseId]);

  const loadMore = () => {
    if (inFlight.current || history.status !== "ready" || history.nextCursor === null) return;
    inFlight.current = true;
    setHistory(previous => ({ ...previous, status: "loading" }));
    setCursor(history.nextCursor);
  };
  const retry = () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setHistory(previous => ({ ...previous, status: "loading" }));
    setAttempt(value => value + 1);
  };

  return (
    <View style={styles.container}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} style={styles.button}
        onPress={() => {
          inFlight.current = false;
          setHistory(empty);
          setCursor(null);
          setExpanded(value => !value);
        }}>
        <Text style={styles.link}>{expanded ? "Hide exercise history" : "All earlier sessions"}</Text>
      </Pressable>
      {expanded ? (
        <View style={styles.content}>
          <Text style={styles.detail}>
            Earlier closed sessions, newest first. Working sets only; warm-ups and zero-rep entries excluded.
          </Text>
          {history.items.map(session => (
            <View key={session.workout_id} style={styles.session}>
              <Text style={styles.title}>{session.title || "Workout"}</Text>
              <Text style={styles.detail}>{new Date(session.performed_at).toLocaleString()}</Text>
              {session.finished_automatically !== false ? (
                <Text style={styles.detail}>{session.finished_automatically === true
                  ? "Automatically closed session" : "Session closure method not recorded"}</Text>
              ) : null}
              {session.sets.map(set => (
                <Text key={set.id} style={styles.detail}>
                  {set.set_number}. {formatWeight(Number(set.weight_kg), unit)} × {set.reps}
                  {set.rir === null ? " · RIR not recorded" : ` · RIR ${set.rir}`}
                </Text>
              ))}
            </View>
          ))}
          {history.status === "loading" ? <ActivityIndicator color={colors.accent} /> : null}
          {history.status === "error" ? (
            <View>
              <Text style={styles.detail}>Could not load exercise history. Loaded sessions are kept.</Text>
              <Pressable accessibilityRole="button" style={styles.button} onPress={retry}>
                <Text style={styles.link}>Retry history</Text>
              </Pressable>
            </View>
          ) : null}
          {history.status === "ready" ? (
            history.nextCursor !== null ? (
              <Pressable accessibilityRole="button" style={styles.button} onPress={loadMore}>
                <Text style={styles.link}>Load older sessions</Text>
              </Pressable>
            ) : (
              <Text style={styles.detail}>{history.items.length === 0
                ? "No earlier closed session with working sets for this exercise."
                : "All earlier sessions loaded."}</Text>
            )
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: spacing.sm },
  button: { paddingVertical: spacing.sm, minHeight: 44, justifyContent: "center" },
  content: { gap: spacing.sm },
  session: { gap: spacing.xs, paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  link: { color: colors.accent, fontSize: 14 },
  title: { color: colors.text, fontSize: 14 },
  detail: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
});
