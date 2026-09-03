/**
 * Active workout: the screen the user actually holds between sets.
 *
 * Sets are grouped by exercise. Every mutation posts to the API and replaces
 * local state with the response, so the totals and set numbering on screen
 * are always the server's, never a local guess that could drift.
 */

import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import * as workoutsApi from "../../../src/api/workouts";
import type { LoggedSet, WorkoutDetail } from "../../../src/api/workouts";
import { colors, radius, spacing } from "../../../src/theme";
import { clearActiveWorkout } from "../../../src/workout/activeWorkout";

type ExerciseBlock = {
  exerciseId: string;
  name: string;
  sets: LoggedSet[];
};

/** Groups sets by exercise, preserving the order they were first logged in. */
function groupByExercise(
  sets: LoggedSet[],
  extraIds: { id: string; name: string }[],
): ExerciseBlock[] {
  const blocks = new Map<string, ExerciseBlock>();

  for (const set of sets) {
    const block = blocks.get(set.exercise_id) ?? {
      exerciseId: set.exercise_id,
      name: set.exercise_name,
      sets: [],
    };
    block.sets.push(set);
    blocks.set(set.exercise_id, block);
  }

  // Exercises picked but not yet logged have no sets on the server, so they
  // only exist in local state until the first set lands.
  for (const extra of extraIds) {
    if (!blocks.has(extra.id)) {
      blocks.set(extra.id, { exerciseId: extra.id, name: extra.name, sets: [] });
    }
  }

  return [...blocks.values()];
}

/**
 * Seconds since a timestamp, ticking every second.
 *
 * Derived from the timestamp rather than incremented: backgrounding the app
 * pauses JS timers, and a counter would silently lose those seconds.
 */
function useElapsedSeconds(since: number | null): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (since === null) return;

    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - since) / 1000)));
    tick();
    const handle = setInterval(tick, 1000);
    return () => clearInterval(handle);
  }, [since]);

  return elapsed;
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  // Hours only appear for a session left running overnight, which is itself a
  // useful hint that it needs finishing.
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function SessionDuration({ startedAt }: { startedAt: string }) {
  const elapsed = useElapsedSeconds(new Date(startedAt).getTime());

  return (
    <View>
      <Text style={styles.summaryValue}>{formatDuration(elapsed)}</Text>
      <Text style={styles.summaryLabel}>duration</Text>
    </View>
  );
}

function RestTimer({ since }: { since: number | null }) {
  const elapsed = useElapsedSeconds(since);

  if (since === null) return null;

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  return (
    <View style={styles.timer}>
      <Ionicons name="time-outline" size={16} color={colors.textMuted} />
      <Text style={styles.timerText}>
        Rest {minutes}:{String(seconds).padStart(2, "0")}
      </Text>
    </View>
  );
}

/**
 * The workout's name, edited in place.
 *
 * Saved on blur rather than per keystroke: a request per character would be
 * wasteful, and there is no meaningful moment to autosave mid-word.
 */
function TitleField({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (title: string | null) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");

  // Keep in step when the server sends a different title back.
  useEffect(() => setDraft(value ?? ""), [value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === (value ?? "")) return;
    onSave(trimmed === "" ? null : trimmed);
  };

  return (
    <TextInput
      style={styles.titleInput}
      value={draft}
      onChangeText={setDraft}
      onBlur={commit}
      onSubmitEditing={commit}
      placeholder="Name this workout"
      placeholderTextColor={colors.textMuted}
      returnKeyType="done"
      maxLength={200}
    />
  );
}

/**
 * One logged set. Tap to correct it, long-press to delete.
 *
 * Editing in place rather than in a modal: fixing a mistyped rep count is a
 * two-second job and should not involve a screen transition.
 */
function SetRow({
  set,
  onSave,
  onDelete,
}: {
  set: LoggedSet;
  onSave: (setId: number, weight: number, reps: number) => Promise<void>;
  onDelete: (setId: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [saving, setSaving] = useState(false);

  const startEditing = () => {
    setWeight(String(Number(set.weight_kg)));
    setReps(String(set.reps));
    setEditing(true);
  };

  const save = async () => {
    const parsedWeight = Number(weight.replace(",", "."));
    const parsedReps = Number(reps);

    if (!Number.isFinite(parsedWeight) || parsedWeight < 0) return;
    if (!Number.isInteger(parsedReps) || parsedReps <= 0) return;

    setSaving(true);
    try {
      await onSave(set.id, parsedWeight, parsedReps);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <View style={styles.setRowEditing}>
        <Text style={[styles.setNumber, set.is_warmup && styles.warmupLabel]}>
          {set.is_warmup ? "W" : set.set_number}
        </Text>

        <TextInput
          style={styles.editInput}
          value={weight}
          onChangeText={setWeight}
          keyboardType="decimal-pad"
          autoFocus
          selectTextOnFocus
        />
        <Text style={styles.editUnit}>kg ×</Text>
        <TextInput
          style={styles.editInput}
          value={reps}
          onChangeText={setReps}
          keyboardType="number-pad"
          selectTextOnFocus
          onSubmitEditing={() => void save()}
        />

        <Pressable onPress={() => setEditing(false)} hitSlop={8} style={styles.editAction}>
          <Ionicons name="close" size={20} color={colors.textMuted} />
        </Pressable>
        <Pressable onPress={() => void save()} hitSlop={8} style={styles.editAction} disabled={saving}>
          {saving ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Ionicons name="checkmark" size={20} color={colors.accent} />
          )}
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable
      style={styles.setRow}
      onPress={startEditing}
      onLongPress={() =>
        Alert.alert("Delete set?", undefined, [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: () => onDelete(set.id) },
        ])
      }
    >
      <Text style={[styles.setNumber, set.is_warmup && styles.warmupLabel]}>
        {set.is_warmup ? "W" : set.set_number}
      </Text>
      <Text style={styles.setDetail}>
        {Number(set.weight_kg)} kg × {set.reps}
      </Text>
    </Pressable>
  );
}

function SetForm({
  onSubmit,
  busy,
  lastSet,
}: {
  onSubmit: (weight: number, reps: number, isWarmup: boolean) => void;
  busy: boolean;
  lastSet: LoggedSet | undefined;
}) {
  // Prefilled from the previous set: on a working set you usually repeat the
  // weight, and retyping it every time is the main friction in logging.
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [isWarmup, setIsWarmup] = useState(false);

  const weightHint = lastSet ? String(Number(lastSet.weight_kg)) : "0";
  const repsHint = lastSet ? String(lastSet.reps) : "8";

  const submit = () => {
    const parsedWeight = Number(weight === "" ? weightHint : weight.replace(",", "."));
    const parsedReps = Number(reps === "" ? repsHint : reps);

    if (!Number.isFinite(parsedWeight) || parsedWeight < 0) return;
    if (!Number.isInteger(parsedReps) || parsedReps <= 0) return;

    onSubmit(parsedWeight, parsedReps, isWarmup);
    setWeight("");
    setReps("");
  };

  return (
    <View style={styles.form}>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>kg</Text>
        <TextInput
          style={styles.fieldInput}
          value={weight}
          onChangeText={setWeight}
          placeholder={weightHint}
          placeholderTextColor={colors.textMuted}
          keyboardType="decimal-pad"
          returnKeyType="next"
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>reps</Text>
        <TextInput
          style={styles.fieldInput}
          value={reps}
          onChangeText={setReps}
          placeholder={repsHint}
          placeholderTextColor={colors.textMuted}
          keyboardType="number-pad"
          returnKeyType="done"
          onSubmitEditing={submit}
        />
      </View>

      <Pressable
        style={[styles.warmupToggle, isWarmup && styles.warmupActive]}
        onPress={() => setIsWarmup((value) => !value)}
      >
        <Text style={[styles.warmupText, isWarmup && styles.warmupTextActive]}>W</Text>
      </Pressable>

      <Pressable style={styles.addSet} onPress={submit} disabled={busy}>
        {busy ? (
          <ActivityIndicator color={colors.accentText} size="small" />
        ) : (
          <Ionicons name="add" size={22} color={colors.accentText} />
        )}
      </Pressable>
    </View>
  );
}

export default function ActiveWorkoutScreen() {
  const router = useRouter();
  const { id, addExerciseId, addExerciseName } = useLocalSearchParams<{
    id: string;
    addExerciseId?: string;
    addExerciseName?: string;
  }>();

  const [workout, setWorkout] = useState<WorkoutDetail | null>(null);
  const [pending, setPending] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyExercise, setBusyExercise] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSetAt, setLastSetAt] = useState<number | null>(null);

  // The picker navigates back with the choice in params; consume it once so a
  // re-render does not keep re-adding the same exercise.
  const consumedParam = useRef<string | null>(null);
  useEffect(() => {
    if (!addExerciseId || !addExerciseName) return;
    if (consumedParam.current === addExerciseId) return;
    consumedParam.current = addExerciseId;

    setPending((current) =>
      current.some((item) => item.id === addExerciseId)
        ? current
        : [...current, { id: addExerciseId, name: addExerciseName }],
    );
  }, [addExerciseId, addExerciseName]);

  useEffect(() => {
    let cancelled = false;
    workoutsApi
      .getWorkout(id)
      .then((data) => {
        if (!cancelled) setWorkout(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load workout");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const blocks = useMemo(
    () => (workout ? groupByExercise(workout.sets, pending) : []),
    [workout, pending],
  );

  const handleSaveTitle = useCallback(
    async (title: string | null) => {
      try {
        setWorkout(await workoutsApi.updateWorkout(id, { title }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save the name");
      }
    },
    [id],
  );

  const handleAddSet = useCallback(
    async (exerciseId: string, weight: number, reps: number, isWarmup: boolean) => {
      setBusyExercise(exerciseId);
      setError(null);
      try {
        const updated = await workoutsApi.addSet(id, {
          exercise_id: exerciseId,
          weight_kg: weight,
          reps,
          is_warmup: isWarmup,
        });
        setWorkout(updated);
        // Warmups do not start a rest period worth watching.
        if (!isWarmup) setLastSetAt(Date.now());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save the set");
      } finally {
        setBusyExercise(null);
      }
    },
    [id],
  );

  const handleEditSet = useCallback(
    async (setId: number, weight: number, reps: number) => {
      setError(null);
      try {
        setWorkout(await workoutsApi.updateSet(id, setId, { weight_kg: weight, reps }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not update the set");
        throw err;
      }
    },
    [id],
  );

  const handleDeleteSet = useCallback(
    async (setId: number) => {
      try {
        setWorkout(await workoutsApi.deleteSet(id, setId));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not delete the set");
      }
    },
    [id],
  );

  const handleFinish = useCallback(async () => {
    await clearActiveWorkout();
    router.dismissAll();
    router.replace("/");
  }, [router]);

  const confirmFinish = () => {
    const empty = (workout?.sets.length ?? 0) === 0;
    Alert.alert(
      "Finish workout?",
      empty
        ? "This workout has no sets. It will stay in your history as an empty session."
        : undefined,
      [
        { text: "Keep going", style: "cancel" },
        { text: "Finish", style: "default", onPress: () => void handleFinish() },
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!workout) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error ?? "Workout not found"}</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      <Stack.Screen
        options={{
          title: workout.title ?? "Workout",
          headerRight: () => (
            <Pressable onPress={confirmFinish} hitSlop={8}>
              <Text style={styles.finish}>Finish</Text>
            </Pressable>
          ),
        }}
      />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TitleField value={workout.title} onSave={(title) => void handleSaveTitle(title)} />

        <View style={styles.summary}>
          <View>
            <Text style={styles.summaryValue}>{workout.total_sets}</Text>
            <Text style={styles.summaryLabel}>working sets</Text>
          </View>
          <SessionDuration startedAt={workout.performed_at} />
          <RestTimer since={lastSetAt} />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {blocks.map((block) => (
          <View key={block.exerciseId} style={styles.block}>
            <Text style={styles.blockTitle}>{block.name}</Text>

            {block.sets.map((set) => (
              <SetRow
                key={set.id}
                set={set}
                onSave={handleEditSet}
                onDelete={(setId) => void handleDeleteSet(setId)}
              />
            ))}

            <SetForm
              busy={busyExercise === block.exerciseId}
              lastSet={block.sets[block.sets.length - 1]}
              onSubmit={(weight, reps, isWarmup) =>
                void handleAddSet(block.exerciseId, weight, reps, isWarmup)
              }
            />
          </View>
        ))}

        <Pressable
          style={styles.addExercise}
          onPress={() =>
            router.push({ pathname: "/workout/exercise-picker", params: { workoutId: id } })
          }
        >
          <Ionicons name="add" size={20} color={colors.accent} />
          <Text style={styles.addExerciseText}>Add exercise</Text>
        </Pressable>

        {blocks.length === 0 ? (
          <Text style={styles.hint}>Add an exercise to start logging sets.</Text>
        ) : (
          <Text style={styles.hint}>Tap a set to correct it, long-press to delete.</Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  content: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  finish: { color: colors.accent, fontSize: 16, fontWeight: "700" },

  titleInput: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },

  summary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  summaryValue: { color: colors.text, fontSize: 20, fontWeight: "700" },
  summaryLabel: { color: colors.textMuted, fontSize: 12 },
  timer: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  timerText: { color: colors.textMuted, fontSize: 14 },
  error: { color: colors.danger, marginBottom: spacing.md },

  block: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  blockTitle: { color: colors.text, fontSize: 16, fontWeight: "600", marginBottom: spacing.sm },

  setRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  setRowEditing: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  setNumber: { color: colors.textMuted, width: 28, fontSize: 14, fontWeight: "600" },
  warmupLabel: { color: colors.textMuted, opacity: 0.7 },
  setDetail: { color: colors.text, fontSize: 15 },
  editInput: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minWidth: 62,
    textAlign: "center",
  },
  editUnit: { color: colors.textMuted, fontSize: 13 },
  editAction: { paddingHorizontal: spacing.xs },

  form: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, marginTop: spacing.md },
  field: { flex: 1 },
  fieldLabel: { color: colors.textMuted, fontSize: 11, marginBottom: 2 },
  fieldInput: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  warmupToggle: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    borderColor: colors.border,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  warmupActive: { backgroundColor: colors.border },
  warmupText: { color: colors.textMuted, fontWeight: "700" },
  warmupTextActive: { color: colors.text },
  addSet: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },

  addExercise: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    borderColor: colors.border,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  addExerciseText: { color: colors.accent, fontSize: 16, fontWeight: "600" },
  hint: { color: colors.textMuted, fontSize: 13, textAlign: "center", marginTop: spacing.md },
});