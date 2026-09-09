/**
 * Nutrition Goals screen (Profile > Goals & Tracking > Nutrition Goals).
 *
 * The four numbers are always hand-editable — "Auto-Calculate" is a
 * shortcut that fills them in, not a mode the screen is locked into. Activity
 * level and goal live here too even though they save through PATCH /users/me
 * (see src/api/auth.ts): they directly feed the calculation, and putting them
 * on a separate screen would send the user back and forth for no reason.
 *
 * Auto-adjust (see src/nutrition/macroAutoAdjustPreference.ts) keeps
 * calories and macros mathematically linked (P*4 + C*4 + F*9 = calories)
 * while the user edits by hand, entirely client-side — no request per
 * keystroke, only Save/Generate hit the network. Two rules, and one trap:
 *   - Editing a MACRO recomputes calories from all three macros; the other
 *     two macros are left untouched.
 *   - Editing CALORIES scales all three macros by newCalories/oldCalories.
 *     Calories themselves are NEVER recomputed back from the (rounded)
 *     scaled macros afterward — typing 2400 must show 2400, not drift to
 *     2398 from rounding. The macros are the approximation here, not the
 *     number the user just typed.
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
  Switch,
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
import {
  isMacroAutoAdjustEnabled,
  setMacroAutoAdjustEnabled,
} from "../../../src/nutrition/macroAutoAdjustPreference";
import { colors, radius, spacing } from "../../../src/theme";

const ACTIVITY_LEVELS: { value: ActivityLevel; label: string; description: string }[] = [
  { value: "sedentary", label: "Sedentary", description: "Desk job, no regular exercise" },
  { value: "light", label: "Light", description: "Training 1-3 days a week" },
  { value: "moderate", label: "Moderate", description: "Training 3-5 days a week" },
  { value: "active", label: "Active", description: "Training 6-7 days a week" },
  { value: "very_active", label: "Very Active", description: "Two workouts a day, or a physical job" },
];

const GOALS: { value: NutritionGoalKind; label: string; description: string }[] = [
  { value: "cut", label: "Cut", description: "Fat loss, calorie deficit" },
  { value: "maintain", label: "Maintain", description: "Hold your current weight" },
  { value: "bulk", label: "Bulk", description: "Muscle gain, calorie surplus" },
];

// Everything the calculation needs that only Personal Details can supply —
// activity_level and nutrition_goal are picked right here instead.
const PHYSICAL_DATA_FIELDS = new Set(["weight", "height", "date_of_birth", "gender"]);

type GoalField = "calorie_goal" | "protein_goal_g" | "carb_goal_g" | "fat_goal_g";

/** Lenient, non-throwing parse for live auto-adjust math: an in-progress or
 * blank field just contributes nothing rather than blocking the other
 * fields from updating. Distinct from parseGoalField below, which is
 * intentionally strict because it gates the network call on Save. */
function toNumber(text: string): number | null {
  if (text.trim() === "") return null;
  const parsed = Number(text.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

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

/** A single choice in a vertical, described option list — used for both
 * activity level and goal. Stacked rather than side-by-side chips because
 * the description needs room to actually be readable. */
function OptionRow({
  label,
  description,
  selected,
  onPress,
  last,
}: {
  label: string;
  description: string;
  selected: boolean;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      style={[styles.optionRow, last && styles.optionRowNoBorder]}
      onPress={onPress}
    >
      <View style={[styles.optionRadio, selected && styles.optionRadioActive]}>
        {selected ? <View style={styles.optionRadioDot} /> : null}
      </View>
      <View style={styles.optionText}>
        <Text style={styles.optionLabel}>{label}</Text>
        <Text style={styles.optionDescription}>{description}</Text>
      </View>
    </Pressable>
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
  const [autoAdjust, setAutoAdjust] = useState(true);
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
    void isMacroAutoAdjustEnabled().then((value) => {
      if (!cancelled) setAutoAdjust(value);
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

  const handleToggleAutoAdjust = (value: boolean) => {
    setAutoAdjust(value);
    void setMacroAutoAdjustEnabled(value);
  };

  /** Rule A: a macro changed, so calories follow. The other two macros are
   * deliberately left alone. */
  const recomputeCalorieFromMacros = (protein: string, carb: string, fat: string) => {
    const p = toNumber(protein) ?? 0;
    const c = toNumber(carb) ?? 0;
    const f = toNumber(fat) ?? 0;
    setCalorieText(String(Math.round(p * 4 + c * 4 + f * 9)));
  };

  const handleProteinChange = (text: string) => {
    setProteinText(text);
    if (autoAdjust) recomputeCalorieFromMacros(text, carbText, fatText);
  };

  const handleCarbChange = (text: string) => {
    setCarbText(text);
    if (autoAdjust) recomputeCalorieFromMacros(proteinText, text, fatText);
  };

  const handleFatChange = (text: string) => {
    setFatText(text);
    if (autoAdjust) recomputeCalorieFromMacros(proteinText, carbText, text);
  };

  /** Rule B: calories changed, so all three macros scale by the ratio.
   * calorieText is set to exactly what was typed and nothing here ever
   * overwrites it again — see the trap warning in the file header. */
  const handleCalorieChange = (text: string) => {
    const previousCalorie = toNumber(calorieText);
    setCalorieText(text);
    if (!autoAdjust) return;

    const newCalorie = toNumber(text);
    if (newCalorie === null || previousCalorie === null || previousCalorie === 0) return;

    const ratio = newCalorie / previousCalorie;
    const p = toNumber(proteinText);
    const c = toNumber(carbText);
    const f = toNumber(fatText);
    if (p !== null) setProteinText(String(Math.round(p * ratio)));
    if (c !== null) setCarbText(String(Math.round(c * ratio)));
    if (f !== null) setFatText(String(Math.round(f * ratio)));
  };

  // Only touches the account when the selection actually changed, so a
  // Save/Generate tap with unrelated fields does not spuriously re-save it.
  const syncActivityAndGoalIfChanged = async () => {
    if (
      activityLevel === (goals?.activity_level ?? null) &&
      nutritionGoal === (goals?.nutrition_goal ?? null)
    ) {
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
      setError(err instanceof ApiError ? err.message : "Could not calculate goals. Try again.");
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

      <View style={styles.autoAdjustRow}>
        <View style={styles.autoAdjustText}>
          <Text style={styles.rowLabel}>Auto-adjust macros</Text>
          <Text style={styles.rowHint}>
            Editing one field updates the others to keep the math consistent
          </Text>
        </View>
        <Switch
          value={autoAdjust}
          onValueChange={handleToggleAutoAdjust}
          trackColor={{ false: colors.border, true: colors.accent }}
          thumbColor={colors.text}
        />
      </View>

      <View style={styles.grid}>
        <GoalInput label="Calories" unit="kcal" value={calorieText} onChangeText={handleCalorieChange} />
        <GoalInput label="Protein" unit="g" value={proteinText} onChangeText={handleProteinChange} />
        <GoalInput label="Carbs" unit="g" value={carbText} onChangeText={handleCarbChange} />
        <GoalInput label="Fat" unit="g" value={fatText} onChangeText={handleFatChange} />
      </View>

      <Text style={styles.sectionLabel}>Activity level</Text>
      <View style={styles.optionsCard}>
        {ACTIVITY_LEVELS.map((option, index) => (
          <OptionRow
            key={option.value}
            label={option.label}
            description={option.description}
            selected={activityLevel === option.value}
            onPress={() => setActivityLevel(option.value)}
            last={index === ACTIVITY_LEVELS.length - 1}
          />
        ))}
      </View>

      <Text style={styles.sectionLabel}>Goal</Text>
      <View style={styles.optionsCard}>
        {GOALS.map((option, index) => (
          <OptionRow
            key={option.value}
            label={option.label}
            description={option.description}
            selected={nutritionGoal === option.value}
            onPress={() => setNutritionGoal(option.value)}
            last={index === GOALS.length - 1}
          />
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

  autoAdjustRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  autoAdjustText: { flex: 1, marginRight: spacing.md },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: "500" },
  rowHint: { color: colors.textMuted, fontSize: 12, marginTop: 2 },

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

  optionsCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: spacing.md,
    gap: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  optionRowNoBorder: { borderBottomWidth: 0 },
  optionRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderColor: colors.border,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  optionRadioActive: { borderColor: colors.accent },
  optionRadioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  optionText: { flex: 1 },
  optionLabel: { color: colors.text, fontSize: 15, fontWeight: "600" },
  optionDescription: { color: colors.textMuted, fontSize: 13, marginTop: 2 },

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
