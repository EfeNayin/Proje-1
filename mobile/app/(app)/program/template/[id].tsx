/**
 * Template editor: name a training day, add exercises, set their targets.
 *
 * Exercises are edited as a local draft and saved in one request
 * (PUT .../exercises replaces the whole list) rather than one request per
 * field change — it mirrors how the backend endpoint is shaped, and it
 * means a half-finished edit never partially lands on the server.
 */

import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import * as programsApi from "../../../../src/api/programs";
import type { TemplateExerciseInput, WorkoutTemplate } from "../../../../src/api/programs";
import { FocusedDarkStatusBar } from "../../../../src/FocusedDarkStatusBar";
import { light } from "../../../../src/lightTheme";
import { setActiveWorkout } from "../../../../src/workout/activeWorkout";
import { usePickedExercise } from "../../../../src/workout/usePickedExercise";

type DraftExercise = {
  exerciseId: string;
  exerciseName: string;
  sets: string;
  repsMin: string;
  repsMax: string;
  rir: string;
};

function toDraft(target: WorkoutTemplate["exercises"][number]): DraftExercise {
  return {
    exerciseId: target.exercise_id,
    exerciseName: target.exercise_name,
    sets: String(target.target_sets),
    repsMin: target.target_reps_min === null ? "" : String(target.target_reps_min),
    repsMax: target.target_reps_max === null ? "" : String(target.target_reps_max),
    rir: target.target_rir === null ? "" : String(target.target_rir),
  };
}

function toPayload(draft: DraftExercise): TemplateExerciseInput | null {
  const sets = Number(draft.sets);
  if (!Number.isInteger(sets) || sets <= 0) return null;

  const repsMin = draft.repsMin.trim() === "" ? null : Number(draft.repsMin);
  const repsMax = draft.repsMax.trim() === "" ? null : Number(draft.repsMax);
  const rir = draft.rir.trim() === "" ? null : Number(draft.rir);

  return {
    exercise_id: draft.exerciseId,
    target_sets: sets,
    target_reps_min: repsMin,
    target_reps_max: repsMax,
    target_rir: rir,
  };
}

/** One exercise's targets. Tap fields directly; there is no separate edit mode. */
function ExerciseRow({
  draft,
  onChange,
  onRemove,
}: {
  draft: DraftExercise;
  onChange: (next: DraftExercise) => void;
  onRemove: () => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowTitle}>{draft.exerciseName}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${draft.exerciseName}`}
          onPress={onRemove}
          hitSlop={4}
          style={styles.removeButton}
        >
          <Ionicons name="trash-outline" size={20} color={light.danger} />
        </Pressable>
      </View>

      {/* Wraps on a narrow screen or with larger text instead of squeezing. */}
      <View style={styles.rowFields}>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Sets</Text>
          <TextInput
            accessibilityLabel={`Sets for ${draft.exerciseName}`}
            style={styles.fieldInput}
            value={draft.sets}
            onChangeText={(value) => onChange({ ...draft, sets: value })}
            keyboardType="number-pad"
            selectionColor={light.text}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Reps min</Text>
          <TextInput
            accessibilityLabel={`Minimum reps for ${draft.exerciseName}`}
            style={styles.fieldInput}
            value={draft.repsMin}
            onChangeText={(value) => onChange({ ...draft, repsMin: value })}
            keyboardType="number-pad"
            placeholder="-"
            placeholderTextColor={light.textSecondary}
            selectionColor={light.text}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Reps max</Text>
          <TextInput
            accessibilityLabel={`Maximum reps for ${draft.exerciseName}`}
            style={styles.fieldInput}
            value={draft.repsMax}
            onChangeText={(value) => onChange({ ...draft, repsMax: value })}
            keyboardType="number-pad"
            placeholder="-"
            placeholderTextColor={light.textSecondary}
            selectionColor={light.text}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>RIR</Text>
          <TextInput
            accessibilityLabel={`Target RIR for ${draft.exerciseName}`}
            style={styles.fieldInput}
            value={draft.rir}
            onChangeText={(value) => onChange({ ...draft, rir: value })}
            keyboardType="number-pad"
            placeholder="-"
            placeholderTextColor={light.textSecondary}
            selectionColor={light.text}
          />
        </View>
      </View>
    </View>
  );
}

export default function TemplateEditor() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [template, setTemplate] = useState<WorkoutTemplate | null>(null);
  const [draftName, setDraftName] = useState("");
  const [exercises, setExercises] = useState<DraftExercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    programsApi
      .getTemplate(id)
      .then((data) => {
        if (cancelled) return;
        setTemplate(data);
        setDraftName(data.name);
        setExercises(data.exercises.map(toDraft));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load template");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const { openPicker } = usePickedExercise((exercise) => {
    setExercises((current) => [
      ...current,
      { exerciseId: exercise.id, exerciseName: exercise.name, sets: "3", repsMin: "", repsMax: "", rir: "" },
    ]);
  });

  const handleRemove = (index: number) => {
    setExercises((current) => current.filter((_, i) => i !== index));
  };

  const handleSaveName = async () => {
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === template?.name) return;
    try {
      await programsApi.updateTemplate(id, { name: trimmed });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename the template");
    }
  };

  /**
   * Validates and persists the current draft. Shared by Save and Start
   * workout: starting from a template whose latest edits were never sent
   * would silently start the OLD version of it, so Start always saves
   * first, exactly like tapping Save would.
   */
  const persistExercises = async (): Promise<boolean> => {
    setError(null);

    const payload = exercises.map(toPayload);
    if (payload.some((item) => item === null)) {
      setError("Each exercise needs a valid number of sets.");
      return false;
    }

    try {
      await programsApi.setTemplateExercises(id, payload as NonNullable<(typeof payload)[number]>[]);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the exercises");
      return false;
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const ok = await persistExercises();
    setSaving(false);
    // Success is leaving: the program screen (refreshed on focus) is where
    // the saved exercises become visible, which is the confirmation itself
    // — a toast on top of a screen that is about to disappear would be
    // easy to miss and adds nothing a returning screen doesn't already say.
    if (ok) router.back();
  };

  const handleStartWorkout = async () => {
    setStarting(true);
    if (!(await persistExercises())) {
      setStarting(false);
      return;
    }

    try {
      const { workout_id } = await programsApi.startWorkoutFromTemplate(id);
      await setActiveWorkout(workout_id);
      router.push(`/workout/${workout_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the workout");
      setStarting(false);
    }
  };

  const handleDeleteTemplate = () => {
    Alert.alert("Delete template?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          setDeleting(true);
          programsApi
            .deleteTemplate(id)
            .then(() => router.back())
            .catch((err) => {
              setDeleting(false);
              setError(err instanceof Error ? err.message : "Could not delete the template");
            });
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <FocusedDarkStatusBar />
        <ActivityIndicator color={light.textSecondary} />
      </View>
    );
  }

  if (!template) {
    return (
      <View style={styles.centered}>
        <FocusedDarkStatusBar />
        <Text style={styles.error}>{error ?? "Template not found"}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      // iOS: lifts the content above the keyboard and scrolls the focused field into view.
      automaticallyAdjustKeyboardInsets
    >
      <FocusedDarkStatusBar />
      {/* The native header stays (title + delete) but is light, like this screen. */}
      <Stack.Screen
        options={{
          title: template.name,
          headerStyle: { backgroundColor: light.background },
          headerTintColor: light.text,
          headerTitleStyle: { color: light.text },
          headerShadowVisible: false,
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete template"
              onPress={handleDeleteTemplate}
              disabled={deleting}
              hitSlop={8}
            >
              {deleting ? (
                <ActivityIndicator size="small" color={light.danger} />
              ) : (
                <Ionicons name="trash-outline" size={20} color={light.danger} />
              )}
            </Pressable>
          ),
        }}
      />

      <TextInput
        accessibilityLabel="Template name"
        style={styles.nameInput}
        value={draftName}
        onChangeText={setDraftName}
        onBlur={() => void handleSaveName()}
        returnKeyType="done"
        maxLength={200}
        selectionColor={light.text}
      />

      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}

      <Text accessibilityRole="header" style={styles.sectionLabel}>
        Exercises
      </Text>

      {exercises.map((draft, index) => (
        <ExerciseRow
          key={`${draft.exerciseId}-${index}`}
          draft={draft}
          onChange={(next) =>
            setExercises((current) => current.map((item, i) => (i === index ? next : item)))
          }
          onRemove={() => handleRemove(index)}
        />
      ))}

      {exercises.length === 0 ? (
        <Text style={styles.empty}>No exercises yet. Add one below.</Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [styles.addExercise, pressed && styles.addExercisePressed]}
        onPress={openPicker}
      >
        <Ionicons name="add" size={20} color={light.text} />
        <Text style={styles.addExerciseText}>Add exercise</Text>
      </Pressable>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          style={[styles.save, styles.saveSecondary, (saving || starting) && styles.saveDisabled]}
          onPress={() => void handleSave()}
          disabled={saving || starting}
        >
          {saving ? (
            <ActivityIndicator color={light.text} />
          ) : (
            <Text style={styles.saveSecondaryText}>Save</Text>
          )}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.save,
            pressed && styles.savePressed,
            (saving || starting) && styles.saveDisabled,
          ]}
          onPress={() => void handleStartWorkout()}
          disabled={saving || starting}
        >
          {starting ? (
            <ActivityIndicator color={light.onPrimary} />
          ) : (
            <Text style={styles.saveText}>Start workout</Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: light.background,
    padding: 24,
  },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 48 },
  nameInput: {
    color: light.text,
    fontSize: 24,
    fontWeight: "700",
    paddingVertical: 8,
    marginBottom: 12,
  },
  error: { color: light.danger, fontSize: 14, fontWeight: "500", lineHeight: 20, marginBottom: 12 },
  sectionLabel: { color: light.textSecondary, fontSize: 13, fontWeight: "600", marginBottom: 8, marginLeft: 4 },
  empty: { color: light.textSecondary, fontSize: 14, marginBottom: 12, marginLeft: 4 },

  row: {
    backgroundColor: light.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  rowTitle: { color: light.text, fontSize: 17, fontWeight: "600", flex: 1, marginRight: 8 },
  removeButton: { width: 44, height: 44, marginRight: -8, alignItems: "center", justifyContent: "center" },
  rowFields: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  field: { flexGrow: 1, flexBasis: 64, minWidth: 64 },
  fieldLabel: { color: light.textSecondary, fontSize: 12, marginBottom: 4 },
  fieldInput: {
    minHeight: 44,
    backgroundColor: light.background,
    borderRadius: 10,
    color: light.text,
    fontSize: 17,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    paddingHorizontal: 8,
    paddingVertical: 8,
    textAlign: "center",
  },

  addExercise: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: light.surface,
    marginTop: 4,
    marginBottom: 24,
  },
  addExercisePressed: { backgroundColor: light.pressed },
  addExerciseText: { color: light.text, fontSize: 16, fontWeight: "600" },

  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  save: {
    flexGrow: 1,
    flexBasis: 120,
    minHeight: 52,
    backgroundColor: light.primary,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  savePressed: { backgroundColor: light.primaryPressed },
  saveSecondary: { backgroundColor: light.surface },
  saveDisabled: { opacity: 0.6 },
  saveText: { color: light.onPrimary, fontSize: 17, fontWeight: "600" },
  saveSecondaryText: { color: light.text, fontSize: 17, fontWeight: "600" },
});
