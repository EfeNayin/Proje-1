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
import { useEffect, useRef, useState } from "react";
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
import { colors, radius, spacing } from "../../../../src/theme";

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
        <Pressable onPress={onRemove} hitSlop={8}>
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
        </Pressable>
      </View>

      <View style={styles.rowFields}>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>sets</Text>
          <TextInput
            style={styles.fieldInput}
            value={draft.sets}
            onChangeText={(value) => onChange({ ...draft, sets: value })}
            keyboardType="number-pad"
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>reps min</Text>
          <TextInput
            style={styles.fieldInput}
            value={draft.repsMin}
            onChangeText={(value) => onChange({ ...draft, repsMin: value })}
            keyboardType="number-pad"
            placeholder="-"
            placeholderTextColor={colors.textMuted}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>reps max</Text>
          <TextInput
            style={styles.fieldInput}
            value={draft.repsMax}
            onChangeText={(value) => onChange({ ...draft, repsMax: value })}
            keyboardType="number-pad"
            placeholder="-"
            placeholderTextColor={colors.textMuted}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>RIR</Text>
          <TextInput
            style={styles.fieldInput}
            value={draft.rir}
            onChangeText={(value) => onChange({ ...draft, rir: value })}
            keyboardType="number-pad"
            placeholder="-"
            placeholderTextColor={colors.textMuted}
          />
        </View>
      </View>
    </View>
  );
}

export default function TemplateEditor() {
  const router = useRouter();
  const { id, addExerciseId, addExerciseName } = useLocalSearchParams<{
    id: string;
    addExerciseId?: string;
    addExerciseName?: string;
  }>();

  const [template, setTemplate] = useState<WorkoutTemplate | null>(null);
  const [draftName, setDraftName] = useState("");
  const [exercises, setExercises] = useState<DraftExercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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

  // The picker navigates back with its choice in params; consume it once so
  // a re-render does not keep re-adding the same exercise.
  const consumedParam = useRef<string | null>(null);
  useEffect(() => {
    if (!addExerciseId || !addExerciseName) return;
    if (consumedParam.current === addExerciseId) return;
    consumedParam.current = addExerciseId;

    setExercises((current) => [
      ...current,
      { exerciseId: addExerciseId, exerciseName: addExerciseName, sets: "3", repsMin: "", repsMax: "", rir: "" },
    ]);
  }, [addExerciseId, addExerciseName]);

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

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = exercises.map(toPayload);
      if (payload.some((item) => item === null)) {
        setError("Each exercise needs a valid number of sets.");
        return;
      }
      const updated = await programsApi.setTemplateExercises(
        id,
        payload as NonNullable<(typeof payload)[number]>[],
      );
      setTemplate(updated);
      setExercises(updated.exercises.map(toDraft));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the exercises");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTemplate = () => {
    Alert.alert("Delete template?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void programsApi.deleteTemplate(id).then(() => router.back());
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!template) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error ?? "Template not found"}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen
        options={{
          title: template.name,
          headerRight: () => (
            <Pressable onPress={handleDeleteTemplate} hitSlop={8}>
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
            </Pressable>
          ),
        }}
      />

      <TextInput
        style={styles.nameInput}
        value={draftName}
        onChangeText={setDraftName}
        onBlur={() => void handleSaveName()}
        returnKeyType="done"
        maxLength={200}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

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
        style={styles.addExercise}
        onPress={() => router.push({ pathname: "/workout/exercise-picker", params: { templateId: id } })}
      >
        <Ionicons name="add" size={20} color={colors.accent} />
        <Text style={styles.addExerciseText}>Add exercise</Text>
      </Pressable>

      <Pressable style={[styles.save, saving && styles.saveDisabled]} onPress={() => void handleSave()} disabled={saving}>
        {saving ? (
          <ActivityIndicator color={colors.accentText} />
        ) : (
          <Text style={styles.saveText}>Save</Text>
        )}
      </Pressable>
    </ScrollView>
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
  nameInput: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  error: { color: colors.danger, marginBottom: spacing.md },
  empty: { color: colors.textMuted, marginBottom: spacing.md },

  row: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: "600", flex: 1, marginRight: spacing.sm },
  rowFields: { flexDirection: "row", gap: spacing.sm },
  field: { flex: 1 },
  fieldLabel: { color: colors.textMuted, fontSize: 11, marginBottom: 2 },
  fieldInput: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    textAlign: "center",
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
    marginBottom: spacing.lg,
  },
  addExerciseText: { color: colors.accent, fontSize: 16, fontWeight: "600" },

  save: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
  },
  saveDisabled: { opacity: 0.7 },
  saveText: { color: colors.accentText, fontSize: 17, fontWeight: "700" },
});
