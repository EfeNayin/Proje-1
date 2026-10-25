import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import type { AthleteExerciseSession, AthleteSet } from "../api/coaching";
import { roman, romanFont } from "../romanTheme";
import type { WeightUnit } from "../units/weight";
import type { AthleteExerciseHistoryState } from "./athleteExerciseHistory";
import { athleteExerciseHistoryStore } from "./athleteExerciseHistorySession";
import { formatSessionDate, rirText, setBadgeText, setWeightText } from "./athleteWorkoutDisplay";

const MIN_TOUCH = 44;

/**
 * The coach's read-only panel of an athlete's earlier sessions of one exercise,
 * laid out like the athlete's own exercise-history panel: a Modal over the
 * workout, a fixed header with a close button, and one scrolling list.
 *
 * It only shows what the athlete recorded: date, workout name and the working
 * sets with weight (in the viewer's unit), reps and RIR. Nothing is computed
 * from the sets, and there is nothing to edit.
 */
export function AthleteExerciseHistoryPanel({
  state,
  exerciseName,
  athleteName,
  unit,
}: {
  state: AthleteExerciseHistoryState;
  exerciseName: string;
  athleteName: string;
  unit: WeightUnit;
}) {
  if (state.context === null) return null;
  const close = () => athleteExerciseHistoryStore.close();
  const empty = state.loaded && state.items.length === 0 && state.nextCursor === null;

  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent onRequestClose={close}>
      {/* A Modal is its own native window, so it needs its own provider for the
          safe-area insets to be measured inside it. */}
      <SafeAreaProvider>
        <View style={styles.overlay}>
          {/* A sibling of the panel, not its parent: scrolling never reaches it. */}
          <Pressable
            testID="coach-history-backdrop"
            accessible={false}
            importantForAccessibility="no"
            style={StyleSheet.absoluteFill}
            onPress={close}
          />
          <SafeAreaView edges={["bottom", "left", "right"]} style={styles.panel}>
            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text accessibilityRole="header" style={styles.headerTitle}>
                  Earlier sessions
                </Text>
                <Text style={styles.headerSubtitle}>{exerciseName}</Text>
                <Text style={styles.headerSubtitle}>{athleteName}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close earlier sessions"
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
              data={state.items}
              keyExtractor={(item) => item.workout_id}
              renderItem={({ item }) => <Session session={item} unit={unit} />}
              ListHeaderComponent={
                <Text style={styles.note}>
                  Read-only. Completed sessions before this workout, newest first. Working sets
                  only; warm-ups are not shown. Weights shown in {unit}.
                </Text>
              }
              ListFooterComponent={
                <View style={styles.footer}>
                  {state.loading ? (
                    <ActivityIndicator color={roman.gold} accessibilityLabel="Loading earlier sessions" />
                  ) : null}
                  {state.unavailable ? (
                    <Text accessibilityRole="alert" style={styles.note}>
                      This history is no longer available.
                    </Text>
                  ) : null}
                  {state.error ? (
                    <View>
                      <Text accessibilityRole="alert" style={styles.error}>
                        {state.error === "initial"
                          ? "Could not load earlier sessions."
                          : "Could not load older sessions. Loaded sessions are kept."}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={
                          state.error === "initial" ? "Try loading earlier sessions again" : "Try loading older sessions again"
                        }
                        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
                        onPress={() => void athleteExerciseHistoryStore.retry()}
                      >
                        <Text style={styles.link}>Try again</Text>
                      </Pressable>
                    </View>
                  ) : null}
                  {empty ? (
                    <Text style={styles.note}>
                      No earlier completed session of this exercise has recorded working sets.
                    </Text>
                  ) : null}
                  {state.loaded && !state.loading && !state.error && state.nextCursor !== null ? (
                    <Pressable
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
                      onPress={() => void athleteExerciseHistoryStore.loadMore()}
                    >
                      <Text style={styles.link}>Load older sessions</Text>
                    </Pressable>
                  ) : null}
                  {state.loaded && !state.error && state.nextCursor === null && !empty ? (
                    <Text style={styles.note}>All earlier sessions loaded.</Text>
                  ) : null}
                </View>
              }
            />
          </SafeAreaView>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}

function Session({ session, unit }: { session: AthleteExerciseSession; unit: WeightUnit }) {
  return (
    <View style={styles.session}>
      <Text style={styles.title}>{session.title || "Workout"}</Text>
      <Text style={styles.meta}>{formatSessionDate(session.performed_at)}</Text>
      {session.sets.map((set, index) => (
        <SetLine key={`${set.set_number}-${index}`} set={set} unit={unit} />
      ))}
    </View>
  );
}

function SetLine({ set, unit }: { set: AthleteSet; unit: WeightUnit }) {
  const weight = setWeightText(set, unit);
  const rir = rirText(set.rir);
  return (
    <View
      accessible
      accessibilityLabel={`${set.is_warmup ? "Warm-up set" : `Set ${set.set_number}`}, ${weight}, ${set.reps} reps, ${rir}`}
      style={styles.setRow}
    >
      <View style={[styles.badge, set.is_warmup && styles.warmupBadge]}>
        <Text style={[styles.badgeText, set.is_warmup && styles.warmupText]}>{setBadgeText(set)}</Text>
      </View>
      <Text style={styles.setWeight}>{weight}</Text>
      <Text style={styles.setReps}>× {set.reps}</Text>
      <Text style={[styles.setRir, set.rir == null && styles.rirUnknown]}>{rir}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  panel: {
    height: "85%",
    backgroundColor: roman.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopColor: roman.gold,
    borderTopWidth: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: roman.border,
  },
  headerText: { flex: 1, marginRight: 8 },
  headerTitle: { color: roman.text, fontFamily: romanFont.title, fontSize: 18, letterSpacing: 0.5 },
  headerSubtitle: { color: roman.textMuted, fontFamily: romanFont.regular, fontSize: 13, lineHeight: 19, marginTop: 2 },
  closeButton: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: "center", justifyContent: "center" },
  closeIcon: { color: roman.text, fontSize: 18 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingBottom: 16 },
  footer: { paddingVertical: 8, gap: 8 },
  note: { color: roman.textMuted, fontFamily: romanFont.regular, fontSize: 13, lineHeight: 19, paddingVertical: 8 },
  error: { color: roman.danger, fontFamily: romanFont.medium, fontSize: 14, lineHeight: 20 },
  button: { minHeight: MIN_TOUCH, justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: 4, borderRadius: 8 },
  pressed: { backgroundColor: roman.surfaceRaised },
  link: { color: roman.goldLight, fontFamily: romanFont.semibold, fontSize: 14 },
  session: {
    gap: 6,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: roman.border,
  },
  title: { color: roman.text, fontFamily: romanFont.semibold, fontSize: 15, lineHeight: 21 },
  meta: { color: roman.textMuted, fontFamily: romanFont.regular, fontSize: 13, lineHeight: 19 },
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
});
