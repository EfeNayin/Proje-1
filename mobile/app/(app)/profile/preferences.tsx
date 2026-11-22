/**
 * Preferences screen (Profile > Preferences).
 *
 * Three independent settings, each backed by whatever already stored it
 * before this screen existed — no new storage introduced here:
 * - Weight unit: users.weight_unit on the server, via PATCH /users/me. Every
 *   screen that displays or accepts a weight (set logging, body weight,
 *   goal weight) converts through src/units/weight.ts — stored values stay
 *   kg, only the display/input layer changes with this preference.
 * - Default rest: src/workout/restPreference.ts, on-device, same store the
 *   workout screen's rest picker already reads and writes.
 * - Readiness check-in: src/workout/readinessPreference.ts, on-device, same
 *   store the training home screen already reads to decide whether to route
 *   through the check-in screen before a workout.
 * - Timezone: users.timezone on the server, via PATCH /users/me — same field
 *   captured once at registration (see (auth)/register.tsx) and used both to
 *   slice weekly volume into the user's local week and, on the client side,
 *   to group the workout history list into local calendar days. Registration
 *   only ever sets it once, so this is the only place it can be corrected
 *   afterwards, e.g. after moving or a long trip (Adım 21,
 *   PROJE_1_CODEX_INCELEME.md Bölüm 8 madde H). Deliberately manual and
 *   one-tap only: no automatic mismatch detection or prompting, so a user
 *   who is just travelling short-term and wants their weeks to keep
 *   following their home timezone is never overridden without asking.
 */

import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import * as Localization from "expo-localization";

import { updateMe } from "../../../src/api/auth";
import { useAuth } from "../../../src/auth/AuthContext";
import { light } from "../../../src/lightTheme";
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
  return (
    <Text accessibilityRole="header" style={styles.sectionLabel}>
      {children}
    </Text>
  );
}

export default function PreferencesScreen() {
  const { user, refreshProfile } = useAuth();

  const [savingUnit, setSavingUnit] = useState(false);
  const [restSeconds, setRestSecondsState] = useState<number | null>(null);
  const [checkinEnabled, setCheckinEnabled] = useState(true);
  const [savingTimezone, setSavingTimezone] = useState(false);
  const [timezoneError, setTimezoneError] = useState(false);

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

  // Read once for the "already up to date" disabled state below — this is
  // not automatic mismatch detection/prompting (deliberately out of scope,
  // see the file header comment): nothing here alerts the user or acts
  // without a tap, it only mirrors the disabled state the other rows on
  // this screen already use once their own value is current.
  const deviceTimezone = Localization.getCalendars()[0]?.timeZone ?? null;
  const timezoneUpToDate = Boolean(user && deviceTimezone === user.timezone);

  const handleUpdateTimezone = async () => {
    if (!deviceTimezone || savingTimezone) return;
    setSavingTimezone(true);
    setTimezoneError(false);
    try {
      await updateMe({ timezone: deviceTimezone });
      await refreshProfile();
    } catch {
      // Surfaced inline below rather than losing the tap silently — unlike
      // the other chips here, this one has no visible "current" state for
      // the user to fall back on noticing was never applied.
      setTimezoneError(true);
    } finally {
      setSavingTimezone(false);
    }
  };

  if (!user) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={light.textSecondary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <SectionLabel>Weight unit</SectionLabel>
      <View style={[styles.card, styles.row]}>
        <View style={styles.rowText}>
          <Text style={styles.rowLabel}>Units</Text>
          <Text style={styles.rowHint}>Converts how weights are shown and entered app-wide</Text>
        </View>
        <View style={styles.chipGroup}>
          {WEIGHT_UNITS.map((option) => (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityLabel={`Weight unit ${option.label}`}
              accessibilityState={{ selected: user.weight_unit === option.value, disabled: savingUnit }}
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
          <ActivityIndicator color={light.textSecondary} />
        ) : (
          <View style={styles.chipGroup}>
            {REST_PRESETS.map((seconds) => (
              <Pressable
                key={seconds}
                accessibilityRole="button"
                accessibilityLabel={`Default rest ${formatRest(seconds)}`}
                accessibilityState={{ selected: restSeconds === seconds }}
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
          accessibilityLabel="Readiness check-in"
          value={checkinEnabled}
          onValueChange={handleToggleCheckin}
          trackColor={{ false: light.separator, true: light.primary }}
        />
      </View>

      <SectionLabel>Timezone</SectionLabel>
      <View style={[styles.card, styles.row, styles.rowNoBorder]}>
        <View style={styles.rowText}>
          <Text style={styles.rowLabel}>{user.timezone}</Text>
          <Text style={styles.rowHint}>Used to group your workout history and slice weekly volume</Text>
          {timezoneError ? (
            <Text accessibilityRole="alert" style={styles.rowError}>Couldn&apos;t update — try again</Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={timezoneUpToDate ? "Time zone is up to date" : "Use device timezone"}
          accessibilityState={{ disabled: savingTimezone || timezoneUpToDate, busy: savingTimezone }}
          style={[styles.chip, timezoneUpToDate && styles.chipDisabled]}
          onPress={() => void handleUpdateTimezone()}
          disabled={savingTimezone || timezoneUpToDate}
        >
          {savingTimezone ? (
            <ActivityIndicator color={light.textSecondary} size="small" />
          ) : (
            <Text style={styles.chipText}>{timezoneUpToDate ? "Up to date" : "Use device timezone"}</Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background },
  content: { padding: 16, paddingBottom: 32 },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: light.background,
  },
  sectionLabel: {
    color: light.textSecondary,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
    marginTop: 24,
    marginLeft: 4,
  },
  card: {
    backgroundColor: light.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  presetCard: { paddingVertical: 12 },
  row: {
    minHeight: 60,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: 12,
    rowGap: 10,
    paddingVertical: 12,
  },
  rowNoBorder: { borderBottomWidth: 0 },
  // flexBasis lets the control wrap under the text on narrow screens and at larger text sizes.
  rowText: { flex: 1, flexBasis: 160 },
  rowLabel: { color: light.text, fontSize: 16, lineHeight: 22 },
  rowHint: { color: light.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 2 },
  rowError: { color: light.danger, fontSize: 13, lineHeight: 18, marginTop: 2 },
  chipGroup: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: light.background,
    borderRadius: 10,
    paddingHorizontal: 14,
  },
  chipActive: { backgroundColor: light.primary },
  chipDisabled: { opacity: 0.5 },
  chipText: { color: light.text, fontSize: 14, fontWeight: "600" },
  chipTextActive: { color: light.onPrimary },
});
