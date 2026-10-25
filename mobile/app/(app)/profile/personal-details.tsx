/**
 * Personal Details screen (Profile > Personal Details).
 *
 * Current weight is a different kind of field from the other three: height,
 * date of birth and gender live on the user row and are edited through
 * PATCH /users/me, but weight has no column of its own — changing it here
 * appends a new body_measurements row (PUT /body/measurements) instead of
 * overwriting a single value, so a weigh-in made here also feeds the Weight
 * History screen's trend rather than being a second, disconnected place
 * weight is tracked.
 */

import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
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

import type { Gender, UserUpdateInput } from "../../../src/api/auth";
import { updateMe } from "../../../src/api/auth";
import * as bodyApi from "../../../src/api/body";
import type { BodySummary } from "../../../src/api/body";
import { useAuth } from "../../../src/auth/AuthContext";
import { FocusedDarkStatusBar } from "../../../src/FocusedDarkStatusBar";
import { lightHeaderOptions } from "../../../src/lightHeaderOptions";
import { light } from "../../../src/lightTheme";
import {
  bodyWeightRangeLabel,
  BODY_WEIGHT_MAX_KG,
  BODY_WEIGHT_MIN_KG,
  formatWeight,
  formatWeightValue,
  parseWeightInput,
  type WeightUnit,
} from "../../../src/units/weight";

type Field = "weight" | "height" | "dob" | "gender" | "goal" | null;

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

function genderLabel(value: Gender | null): string {
  return GENDER_OPTIONS.find((option) => option.value === value)?.label ?? "—";
}

/** "2002-05-14" -> {day: "14", month: "05", year: "2002"}. */
function splitDate(iso: string | null): { day: string; month: string; year: string } {
  if (!iso) return { day: "", month: "", year: "" };
  const [year, month, day] = iso.split("-");
  return { day, month, year };
}

function formatDob(iso: string | null): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Builds an ISO date from three text fields, or null if any part is invalid. */
function buildIsoDate(day: string, month: string, year: string): string | null {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (!Number.isInteger(d) || d < 1 || d > 31) return null;
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  if (!Number.isInteger(y) || y < 1900 || y > new Date().getFullYear()) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function EditActions({
  saving,
  onCancel,
  onSave,
}: {
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <View style={styles.editActions}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cancel"
        onPress={onCancel}
        style={styles.editAction}
        disabled={saving}
      >
        <Ionicons name="close" size={22} color={light.textSecondary} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Save"
        accessibilityState={{ busy: saving, disabled: saving }}
        onPress={onSave}
        style={styles.editAction}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator size="small" color={light.text} />
        ) : (
          <Ionicons name="checkmark" size={22} color={light.text} />
        )}
      </Pressable>
    </View>
  );
}

/** A row that swaps its read-only value for `children` (an inline edit form)
 * when active — the same tap-to-edit shape as a logged set on the workout
 * screen, applied here to a profile field instead of a set. */
function Row({
  label,
  value,
  editing,
  onPress,
  children,
  last,
}: {
  label: string;
  value: string;
  editing: boolean;
  onPress: () => void;
  children: React.ReactNode;
  last?: boolean;
}) {
  if (editing) {
    return (
      <View style={[styles.row, styles.rowEditing, last && styles.rowNoBorder]}>
        <Text style={styles.rowLabel}>{label}</Text>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      accessibilityHint="Edit"
      style={({ pressed }) => [styles.row, last && styles.rowNoBorder, pressed && styles.pressed]}
      onPress={onPress}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </Pressable>
  );
}

export default function PersonalDetailsScreen() {
  const { user, refreshProfile } = useAuth();
  const router = useRouter();

  const [summary, setSummary] = useState<BodySummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  // A failed request is not "no weight recorded": it gets its own value text and a retry.
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [editing, setEditing] = useState<Field>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [weightDraft, setWeightDraft] = useState("");
  const [heightDraft, setHeightDraft] = useState("");
  const [goalDraft, setGoalDraft] = useState("");
  const [dobDay, setDobDay] = useState("");
  const [dobMonth, setDobMonth] = useState("");
  const [dobYear, setDobYear] = useState("");

  const loadSummary = () => {
    setLoadingSummary(true);
    setSummaryFailed(false);
    bodyApi
      .fetchBodySummary()
      .then(setSummary)
      .catch(() => setSummaryFailed(true))
      .finally(() => setLoadingSummary(false));
  };

  useEffect(() => {
    let cancelled = false;
    bodyApi.fetchBodySummary()
      .then((data) => { if (!cancelled) setSummary(data); })
      .catch(() => { if (!cancelled) setSummaryFailed(true); })
      .finally(() => { if (!cancelled) setLoadingSummary(false); });
    return () => { cancelled = true; };
  }, []);

  if (!user) return null;

  const unit: WeightUnit = user.weight_unit;

  const startEditing = (field: Exclude<Field, null>) => {
    setError(null);
    if (field === "weight") {
      setWeightDraft(
        summary?.current_weight_kg ? formatWeightValue(Number(summary.current_weight_kg), unit) : "",
      );
    }
    if (field === "height") setHeightDraft(user.height_cm ?? "");
    if (field === "goal") {
      setGoalDraft(user.goal_weight_kg ? formatWeightValue(Number(user.goal_weight_kg), unit) : "");
    }
    if (field === "dob") {
      const parts = splitDate(user.date_of_birth);
      setDobDay(parts.day);
      setDobMonth(parts.month);
      setDobYear(parts.year);
    }
    setEditing(field);
  };

  const cancelEditing = () => {
    setEditing(null);
    setError(null);
  };

  const savePatch = async (changes: UserUpdateInput) => {
    setSaving(true);
    setError(null);
    try {
      await updateMe(changes);
      await refreshProfile();
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save changes");
    } finally {
      setSaving(false);
    }
  };

  const saveWeight = async () => {
    const parsedKg = parseWeightInput(weightDraft, unit);
    if (parsedKg === null || parsedKg < BODY_WEIGHT_MIN_KG || parsedKg > BODY_WEIGHT_MAX_KG) {
      setError(`Enter a weight between ${bodyWeightRangeLabel(unit)}.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await bodyApi.upsertMeasurement({ weight_kg: parsedKg });
      loadSummary();
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save weight");
    } finally {
      setSaving(false);
    }
  };

  const saveHeight = async () => {
    const parsed = Number(heightDraft.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 50 || parsed > 300) {
      setError("Enter a height between 50 and 300 cm.");
      return;
    }
    await savePatch({ height_cm: parsed });
  };

  const saveGoalWeight = async () => {
    const parsedKg = parseWeightInput(goalDraft, unit);
    if (parsedKg === null || parsedKg < BODY_WEIGHT_MIN_KG || parsedKg > BODY_WEIGHT_MAX_KG) {
      setError(`Enter a weight between ${bodyWeightRangeLabel(unit)}.`);
      return;
    }
    await savePatch({ goal_weight_kg: parsedKg });
  };

  const saveDob = async () => {
    const iso = buildIsoDate(dobDay, dobMonth, dobYear);
    if (!iso) {
      setError("Enter a valid date.");
      return;
    }
    await savePatch({ date_of_birth: iso });
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={lightHeaderOptions} />
      <FocusedDarkStatusBar />
      <View style={styles.goalCard}>
        <View style={styles.goalText}>
          <Text style={styles.goalLabel}>Goal weight</Text>
          {editing === "goal" ? (
            <View style={styles.inlineForm}>
              <TextInput
                style={styles.inlineInput}
                value={goalDraft}
                onChangeText={setGoalDraft}
                accessibilityLabel={`Goal weight in ${unit}`}
                keyboardType="decimal-pad"
                autoFocus
                selectTextOnFocus
              />
              <Text style={styles.unit}>{unit}</Text>
            </View>
          ) : (
            <Text style={styles.goalValue}>
              {user.goal_weight_kg ? formatWeight(Number(user.goal_weight_kg), unit) : "—"}
            </Text>
          )}
        </View>
        {editing === "goal" ? (
          <EditActions saving={saving} onCancel={cancelEditing} onSave={() => void saveGoalWeight()} />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change goal weight"
            onPress={() => startEditing("goal")}
            style={styles.changeButton}
          >
            <Text style={styles.changeLink}>Change</Text>
          </Pressable>
        )}
      </View>

      {error ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : null}

      <View style={styles.card}>
        <Row
          label="Current weight"
          value={
            loadingSummary
              ? "…"
              : summaryFailed && !summary
                ? "Unavailable"
                : summary?.current_weight_kg
                  ? formatWeight(Number(summary.current_weight_kg), unit)
                  : "—"
          }
          editing={editing === "weight"}
          onPress={() => startEditing("weight")}
        >
          <View style={styles.inlineForm}>
            <TextInput
              style={styles.inlineInput}
              value={weightDraft}
              onChangeText={setWeightDraft}
              accessibilityLabel={`Current weight in ${unit}`}
              keyboardType="decimal-pad"
              autoFocus
              selectTextOnFocus
            />
            <Text style={styles.unit}>{unit}</Text>
            <EditActions saving={saving} onCancel={cancelEditing} onSave={() => void saveWeight()} />
          </View>
        </Row>

        <Row
          label="Height"
          value={user.height_cm ? `${user.height_cm} cm` : "—"}
          editing={editing === "height"}
          onPress={() => startEditing("height")}
        >
          <View style={styles.inlineForm}>
            <TextInput
              style={styles.inlineInput}
              value={heightDraft}
              onChangeText={setHeightDraft}
              accessibilityLabel="Height in centimetres"
              keyboardType="decimal-pad"
              autoFocus
              selectTextOnFocus
            />
            <Text style={styles.unit}>cm</Text>
            <EditActions saving={saving} onCancel={cancelEditing} onSave={() => void saveHeight()} />
          </View>
        </Row>

        <Row
          label="Date of birth"
          value={formatDob(user.date_of_birth)}
          editing={editing === "dob"}
          onPress={() => startEditing("dob")}
        >
          <View style={styles.inlineForm}>
            <TextInput
              style={styles.dateInput}
              value={dobDay}
              onChangeText={setDobDay}
              accessibilityLabel="Day of birth"
              placeholder="DD"
              placeholderTextColor={light.textSecondary}
              keyboardType="number-pad"
              maxLength={2}
              autoFocus
            />
            <TextInput
              style={styles.dateInput}
              value={dobMonth}
              onChangeText={setDobMonth}
              accessibilityLabel="Month of birth"
              placeholder="MM"
              placeholderTextColor={light.textSecondary}
              keyboardType="number-pad"
              maxLength={2}
            />
            <TextInput
              style={styles.dateInputYear}
              value={dobYear}
              onChangeText={setDobYear}
              accessibilityLabel="Year of birth"
              placeholder="YYYY"
              placeholderTextColor={light.textSecondary}
              keyboardType="number-pad"
              maxLength={4}
            />
            <EditActions saving={saving} onCancel={cancelEditing} onSave={() => void saveDob()} />
          </View>
        </Row>

        <Row
          label="Gender"
          value={genderLabel(user.gender)}
          editing={editing === "gender"}
          onPress={() => startEditing("gender")}
          last
        >
          <View style={styles.genderOptions}>
            {GENDER_OPTIONS.map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityLabel={`Gender ${option.label}`}
                accessibilityState={{ selected: user.gender === option.value, disabled: saving }}
                style={[styles.genderChip, user.gender === option.value && styles.genderChipActive]}
                onPress={() => void savePatch({ gender: option.value })}
                disabled={saving}
              >
                <Text
                  style={[
                    styles.genderChipText,
                    user.gender === option.value && styles.genderChipTextActive,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              onPress={cancelEditing}
              style={styles.genderCancel}
              disabled={saving}
            >
              <Ionicons name="close" size={22} color={light.textSecondary} />
            </Pressable>
          </View>
        </Row>
      </View>

      {summaryFailed && !loadingSummary ? (
        <View style={styles.summaryError}>
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.summaryErrorText}>
            {summary
              ? "Could not refresh your current weight. Showing the last loaded value."
              : "Could not load your current weight."}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try loading your current weight again"
            style={styles.retryButton}
            onPress={loadSummary}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="View weight history"
        style={({ pressed }) => [styles.historyLink, pressed && styles.pressed]}
        onPress={() => router.push("/profile/weight-history")}
      >
        <Ionicons name="trending-up" size={22} color={light.textSecondary} />
        <Text style={styles.historyLinkText}>View weight history</Text>
        <Ionicons name="chevron-forward" size={18} color={light.textSecondary} />
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background },
  content: { padding: 16, paddingBottom: 32 },
  pressed: { backgroundColor: light.pressed },

  goalCard: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: 12,
    backgroundColor: light.surface,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  goalText: { flex: 1 },
  goalLabel: { color: light.textSecondary, fontSize: 13 },
  goalValue: { color: light.text, fontSize: 22, fontWeight: "700", marginTop: 4 },
  changeButton: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
  changeLink: { color: light.text, fontSize: 15, fontWeight: "600", textDecorationLine: "underline" },

  error: { color: light.danger, fontSize: 14, lineHeight: 20, marginBottom: 16 },

  card: {
    backgroundColor: light.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    overflow: "hidden",
  },
  row: {
    minHeight: 56,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: 12,
    paddingVertical: 12,
    borderBottomColor: light.separator,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowEditing: { flexDirection: "column", alignItems: "stretch", rowGap: 8 },
  rowNoBorder: { borderBottomWidth: 0 },
  rowLabel: { color: light.textSecondary, fontSize: 15 },
  rowValue: { flexShrink: 1, color: light.text, fontSize: 16, textAlign: "right" },

  inlineForm: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  inlineInput: {
    flex: 1,
    minWidth: 80,
    minHeight: 44,
    backgroundColor: light.background,
    borderRadius: 10,
    color: light.text,
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  unit: { color: light.textSecondary, fontSize: 14 },
  dateInput: {
    width: 56,
    minHeight: 44,
    backgroundColor: light.background,
    borderRadius: 10,
    color: light.text,
    fontSize: 16,
    paddingHorizontal: 8,
    paddingVertical: 8,
    textAlign: "center",
  },
  dateInputYear: {
    width: 72,
    minHeight: 44,
    backgroundColor: light.background,
    borderRadius: 10,
    color: light.text,
    fontSize: 16,
    paddingHorizontal: 8,
    paddingVertical: 8,
    textAlign: "center",
  },
  editActions: { flexDirection: "row", marginLeft: "auto" },
  editAction: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },

  genderOptions: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  genderChip: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: light.background,
    borderRadius: 10,
    paddingHorizontal: 14,
  },
  genderChipActive: { backgroundColor: light.primary },
  genderChipText: { color: light.text, fontSize: 14, fontWeight: "600" },
  genderChipTextActive: { color: light.onPrimary },
  genderCancel: { width: 44, height: 44, marginLeft: "auto", alignItems: "center", justifyContent: "center" },

  summaryError: { marginTop: 12, marginLeft: 4 },
  summaryErrorText: { color: light.danger, fontSize: 13, lineHeight: 18 },
  retryButton: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center" },
  retryText: { color: light.text, fontSize: 15, fontWeight: "600", textDecorationLine: "underline" },

  historyLink: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 12,
    backgroundColor: light.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    marginTop: 16,
    overflow: "hidden",
  },
  historyLinkText: { flex: 1, color: light.text, fontSize: 16 },
});
