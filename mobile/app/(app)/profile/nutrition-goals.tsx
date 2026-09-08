/**
 * Nutrition Goals screen (Profile > Goals & Tracking > Nutrition Goals).
 *
 * The four numbers are always hand-editable — "Auto-Calculate" is a
 * shortcut that fills them in, not a mode the screen is locked into. Activity
 * level and goal live here too even though they save through PATCH /users/me
 * (see src/api/auth.ts): they directly feed the calculation, and putting them
 * on a separate screen would send the user back and forth for no reason.
 *
 * No nutrition TRACKING here by design (see CLAUDE.md backlog) — this screen
 * only ever sets a target, never logs what was eaten against it.
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

import type { ActivityLevel } from "../../../src/api/auth";
import { updateMe } from "../../../src/api/auth";
import { ApiError } from "../../../src/api/client";
import type { NutritionGoalKind, NutritionGoals } from "../../../src/api/nutrition";
import {
  fetchNutritionGoals,
  generateNutritionGoals,
  updateNutritionGoals,
} from "../../../src/api/nutrition";
import { useAuth } from "../../../src/auth/AuthContext";
import { colors, radius, spacing } from "../../../src/theme";

const ACTIVITY_LEVELS: { value: ActivityLevel; label: string }[] = [
  { value: "sedentary", label: "Sedentary" },
  { value: "light", label: "Light" },
  { value: "moderate", label: "Moderate" },
  { value: "active", label: "Active" },
  { value: "very_active", label: "Very Active" },
];

const GOALS: { value: NutritionGoalKind; label: string }[] = [
  { value: "cut", label: "Cut" },
  { value: "maintain", label: "Maintain" },
  { value: "bulk", label: "Bulk" },
];

// Everything the calculation needs that only Personal Details can supply —
// activity_level and nutrition_goal are picked right here instead.
const PHYSICAL_DATA_FIELDS = new Set(["weight", "height", "date_of_birth", "gender"]);

type GoalField = "calorie_goal" | "protein_goal_g" | "carb_goal_g" | "fat_goal_g";

/** "" means "leave blank" (null). Anything else must parse, or the field is
 * rejected before a network call is made. */
function parseGoalField(text: string, label: string): number | null {
  if (text.trim() === "") return null;
  const parsed = Number(text.replace(",", "."));
  if (!Number.isFinite(parsed)) throw new Error(`Enter a valid ${label}.`);
  return Math.round(parsed);
}

function GoalInput({
  label,
  unit,
  value,
  onChangeText,
}: {
  label: string;
  unit: string;
  value: string;
  onChangeText: (text: string) => void;
}) {
  return (
    <View style={styles.goalField}>
      <Text style={styles.goalLabel}>{label}</Text>
      <View style={styles.goalInputRow}>
        <TextInput
          style={styles.goalInput}
          value={value}
          onChangeText={onChangeText}
          keyboardType="number-pad"
          placeholder="—"
          placeholderTextColor={colors.textMuted}
        />
        <Text style={styles.goalUnit}>{unit}</Text>
      </View>
    </View>
  );
}

export default function NutritionGoalsScreen() {
  const { user, refreshProfile } = useAuth();
  const router = useRouter();

  const [goals, setGoals] = useState<NutritionGoals | null>(null);
  const [loading, setLoading] = useState(true);
  const [calorieText, setCalorieText] = useState("");
  const [proteinText, setProteinText] = useState("");
  const [carbText, setCarbText] = useState("");
  const [fatText, setFatText] = useState("");
  const [activityLevel, setActivityLevel] = useState<ActivityLevel | null>(null);
  const [nutritionGoal, setNutritionGoal] = useState<NutritionGoalKind | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyGoals = (next: NutritionGoals) => {
    setGoals(next);
    setCalorieText(next.calorie_goal?.toString() ?? "");
    setProteinText(next.protein_goal_g?.toString() ?? "");
    setCarbText(next.carb_goal_g?.toString() ?? "");
    setFatText(next.fat_goal_g?.toString() ?? "");
    setActivityLevel(next.activity_level);
    setNutritionGoal(next.nutrition_goal);
  };

  useEffect(() => {
    let cancelled = false;
    fetchNutritionGoals()
      .then((next) => {
        if (!cancelled) applyGoals(next);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load goals");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!user || loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const physicalDataMissing = (goals?.missing_for_calculation ?? []).some((field) =>
    PHYSICAL_DATA_FIELDS.has(field),
  );
  const canGenerate = !physicalDataMissing && activityLevel !== null && nutritionGoal !== null;

  // Only touches the account when the selection actually changed, so a
  // Save/Generate tap with unrelated fields does not spuriously re-save it.
  const syncActivityAndGoalIfChanged = async () => {
    if (activityLevel === (goals?.activity_level ?? null) && nutritionGoal === (goals?.nutrition_goal ?? null)) {
      return;
    }
    await updateMe({ activity_level: activityLevel, nutrition_goal: nutritionGoal });
    await refreshProfile();
  };

  const handleGenerate = async () => {
    setError(null);
    setGenerating(true);
    try {
      await syncActivityAndGoalIfChanged();
      applyGoals(await generateNutritionGoals());
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not calculate goals. Try again.",
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    setError(null);
    let changes: Partial<Record<GoalField, number | null>>;
    try {
      changes = {
        calorie_goal: parseGoalField(calorieText, "calorie goal"),
        protein_goal_g: parseGoalField(proteinText, "protein goal"),
        carb_goal_g: parseGoalField(carbText, "carb goal"),
        fat_goal_g: parseGoalField(fatText, "fat goal"),
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enter valid numbers.");
      return;
    }

    setSaving(true);
    try {
      await syncActivityAndGoalIfChanged();
      applyGoals(await updateNutritionGoals(changes));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save goals");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.grid}>
        <GoalInput label="Calories" unit="kcal" value={calorieText} onChangeText={setCalorieText} />
        <GoalInput label="Protein" unit="g" value={proteinText} onChangeText={setProteinText} />
        <GoalInput label="Carbs" unit="g" value={carbText} onChangeText={setCarbText} />
        <GoalInput label="Fat" unit="g" value={fatText} onChangeText={setFatText} />
      </View>

      <Text style={styles.sectionLabel}>Activity level</Text>
      <View style={styles.chipGroup}>
        {ACTIVITY_LEVELS.map((option) => (
          <Pressable
            key={option.value}
            style={[styles.chip, activityLevel === option.value && styles.chipActive]}
            onPress={() => setActivityLevel(option.value)}
          >
            <Text style={[styles.chipText, activityLevel === option.value && styles.chipTextActive]}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionLabel}>Goal</Text>
      <View style={styles.chipGroup}>
        {GOALS.map((option) => (
          <Pressable
            key={option.value}
            style={[styles.chip, nutritionGoal === option.value && styles.chipActive]}
            onPress={() => setNutritionGoal(option.value)}
          >
            <Text style={[styles.chipText, nutritionGoal === option.value && styles.chipTextActive]}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {physicalDataMissing ? (
        <View style={styles.warning}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.textMuted} />
          <Text style={styles.warningText}>
            Auto-calculation needs your height, weight and date of birth on file.
          </Text>
          <Pressable onPress={() => router.push("/profile/personal-details")} hitSlop={8}>
            <Text style={styles.warningLink}>Go to Personal Details</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          style={[styles.generateButton, (!canGenerate || generating) && styles.buttonDisabled]}
          onPress={() => void handleGenerate()}
          disabled={!canGenerate || generating}
        >
          {generating ? (
            <ActivityIndicator color={colors.accentText} />
          ) : (
            <Text style={styles.generateButtonText}>Auto-Calculate</Text>
          )}
        </Pressable>
      )}

      <Pressable
        style={[styles.saveButton, saving && styles.buttonDisabled]}
        onPress={() => void handleSave()}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color={colors.text} />
        ) : (
          <Text style={styles.saveButtonText}>Save</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  error: { color: colors.danger, marginBottom: spacing.md },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  goalField: {
    flexBasis: "47%",
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  goalLabel: { color: colors.textMuted, fontSize: 12, marginBottom: spacing.xs },
  goalInputRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.xs },
  goalInput: {
    flex: 1,
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    padding: 0,
  },
  goalUnit: { color: colors.textMuted, fontSize: 13 },

  sectionLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  chipGroup: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: colors.accentText },

  warning: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.lg,
    gap: spacing.xs,
  },
  warningText: { color: colors.textMuted, fontSize: 13 },
  warningLink: { color: colors.accent, fontSize: 13, fontWeight: "600" },

  generateButton: {
    backgroundColor: colors.surface,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  generateButtonText: { color: colors.accent, fontSize: 16, fontWeight: "700" },

  saveButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    marginTop: spacing.md,
  },
  buttonDisabled: { opacity: 0.5 },
  saveButtonText: { color: colors.accentText, fontSize: 16, fontWeight: "700" },
});
