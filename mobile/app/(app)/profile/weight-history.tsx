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
import { Stack, useFocusEffect } from "expo-router";
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
import { FocusedDarkStatusBar } from "../../../src/FocusedDarkStatusBar";
import { lightHeaderOptions } from "../../../src/lightHeaderOptions";
import { light } from "../../../src/lightTheme";
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
  const [invalid, setInvalid] = useState(false);

  const submit = () => {
    if (saving) return; // a second tap or "done" while the first save runs must not send twice
    const parsedKg = parseWeightInput(weight, unit);
    if (parsedKg === null || parsedKg < BODY_WEIGHT_MIN_KG || parsedKg > BODY_WEIGHT_MAX_KG) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onSubmit(parsedKg);
  };

  return (
    <View style={styles.addFormWrap}>
      <View style={styles.addForm}>
        <TextInput
          style={styles.addInput}
          value={weight}
          onChangeText={setWeight}
          placeholder={unit}
          placeholderTextColor={light.textSecondary}
          accessibilityLabel={`Weight in ${unit}`}
          keyboardType="decimal-pad"
          autoFocus
          returnKeyType="done"
          onSubmitEditing={submit}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          style={styles.addAction}
          onPress={onCancel}
          disabled={saving}
        >
          <Ionicons name="close" size={22} color={light.textSecondary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save weight"
          accessibilityState={{ busy: saving, disabled: saving }}
          style={styles.addAction}
          onPress={submit}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color={light.text} />
          ) : (
            <Ionicons name="checkmark" size={22} color={light.text} />
          )}
        </Pressable>
      </View>
      {invalid ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.addInvalid}>
          {`Enter a weight between ${formatWeight(BODY_WEIGHT_MIN_KG, unit)} and ${formatWeight(BODY_WEIGHT_MAX_KG, unit)}.`}
        </Text>
      ) : null}
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
  const confirmDelete = () =>
    Alert.alert("Delete this entry?", undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => onDelete(measurement.id) },
    ]);
  const date = formatShortDate(measurement.measured_on);
  const weight = formatWeight(Number(measurement.weight_kg), unit);

  // Delete stays a press-and-hold with the same confirmation; screen readers
  // get the same confirmation as a named action.
  return (
    <Pressable
      accessible
      accessibilityLabel={`${date}, ${weight}`}
      accessibilityHint="Press and hold to delete this entry"
      accessibilityActions={[{ name: "delete", label: "Delete entry" }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "delete") confirmDelete();
      }}
      style={({ pressed }) => [styles.historyRow, pressed && styles.pressed]}
      onLongPress={confirmDelete}
    >
      <Text style={styles.historyDate}>{date}</Text>
      <Text style={styles.historyWeight}>{weight}</Text>
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
  // Whether any load has succeeded, and why the latest focus load failed: an
  // empty list after a failed load is "could not load", not "no measurements".
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [summaryResult, historyResult] = await Promise.all([
      bodyApi.fetchBodySummary(),
      bodyApi.listMeasurements(50),
    ]);
    setSummary(summaryResult);
    setHistory(historyResult.items);
    setHasLoaded(true);
  }, []);

  const loadOnFocus = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    load()
      .then(() => {
        if (!cancelled) setLoadError(null);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load history");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  useFocusEffect(loadOnFocus);

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

  const header = (
    <>
      <Stack.Screen options={lightHeaderOptions} />
      <FocusedDarkStatusBar />
    </>
  );

  if (loading && !hasLoaded) {
    return (
      <View style={styles.centered}>
        {header}
        <ActivityIndicator color={light.textSecondary} />
      </View>
    );
  }

  if (!hasLoaded) {
    return (
      <View style={styles.centered}>
        {header}
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.loadError}>
          {`Could not load your weight history. ${loadError ?? ""}`.trim()}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Try loading your weight history again"
          style={({ pressed }) => [styles.logButton, styles.retryButton, pressed && styles.logButtonPressed]}
          onPress={() => void loadOnFocus()}
        >
          <Text style={styles.logButtonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const trend = summary ? trendText(summary, unit) : null;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {header}
      {loadError ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>
          {`Could not refresh. Showing the last loaded entries. ${loadError}`}
        </Text>
      ) : null}
      <View style={styles.header}>
        {summary?.last_measured_on ? (
          <Text style={styles.lastWeighIn}>
            Last weigh-in: {formatShortDate(summary.last_measured_on)}
          </Text>
        ) : null}
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          accessibilityLabel={
            summary?.current_weight_kg
              ? `Current weight ${formatWeight(Number(summary.current_weight_kg), unit)}`
              : "No current weight"
          }
          style={styles.currentWeight}
        >
          {summary?.current_weight_kg ? formatWeight(Number(summary.current_weight_kg), unit) : "—"}
        </Text>
        {trend ? <Text style={styles.trend}>{trend}</Text> : null}
      </View>

      {error ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : null}

      {addingWeight ? (
        <AddWeightForm
          unit={unit}
          onSubmit={(weightKg) => void handleAddWeight(weightKg)}
          onCancel={() => setAddingWeight(false)}
          saving={saving}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Log weight"
          style={({ pressed }) => [styles.logButton, pressed && styles.logButtonPressed]}
          onPress={() => setAddingWeight(true)}
        >
          <Ionicons name="add" size={18} color={light.onPrimary} />
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
      {history.length > 0 ? (
        <Text style={styles.deleteHint}>Press and hold an entry to delete it.</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background },
  content: { padding: 16, paddingBottom: 32 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    backgroundColor: light.background,
  },
  pressed: { backgroundColor: light.pressed },

  header: { alignItems: "center", marginBottom: 24 },
  lastWeighIn: { color: light.textSecondary, fontSize: 13 },
  currentWeight: {
    color: light.text,
    fontSize: 40,
    fontWeight: "700",
    marginTop: 4,
    maxWidth: "100%",
  },
  trend: { color: light.textSecondary, fontSize: 14, marginTop: 4, textAlign: "center" },

  error: { color: light.danger, fontSize: 14, lineHeight: 20, marginBottom: 16, textAlign: "center" },
  loadError: {
    color: light.danger,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 16,
  },

  logButton: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: light.primary,
    borderRadius: 14,
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  logButtonPressed: { backgroundColor: light.primaryPressed },
  retryButton: { alignSelf: "stretch", marginBottom: 0 },
  logButtonText: { color: light.onPrimary, fontSize: 16, fontWeight: "600" },

  addFormWrap: { marginBottom: 24 },
  addForm: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: light.surface,
    borderRadius: 12,
    padding: 8,
  },
  addInput: {
    flex: 1,
    minHeight: 44,
    backgroundColor: light.background,
    borderRadius: 10,
    color: light.text,
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  addAction: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  addInvalid: { color: light.danger, fontSize: 13, lineHeight: 18, marginTop: 8, marginLeft: 4 },

  card: {
    backgroundColor: light.surface,
    borderRadius: 12,
    overflow: "hidden",
  },
  empty: { color: light.textSecondary, fontSize: 14, textAlign: "center", paddingVertical: 24 },
  historyRowWrap: { borderBottomColor: light.separator, borderBottomWidth: StyleSheet.hairlineWidth },
  historyRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  historyDate: { color: light.textSecondary, fontSize: 15 },
  historyWeight: { color: light.text, fontSize: 16, fontWeight: "600" },
  deleteHint: { color: light.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 12, marginLeft: 4 },
});
