/**
 * Preferences screen (Profile > Preferences).
 *
 * Three independent settings, each backed by whatever already stored it
 * before this screen existed — no new storage introduced here:
 * - Weight unit: users.weight_unit on the server, via PATCH /users/me.
 * - Default rest: src/workout/restPreference.ts, on-device, same store the
 *   workout screen's rest picker already reads and writes.
 * - Readiness check-in: src/workout/readinessPreference.ts, on-device, same
 *   store the training home screen already reads to decide whether to route
 *   through the check-in screen before a workout.
 */

import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import { updateMe } from "../../../src/api/auth";
import { useAuth } from "../../../src/auth/AuthContext";
import { colors, radius, spacing } from "../../../src/theme";
import {
  isReadinessCheckinEnabled,
  setReadinessCheckinEnabled,
} from "../../../src/workout/readinessPreference";
import { formatRest, getRestSeconds, REST_PRESETS, setRestSeconds } from "../../../src/workout/restPreference";

const WEIGHT_UNITS = [
  { value: "kg", label: "kg" },
  { value: "lb", label: "lb" },
] as const;

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export default function PreferencesScreen() {
  const { user, refreshProfile } = useAuth();

  const [savingUnit, setSavingUnit] = useState(false);
  const [restSeconds, setRestSecondsState] = useState<number | null>(null);
  const [checkinEnabled, setCheckinEnabled] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void getRestSeconds().then((value) => {
      if (!cancelled) setRestSecondsState(value);
    });
    void isReadinessCheckinEnabled().then((value) => {
      if (!cancelled) setCheckinEnabled(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelectUnit = async (unit: "kg" | "lb") => {
    if (!user || user.weight_unit === unit || savingUnit) return;
    setSavingUnit(true);
    try {
      await updateMe({ weight_unit: unit });
      await refreshProfile();
    } catch {
      // The chip simply stays on the previous value; nothing else depends on
      // this call succeeding immediately.
    } finally {
      setSavingUnit(false);
    }
  };

  const handleSelectRest = (seconds: number) => {
    setRestSecondsState(seconds);
    void setRestSeconds(seconds);
  };

  const handleToggleCheckin = (value: boolean) => {
    setCheckinEnabled(value);
    void setReadinessCheckinEnabled(value);
  };

  if (!user) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <SectionLabel>Weight unit</SectionLabel>
      <View style={[styles.card, styles.row]}>
        <View style={styles.rowText}>
          <Text style={styles.rowLabel}>Units</Text>
          <Text style={styles.rowHint}>Display only — existing values are not converted</Text>
        </View>
        <View style={styles.chipGroup}>
          {WEIGHT_UNITS.map((option) => (
            <Pressable
              key={option.value}
              style={[styles.chip, user.weight_unit === option.value && styles.chipActive]}
              onPress={() => void handleSelectUnit(option.value)}
              disabled={savingUnit}
            >
              <Text
                style={[
                  styles.chipText,
                  user.weight_unit === option.value && styles.chipTextActive,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <SectionLabel>Default rest</SectionLabel>
      <View style={[styles.card, styles.presetCard]}>
        {restSeconds === null ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <View style={styles.chipGroup}>
            {REST_PRESETS.map((seconds) => (
              <Pressable
                key={seconds}
                style={[styles.chip, restSeconds === seconds && styles.chipActive]}
                onPress={() => handleSelectRest(seconds)}
              >
                <Text style={[styles.chipText, restSeconds === seconds && styles.chipTextActive]}>
                  {formatRest(seconds)}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      <SectionLabel>Workouts</SectionLabel>
      <View style={[styles.card, styles.row, styles.rowNoBorder]}>
        <View style={styles.rowText}>
          <Text style={styles.rowLabel}>Readiness check-in</Text>
          <Text style={styles.rowHint}>Ask about sleep and soreness before each workout</Text>
        </View>
        <Switch
          value={checkinEnabled}
          onValueChange={handleToggleCheckin}
          trackColor={{ false: colors.border, true: colors.accent }}
          thumbColor={colors.text}
        />
      </View>
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
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  presetCard: { paddingVertical: spacing.md },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
  },
  rowNoBorder: { borderBottomWidth: 0 },
  rowText: { flex: 1, marginRight: spacing.md },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: "500" },
  rowHint: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  chipGroup: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: colors.accentText },
});
