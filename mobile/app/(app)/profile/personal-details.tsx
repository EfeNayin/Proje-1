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

import type { Gender, UserUpdateInput } from "../../../src/api/auth";
import { updateMe } from "../../../src/api/auth";
import * as bodyApi from "../../../src/api/body";
import type { BodySummary } from "../../../src/api/body";
import { useAuth } from "../../../src/auth/AuthContext";
import { colors, radius, spacing } from "../../../src/theme";

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
      <Pressable onPress={onCancel} hitSlop={8} style={styles.editAction} disabled={saving}>
        <Ionicons name="close" size={20} color={colors.textMuted} />
      </Pressable>
      <Pressable onPress={onSave} hitSlop={8} style={styles.editAction} disabled={saving}>
        {saving ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <Ionicons name="checkmark" size={20} color={colors.accent} />
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
    <Pressable style={[styles.row, last && styles.rowNoBorder]} onPress={onPress}>
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
    bodyApi
      .fetchBodySummary()
      .then(setSummary)
      .catch(() => undefined)
      .finally(() => setLoadingSummary(false));
  };

  useEffect(() => {
    let cancelled = false;
    bodyApi.fetchBodySummary()
      .then((data) => { if (!cancelled) setSummary(data); })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setLoadingSummary(false); });
    return () => { cancelled = true; };
  }, []);

  if (!user) return null;

  const startEditing = (field: Exclude<Field, null>) => {
    setError(null);
    if (field === "weight") setWeightDraft(summary?.current_weight_kg ?? "");
    if (field === "height") setHeightDraft(user.height_cm ?? "");
    if (field === "goal") setGoalDraft(user.goal_weight_kg ?? "");
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
    const parsed = Number(weightDraft.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 20 || parsed > 400) {
      setError("Enter a weight between 20 and 400 kg.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await bodyApi.upsertMeasurement({ weight_kg: parsed });
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
    const parsed = Number(goalDraft.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 20 || parsed > 400) {
      setError("Enter a weight between 20 and 400 kg.");
      return;
    }
    await savePatch({ goal_weight_kg: parsed });
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
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.goalCard}>
        <View style={styles.goalText}>
          <Text style={styles.goalLabel}>Goal Weight</Text>
          {editing === "goal" ? (
            <View style={styles.inlineForm}>
              <TextInput
                style={styles.inlineInput}
                value={goalDraft}
                onChangeText={setGoalDraft}
                keyboardType="decimal-pad"
                autoFocus
                selectTextOnFocus
              />
              <Text style={styles.unit}>kg</Text>
            </View>
          ) : (
            <Text style={styles.goalValue}>
              {user.goal_weight_kg ? `${user.goal_weight_kg} kg` : "—"}
            </Text>
          )}
        </View>
        {editing === "goal" ? (
          <EditActions saving={saving} onCancel={cancelEditing} onSave={() => void saveGoalWeight()} />
        ) : (
          <Pressable onPress={() => startEditing("goal")} hitSlop={8}>
            <Text style={styles.changeLink}>Change</Text>
          </Pressable>
        )}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.card}>
        <Row
          label="Current weight"
          value={
            loadingSummary
              ? "…"
              : summary?.current_weight_kg
                ? `${summary.current_weight_kg} kg`
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
              keyboardType="decimal-pad"
              autoFocus
              selectTextOnFocus
            />
            <Text style={styles.unit}>kg</Text>
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
              placeholder="DD"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              maxLength={2}
              autoFocus
            />
            <TextInput
              style={styles.dateInput}
              value={dobMonth}
              onChangeText={setDobMonth}
              placeholder="MM"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              maxLength={2}
            />
            <TextInput
              style={styles.dateInputYear}
              value={dobYear}
              onChangeText={setDobYear}
              placeholder="YYYY"
              placeholderTextColor={colors.textMuted}
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
            <Pressable onPress={cancelEditing} hitSlop={8} style={styles.genderCancel} disabled={saving}>
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </Pressable>
          </View>
        </Row>
      </View>

      <Pressable style={styles.historyLink} onPress={() => router.push("/profile/weight-history")}>
        <Ionicons name="trending-up" size={18} color={colors.accent} />
        <Text style={styles.historyLinkText}>View weight history</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl },

  goalCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  goalText: { flex: 1 },
  goalLabel: { color: colors.textMuted, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 },
  goalValue: { color: colors.text, fontSize: 22, fontWeight: "700", marginTop: 4 },
  changeLink: { color: colors.accent, fontSize: 14, fontWeight: "600" },

  error: { color: colors.danger, marginBottom: spacing.md },

  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowEditing: { flexDirection: "column", alignItems: "stretch", gap: spacing.sm },
  rowNoBorder: { borderBottomWidth: 0 },
  rowLabel: { color: colors.textMuted, fontSize: 14 },
  rowValue: { color: colors.text, fontSize: 15, fontWeight: "500" },

  inlineForm: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  inlineInput: {
    flex: 1,
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  unit: { color: colors.textMuted, fontSize: 13 },
  dateInput: {
    width: 52,
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    textAlign: "center",
  },
  dateInputYear: {
    width: 68,
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    textAlign: "center",
  },
  editActions: { flexDirection: "row", marginLeft: "auto", gap: spacing.xs },
  editAction: { paddingHorizontal: spacing.xs },

  genderOptions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, alignItems: "center" },
  genderChip: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  genderChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  genderChipText: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  genderChipTextActive: { color: colors.accentText },
  genderCancel: { marginLeft: "auto", padding: spacing.xs },

  historyLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  historyLinkText: { flex: 1, color: colors.text, fontSize: 15, fontWeight: "600" },
});
