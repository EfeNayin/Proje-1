/**
 * Delete account (Profile > Account > Delete account).
 *
 * Permanent. The page says what goes, what stays with other people and that it
 * cannot be undone; asks for the current password in a secure field; and needs a
 * second, explicit confirmation before anything is sent. "Cancel" and "Keep my
 * account" leave without a request.
 *
 * The password lives only in this screen's state: it is handed to the request and
 * nowhere else, and is gone when the screen is. While the request runs the screen
 * cannot be left and nothing can be tapped twice. "Deleted" is never shown here:
 * a confirmed deletion signs the app out (see src/account/deletion.ts), and an
 * answer that did not settle the matter says so instead.
 */

import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { accountDeletionStore } from "../../../src/account/deletionSession";
import { useAccountDeletion } from "../../../src/account/useAccountDeletion";
import { light } from "../../../src/lightTheme";

const MIN_TOUCH = 44;

const DELETED = [
  "Your profile, preferences and nutrition goals",
  "Your workouts, sets and body-weight history",
  "Your daily check-ins",
  "Your programs and templates, including copies a coach sent you",
  "Your connections to coaches and athletes, invite codes, program offers and any feedback attached to them",
  "Every sign-in on every device",
] as const;

const KEPT = [
  "Other people's own programs and workouts are never touched.",
  "If you are a coach: a program you sent that an athlete already added stays in that athlete's programs as their own copy, with no link to you. Anything you typed inside it, such as a program name or a note, stays as you wrote it.",
  "The shared exercise catalogue is not affected.",
] as const;

function Bullets({ items }: { items: readonly string[] }) {
  return (
    <View style={styles.bullets}>
      {items.map((item) => (
        <View key={item} style={styles.bulletRow}>
          <Text style={styles.bullet} accessible={false}>
            •
          </Text>
          <Text style={styles.bulletText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

export default function DeleteAccountScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const state = useAccountDeletion();
  const deleting = state.phase === "deleting";

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [entryError, setEntryError] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);

  // Forgotten when the screen is left, unless a deletion is running (it carries on).
  useEffect(() => () => accountDeletionStore.leave(), []);

  // A request is on its way: the hardware back button must not leave it unattended.
  useEffect(() => {
    if (!deleting) return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => subscription.remove();
  }, [deleting]);

  const failure = state.phase === "failed" ? state.error : null;
  const error = entryError ?? failure?.message ?? null;

  const askToConfirm = () => {
    if (deleting) return;
    if (password.length === 0) {
      setEntryError("Enter your current password to continue.");
      passwordRef.current?.focus();
      return;
    }
    setEntryError(null);
    setConfirming(true);
  };

  const submit = async () => {
    if (deleting) return; // the store refuses a duplicate as well; this just saves the render
    const outcome = await accountDeletionStore.submit(password);
    if (outcome.kind === "wrong-password" || outcome.kind === "rate-limited") {
      // Nothing was deleted, and a password that was refused is not kept around.
      setPassword("");
      setConfirming(false);
    } else if (outcome.kind === "invalid") {
      setConfirming(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Stack.Screen
        options={{
          title: "Delete account",
          headerBackVisible: !deleting,
          gestureEnabled: !deleting,
        }}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
      >
        <View style={styles.warning}>
          <Ionicons name="warning-outline" size={22} color={light.danger} accessible={false} />
          <Text style={styles.warningText}>
            This permanently deletes your account. It cannot be undone.
          </Text>
        </View>

        <Text accessibilityRole="header" style={styles.sectionLabel}>
          What will be deleted
        </Text>
        <View style={styles.card}>
          <Bullets items={DELETED} />
        </View>

        <Text accessibilityRole="header" style={styles.sectionLabel}>
          What stays with other people
        </Text>
        <View style={styles.card}>
          <Bullets items={KEPT} />
        </View>

        <Text accessibilityRole="header" style={styles.sectionLabel}>
          Confirm with your password
        </Text>
        <View>
          <TextInput
            ref={passwordRef}
            style={[styles.input, styles.passwordInput]}
            accessibilityLabel="Current password"
            testID="delete-account-password"
            placeholder="Current password"
            placeholderTextColor={light.textSecondary}
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              setEntryError(null);
              if (confirming) setConfirming(false);
            }}
            editable={!deleting}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            autoComplete="current-password"
            returnKeyType="go"
            onSubmitEditing={askToConfirm}
            selectionColor={light.text}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showPassword ? "Hide password" : "Show password"}
            onPress={() => setShowPassword((visible) => !visible)}
            style={styles.eyeButton}
          >
            <Ionicons
              name={showPassword ? "eye-off-outline" : "eye-outline"}
              size={22}
              color={light.textSecondary}
            />
          </Pressable>
        </View>

        {error ? (
          <View style={styles.errorRow}>
            <Ionicons name="alert-circle-outline" size={18} color={light.danger} accessible={false} />
            <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.errorText}>
              {error}
            </Text>
          </View>
        ) : null}

        {confirming || deleting ? (
          <View style={styles.confirm} accessibilityViewIsModal={false}>
            <Text accessibilityRole="header" style={styles.confirmTitle}>
              Delete your account for good?
            </Text>
            <Text style={styles.confirmText}>
              This cannot be undone. You will be signed out on this device and nobody, including us,
              can bring the account back.
            </Text>
            <Pressable
              accessibilityRole="button"
              testID="delete-account-confirm"
              accessibilityLabel={deleting ? "Deleting your account" : "Yes, delete my account"}
              accessibilityState={{ busy: deleting, disabled: deleting }}
              disabled={deleting}
              style={({ pressed }) => [
                styles.dangerButton,
                pressed && styles.dangerPressed,
                deleting && styles.busy,
              ]}
              onPress={() => void submit()}
            >
              {deleting ? (
                <View style={styles.busyRow}>
                  <ActivityIndicator color={light.onPrimary} />
                  <Text style={styles.dangerText}>Deleting your account…</Text>
                </View>
              ) : (
                <Text style={styles.dangerText}>Yes, delete my account</Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              testID="delete-account-keep"
              accessibilityLabel="Keep my account"
              accessibilityState={{ disabled: deleting }}
              disabled={deleting}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed, deleting && styles.busy]}
              onPress={() => setConfirming(false)}
            >
              <Text style={styles.secondaryText}>Keep my account</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              testID="delete-account-open"
              accessibilityLabel="Delete account"
              style={({ pressed }) => [styles.dangerButton, pressed && styles.dangerPressed]}
              onPress={askToConfirm}
            >
              <Text style={styles.dangerText}>Delete account</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              testID="delete-account-cancel"
              accessibilityLabel="Cancel"
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
              onPress={() => router.back()}
            >
              <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background },
  content: { paddingHorizontal: 16, paddingTop: 8 },
  pressed: { backgroundColor: light.pressed },
  busy: { opacity: 0.6 },

  warning: {
    flexDirection: "row",
    alignItems: "flex-start",
    columnGap: 10,
    backgroundColor: light.surface,
    borderRadius: 12,
    padding: 16,
  },
  warningText: { flex: 1, color: light.text, fontSize: 16, lineHeight: 22, fontWeight: "600" },

  sectionLabel: {
    color: light.textSecondary,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 24,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: { backgroundColor: light.surface, borderRadius: 12, padding: 16 },
  bullets: { rowGap: 8 },
  bulletRow: { flexDirection: "row", columnGap: 8 },
  bullet: { color: light.textSecondary, fontSize: 15, lineHeight: 21 },
  bulletText: { flex: 1, color: light.text, fontSize: 15, lineHeight: 21 },

  input: {
    minHeight: 52,
    backgroundColor: light.surface,
    borderColor: light.separator,
    borderWidth: 1,
    borderRadius: 12,
    color: light.text,
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  passwordInput: { paddingRight: 56 },
  eyeButton: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: 52,
    minHeight: MIN_TOUCH,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  errorRow: { flexDirection: "row", alignItems: "flex-start", columnGap: 8, marginTop: 12 },
  errorText: { flex: 1, color: light.danger, fontSize: 14, lineHeight: 20 },

  confirm: {
    marginTop: 20,
    backgroundColor: light.surface,
    borderRadius: 12,
    padding: 16,
    rowGap: 12,
  },
  confirmTitle: { color: light.text, fontSize: 18, lineHeight: 24, fontWeight: "700" },
  confirmText: { color: light.textSecondary, fontSize: 15, lineHeight: 21 },

  // Red fill with white text and a label that says what it does: the meaning never rests on the colour.
  dangerButton: {
    minHeight: 52,
    marginTop: 20,
    backgroundColor: light.danger,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  dangerPressed: { opacity: 0.85 },
  dangerText: { color: light.onPrimary, fontSize: 16, fontWeight: "600" },
  busyRow: { flexDirection: "row", alignItems: "center", columnGap: 10 },
  secondaryButton: {
    minHeight: 52,
    marginTop: 8,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { color: light.text, fontSize: 16, fontWeight: "600" },
});
