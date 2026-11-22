/**
 * Daily check-in: record today's sleep and energy without starting a workout.
 *
 * Reached from the diagnosis screen and from Profile. Unlike the pre-workout check-in
 * it has no connection to training at all: saving never creates or starts a workout
 * (the store has no workout calls), and it ignores any template parameter. Only the
 * fields changed here are saved, so mood, notes and soreness recorded earlier today
 * stay as they are.
 */

import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAuth } from "../../src/auth/AuthContext";
import { formatDay } from "../../src/diagnosis/assessment";
import { light } from "../../src/lightTheme";
import { RatingRow } from "../../src/readiness/RatingRow";
import { dailyCheckinStore } from "../../src/readiness/dailyCheckinSession";
import { useDailyCheckin } from "../../src/readiness/useDailyCheckin";

export default function DailyCheckinScreen() {
  const { user } = useAuth();
  // Keyed by account: another user signing in gets a fresh screen, never the last one's draft.
  return <DailyCheckin key={user?.id ?? "signed-out"} userId={user?.id ?? null} />;
}

function DailyCheckin({ userId }: { userId: string | null }) {
  const router = useRouter();
  const state = useDailyCheckin(userId);

  useEffect(() => {
    dailyCheckinStore.bind(userId);
    void dailyCheckinStore.load();
  }, [userId]);

  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const save = async () => {
    const outcome = await dailyCheckinStore.save();
    // "nothing" means every field already matches what is recorded: there is nothing to
    // wait for, so leaving is the honest answer too.
    if (outcome.kind === "done" || outcome.kind === "nothing") leave();
  };

  if (state.phase === "idle" || state.phase === "loading") {
    return (
      <View style={styles.center} accessibilityLabel="Loading today's check-in">
        <ActivityIndicator color={light.text} />
      </View>
    );
  }

  if (state.phase === "failed") {
    return (
      <View style={styles.center}>
        <Text accessibilityRole="alert" style={styles.error}>
          {state.error ?? "Could not load today's check-in."}
        </Text>
        <Pressable
          accessibilityRole="button"
          style={styles.secondary}
          onPress={() => void dailyCheckinStore.load()}
        >
          <Text style={styles.secondaryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const saving = state.saving;
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text accessibilityRole="header" style={styles.title}>
          Today&apos;s check-in
        </Text>
        <Text style={styles.subtitle}>
          {state.log ? formatDay(state.log.log_date) : ""} · No workout is started. Leave
          anything blank that you do not want to record.
        </Text>

        {state.error ? (
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>
            {state.error}
          </Text>
        ) : null}

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Sleep last night (hours)</Text>
          <TextInput
            style={[styles.input, state.sleepError ? styles.inputInvalid : null]}
            accessibilityLabel="Sleep in hours"
            editable={!saving}
            value={state.draft.sleepText}
            onChangeText={(sleepText) => dailyCheckinStore.edit({ sleepText })}
            placeholder="7.5"
            placeholderTextColor={light.textSecondary}
            keyboardType="decimal-pad"
            returnKeyType="done"
          />
          {state.sleepError ? (
            <Text accessibilityRole="alert" style={styles.fieldError}>
              {state.sleepError}
            </Text>
          ) : (
            <Text style={styles.fieldHint}>Empty means not recorded, not zero hours.</Text>
          )}
        </View>

        <RatingRow
          label="Sleep quality"
          value={state.draft.sleepQuality}
          disabled={saving}
          onChange={(sleepQuality) => dailyCheckinStore.edit({ sleepQuality })}
        />
        <RatingRow
          label="Energy"
          value={state.draft.energy}
          disabled={saving}
          onChange={(energy) => dailyCheckinStore.edit({ energy })}
        />

        <Text style={styles.fieldHint}>
          Mood, soreness and notes you recorded earlier today are kept as they are.
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save check-in"
          accessibilityState={{ busy: saving, disabled: saving }}
          disabled={saving}
          style={({ pressed }) => [
            styles.submit,
            pressed && styles.submitPressed,
            saving && styles.submitDisabled,
          ]}
          onPress={() => void save()}
        >
          {saving ? (
            <ActivityIndicator color={light.onPrimary} />
          ) : (
            <Text style={styles.submitText}>Save check-in</Text>
          )}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel without saving"
          disabled={saving}
          style={styles.secondary}
          onPress={leave}
        >
          <Ionicons name="close" size={18} color={light.text} />
          <Text style={styles.secondaryText}>Cancel</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background },
  content: { padding: 16, paddingBottom: 40 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: light.background,
  },
  title: { color: light.text, fontSize: 22, fontWeight: "700", lineHeight: 28 },
  subtitle: { color: light.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 6, marginBottom: 20 },
  error: { color: light.danger, fontSize: 14, lineHeight: 20, marginBottom: 16 },
  field: { marginBottom: 20 },
  fieldLabel: { color: light.textSecondary, fontSize: 13, fontWeight: "600", marginBottom: 6 },
  fieldHint: { color: light.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 6, marginBottom: 12 },
  fieldError: { color: light.danger, fontSize: 13, lineHeight: 18, marginTop: 6 },
  input: {
    minHeight: 52,
    backgroundColor: light.surface,
    borderColor: light.separator,
    borderWidth: 1,
    borderRadius: 12,
    color: light.text,
    fontSize: 17,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  inputInvalid: { borderColor: light.danger },
  submit: {
    minHeight: 52,
    backgroundColor: light.primary,
    borderRadius: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  submitPressed: { backgroundColor: light.primaryPressed },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: light.onPrimary, fontSize: 16, fontWeight: "600" },
  secondary: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 16,
  },
  secondaryText: { color: light.text, fontSize: 15, fontWeight: "600" },
});
