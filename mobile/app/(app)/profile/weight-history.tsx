/**
 * Weight History screen (Profile > Personal Details > Weight History).
 *
 * The header comes from GET /body/summary, not from the list below it: the
 * trend is "current minus the very first recorded measurement", which the
 * backend already computes, rather than something this screen should derive
 * from a possibly-truncated `limit`-bound list.
 */

import { Ionicons } from "@expo/vector-icons";
import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
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

import * as bodyApi from "../../../src/api/body";
import type { BodyMeasurement, BodySummary } from "../../../src/api/body";
import { useAuth } from "../../../src/auth/AuthContext";
import { colors, radius, spacing } from "../../../src/theme";
import {
  BODY_WEIGHT_MAX_KG,
  BODY_WEIGHT_MIN_KG,
  formatWeight,
  parseWeightInput,
  type WeightUnit,
} from "../../../src/units/weight";

function formatShortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function formatMonthYear(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
}

/** null when there is nothing meaningful to show yet: no history, or a
 * single measurement with nothing to compare against. */
function trendText(summary: BodySummary, unit: WeightUnit): string | null {
  if (summary.change_kg === null || summary.first_measured_on === null) return null;
  const changeKg = Number(summary.change_kg);
  if (changeKg === 0) return null;
  const arrow = changeKg > 0 ? "↗" : "↘";
  return `${arrow} ${formatWeight(Math.abs(changeKg), unit)} — since ${formatMonthYear(summary.first_measured_on)}`;
}

function AddWeightForm({
  unit,
  onSubmit,
  onCancel,
  saving,
}: {
  unit: WeightUnit;
  onSubmit: (weightKg: number) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [weight, setWeight] = useState("");

  const submit = () => {
    const parsedKg = parseWeightInput(weight, unit);
    if (parsedKg === null || parsedKg < BODY_WEIGHT_MIN_KG || parsedKg > BODY_WEIGHT_MAX_KG) return;
    onSubmit(parsedKg);
  };

  return (
    <View style={styles.addForm}>
      <TextInput
        style={styles.addInput}
        value={weight}
        onChangeText={setWeight}
        placeholder={unit}
        placeholderTextColor={colors.textMuted}
        keyboardType="decimal-pad"
        autoFocus
        returnKeyType="done"
        onSubmitEditing={submit}
      />
      <Pressable style={styles.addAction} onPress={onCancel} disabled={saving}>
        <Ionicons name="close" size={20} color={colors.textMuted} />
      </Pressable>
      <Pressable style={styles.addAction} onPress={submit} disabled={saving}>
        {saving ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <Ionicons name="checkmark" size={20} color={colors.accent} />
        )}
      </Pressable>
    </View>
  );
}

function MeasurementRow({
  measurement,
  unit,
  onDelete,
}: {
  measurement: BodyMeasurement;
  unit: WeightUnit;
  onDelete: (id: number) => void;
}) {
  return (
    <Pressable
      style={styles.historyRow}
      onLongPress={() =>
        Alert.alert("Delete this entry?", undefined, [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: () => onDelete(measurement.id) },
        ])
      }
    >
      <Text style={styles.historyDate}>{formatShortDate(measurement.measured_on)}</Text>
      <Text style={styles.historyWeight}>{formatWeight(Number(measurement.weight_kg), unit)}</Text>
    </Pressable>
  );
}

export default function WeightHistoryScreen() {
  const { user } = useAuth();
  const unit: WeightUnit = user?.weight_unit ?? "kg";
  const [summary, setSummary] = useState<BodySummary | null>(null);
  const [history, setHistory] = useState<BodyMeasurement[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingWeight, setAddingWeight] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [summaryResult, historyResult] = await Promise.all([
      bodyApi.fetchBodySummary(),
      bodyApi.listMeasurements(50),
    ]);
    setSummary(summaryResult);
    setHistory(historyResult.items);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      load()
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : "Could not load history");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [load]),
  );

  const handleAddWeight = async (weight: number) => {
    setSaving(true);
    setError(null);
    try {
      await bodyApi.upsertMeasurement({ weight_kg: weight });
      await load();
      setAddingWeight(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save weight");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await bodyApi.deleteMeasurement(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete entry");
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const trend = summary ? trendText(summary, unit) : null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        {summary?.last_measured_on ? (
          <Text style={styles.lastWeighIn}>
            Last weigh-in: {formatShortDate(summary.last_measured_on)}
          </Text>
        ) : null}
        <Text style={styles.currentWeight}>
          {summary?.current_weight_kg ? formatWeight(Number(summary.current_weight_kg), unit) : "—"}
        </Text>
        {trend ? <Text style={styles.trend}>{trend}</Text> : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {addingWeight ? (
        <AddWeightForm
          unit={unit}
          onSubmit={(weightKg) => void handleAddWeight(weightKg)}
          onCancel={() => setAddingWeight(false)}
          saving={saving}
        />
      ) : (
        <Pressable style={styles.logButton} onPress={() => setAddingWeight(true)}>
          <Ionicons name="add" size={18} color={colors.accentText} />
          <Text style={styles.logButtonText}>Log weight</Text>
        </Pressable>
      )}

      <View style={styles.card}>
        {history.length === 0 ? (
          <Text style={styles.empty}>No measurements yet.</Text>
        ) : (
          history.map((measurement, index) => (
            <View
              key={measurement.id}
              style={index === history.length - 1 ? undefined : styles.historyRowWrap}
            >
              <MeasurementRow
                measurement={measurement}
                unit={unit}
                onDelete={(id) => void handleDelete(id)}
              />
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },

  header: { alignItems: "center", marginBottom: spacing.lg },
  lastWeighIn: { color: colors.textMuted, fontSize: 13 },
  currentWeight: { color: colors.text, fontSize: 40, fontWeight: "800", marginTop: spacing.xs },
  trend: { color: colors.accent, fontSize: 14, fontWeight: "600", marginTop: spacing.xs },

  error: { color: colors.danger, marginBottom: spacing.md, textAlign: "center" },

  logButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  logButtonText: { color: colors.accentText, fontSize: 15, fontWeight: "700" },

  addForm: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  addInput: {
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
  addAction: { paddingHorizontal: spacing.xs },

  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  empty: { color: colors.textMuted, fontSize: 14, textAlign: "center", paddingVertical: spacing.lg },
  historyRowWrap: { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
  },
  historyDate: { color: colors.textMuted, fontSize: 14 },
  historyWeight: { color: colors.text, fontSize: 15, fontWeight: "600" },
});
