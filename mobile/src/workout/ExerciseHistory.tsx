import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { getExerciseHistory, type PreviousExerciseSession } from "../api/workouts";
import { colors, radius, spacing } from "../theme";
import { formatWeight, type WeightUnit } from "../units/weight";

type HistoryState = {
  items: PreviousExerciseSession[];
  nextCursor: string | null;
  status: "loading" | "ready" | "error";
};
const empty: HistoryState = { items: [], nextCursor: null, status: "loading" };

/**
 * "All earlier sessions" opens a full-screen Modal panel over the workout
 * screen instead of growing the exercise card. The Modal blocks touches to
 * the workout underneath by construction, so the active set draft, open
 * editor and rest timer behind it are never touched by this component.
 */
export function ExerciseHistory({ workoutId, exerciseId, exerciseName, unit }: {
  workoutId: string; exerciseId: string; exerciseName: string; unit: WeightUnit;
}) {
  const [visible, setVisible] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [history, setHistory] = useState<HistoryState>(empty);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!visible) return;
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
  }, [visible, cursor, attempt, workoutId, exerciseId]);

  const open = () => {
    inFlight.current = false;
    setHistory(empty);
    setCursor(null);
    Keyboard.dismiss();
    setVisible(true);
  };
  // Single close path: the close button, backdrop and Android back all use it.
  const close = () => { setVisible(false); };
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
      <Pressable accessibilityRole="button" style={styles.button} onPress={open}>
        <Text style={styles.link}>All earlier sessions</Text>
      </Pressable>
      {visible ? (
        <Modal visible transparent animationType="slide" statusBarTranslucent onRequestClose={close}>
          {/* A Modal is its own native window, so it needs its own provider
              for the safe-area insets to be measured inside it. */}
          <SafeAreaProvider>
            <View style={styles.overlay}>
              {/* The backdrop is a sibling of the panel, not its parent, so a
                  tap or scroll inside the list never reaches it. */}
              <Pressable testID="history-backdrop" accessible={false}
                importantForAccessibility="no" style={StyleSheet.absoluteFill} onPress={close} />
              <SafeAreaView edges={["bottom", "left", "right"]} style={styles.panel}>
                <View style={styles.header}>
                  <View style={styles.headerText}>
                    <Text accessibilityRole="header" style={styles.headerTitle}>Exercise history</Text>
                    <Text style={styles.headerSubtitle} numberOfLines={2}>{exerciseName}</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close exercise history"
                    hitSlop={8}
                    style={styles.closeButton}
                    onPress={close}
                  >
                    <Text style={styles.closeIcon}>✕</Text>
                  </Pressable>
                </View>
                <FlatList
                  style={styles.list}
                  contentContainerStyle={styles.listContent}
                  data={history.items}
                  keyExtractor={item => item.workout_id}
                  renderItem={({ item }) => (
                    <View style={styles.session}>
                      <Text style={styles.title}>{item.title || "Workout"}</Text>
                      <Text style={styles.detail}>{new Date(item.performed_at).toLocaleString()}</Text>
                      {item.finished_automatically !== false ? (
                        <Text style={styles.detail}>{item.finished_automatically === true
                          ? "Automatically closed session" : "Session closure method not recorded"}</Text>
                      ) : null}
                      {item.sets.map(set => (
                        <Text key={set.id} style={styles.detail}>
                          {set.set_number}. {formatWeight(Number(set.weight_kg), unit)} × {set.reps}
                          {set.rir === null ? " · RIR not recorded" : ` · RIR ${set.rir}`}
                        </Text>
                      ))}
                    </View>
                  )}
                  ListHeaderComponent={
                    <Text style={styles.detail}>
                      Earlier closed sessions, newest first. Working sets only; warm-ups and zero-rep
                      entries excluded.
                    </Text>
                  }
                  ListFooterComponent={
                    <View style={styles.footer}>
                      {history.status === "loading" ? <ActivityIndicator color={colors.accent} /> : null}
                      {history.status === "error" ? (
                        <View>
                          <Text style={styles.detail}>
                            {history.items.length === 0
                              ? "Could not load exercise history."
                              : "Could not load older sessions. Loaded sessions are kept."}
                          </Text>
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
                  }
                />
              </SafeAreaView>
            </View>
          </SafeAreaProvider>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: spacing.sm },
  button: { paddingVertical: spacing.sm, minHeight: 44, justifyContent: "center" },
  link: { color: colors.accent, fontSize: 14 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  panel: {
    height: "85%",
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerText: { flex: 1, marginRight: spacing.sm },
  headerTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
  headerSubtitle: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  closeButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  closeIcon: { color: colors.text, fontSize: 18 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  footer: { paddingVertical: spacing.sm },
  session: { gap: spacing.xs, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  title: { color: colors.text, fontSize: 14 },
  detail: { color: colors.textMuted, fontSize: 12, lineHeight: 18, paddingVertical: spacing.xs },
});
