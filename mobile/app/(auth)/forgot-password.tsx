import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { authStyles as styles } from "../../src/auth/authStyles";
import { CODE_LENGTH } from "../../src/auth/recovery";
import type { RecoveryState } from "../../src/auth/recovery";
import { recoveryStore } from "../../src/auth/recoverySession";
import { useRecovery } from "../../src/auth/useRecovery";
import { light } from "../../src/lightTheme";

const lead = { color: light.textSecondary, fontSize: 15, lineHeight: 22, marginBottom: 20 } as const;
const secondaryText = [styles.link, { fontWeight: "500" as const }];

function secondsLeft(at: number | null, now: number): number {
  return at === null ? 0 : Math.max(0, Math.ceil((at - now) / 1000));
}

function ErrorRow({ message }: { message: string }) {
  return (
    <View style={styles.errorRow}>
      <Ionicons name="alert-circle-outline" size={18} color={light.danger} accessible={false} />
      <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.errorText}>
        {message}
      </Text>
    </View>
  );
}

function BackToSignIn() {
  const router = useRouter();
  return (
    <View style={styles.footer}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Back to sign in"
        style={styles.linkButton}
        onPress={() => router.replace("/login")}
      >
        <Text style={styles.link}>Back to sign in</Text>
      </Pressable>
    </View>
  );
}

/**
 * Password recovery: email -> code and new password -> done. The rules (what is claimed
 * and when, limits, late answers) live in src/auth/recovery.ts; this screen only holds
 * what the person is typing. The second step keeps the code and the passwords in its own
 * state: they survive a failed attempt so a typo costs one field, and are dropped the
 * moment that step goes away (done, a different email, leaving the screen). Nothing is
 * stored. The address is the one thing the store keeps between steps.
 */
export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const recovery = useRecovery();
  // The flow belongs to this visit: leaving drops the address, a half-finished attempt
  // and the answer of a request still running.
  useEffect(() => () => recoveryStore.reset(), []);

  return (
    <View style={styles.root}>
      <View style={styles.flex}>
        <ScrollView
          // iOS: the scroll view adds the keyboard's height as bottom inset and scrolls the
          // focused field into view itself (KeyboardAvoidingView left the lower fields
          // under the keyboard here). Android already resizes the window.
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + 32, paddingBottom: Math.max(insets.bottom, 24) + 16 },
          ]}
        >
          {recovery.phase === "request" ? <RequestStep recovery={recovery} /> : null}
          {recovery.phase === "confirm" ? <ConfirmStep recovery={recovery} /> : null}
          {recovery.phase === "done" ? <DoneStep /> : null}
        </ScrollView>
      </View>
    </View>
  );
}

function RequestStep({ recovery }: { recovery: RecoveryState }) {
  const requesting = recovery.working === "requesting";
  const sendCode = () => recoveryStore.requestCode(recovery.email);
  return (
    <>
      <Text accessibilityRole="header" style={styles.title}>
        Reset your password
      </Text>
      <Text style={lead}>
        Enter the email address of your account. If it has one, we will email you a {CODE_LENGTH}-digit code to
        choose a new password.
      </Text>
      <View style={styles.field}>
        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          accessibilityLabel="Email"
          testID="recovery-email"
          placeholder="name@example.com"
          placeholderTextColor={light.textSecondary}
          value={recovery.email}
          onChangeText={(text) => recoveryStore.setEmail(text)}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
          returnKeyType="send"
          onSubmitEditing={sendCode}
          selectionColor={light.text}
        />
      </View>
      {recovery.error ? <ErrorRow message={recovery.error.message} /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send code"
        testID="recovery-send"
        accessibilityState={{ busy: requesting, disabled: requesting }}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, requesting && styles.buttonBusy]}
        onPress={sendCode}
        disabled={requesting}
      >
        {requesting ? <ActivityIndicator color={light.onPrimary} /> : <Text style={styles.buttonText}>Send code</Text>}
      </Pressable>
      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="I already have a code"
          testID="recovery-have-code"
          style={styles.linkButton}
          onPress={() => recoveryStore.haveCode(recovery.email)}
          disabled={requesting}
        >
          <Text style={styles.link}>I already have a code</Text>
        </Pressable>
      </View>
      <BackToSignIn />
    </>
  );
}

function ConfirmStep({ recovery }: { recovery: RecoveryState }) {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const passwordRef = useRef<TextInput>(null);
  const confirmationRef = useRef<TextInput>(null);

  const cooling = recovery.resendAvailableAt !== null && recovery.resendAvailableAt > now;
  useEffect(() => {
    if (!cooling) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [cooling]);

  const requesting = recovery.working === "requesting";
  const resetting = recovery.working === "resetting";
  const locked = requesting || resetting;
  const remaining = secondsLeft(recovery.resendAvailableAt, now);
  const mismatch = confirmation.length > 0 && password !== confirmation;

  const resend = () => {
    setNow(Date.now());
    return recoveryStore.requestCode(recovery.email, { resend: true });
  };
  const reset = () => {
    setNow(Date.now());
    return recoveryStore.submitReset({ code, password, confirmation });
  };

  return (
    <>
      <Text accessibilityRole="header" style={styles.title}>
        Choose a new password
      </Text>
      <Text style={lead}>
        If an account exists for {recovery.email}, we have sent it a {CODE_LENGTH}-digit code
        {recovery.codeValidMinutes ? `. It works once and expires in ${recovery.codeValidMinutes} minutes` : ""}.
        A new code cancels the earlier one.
      </Text>

      <View style={styles.field}>
        <Text style={styles.label}>Code</Text>
        <TextInput
          style={styles.input}
          accessibilityLabel="Reset code"
          testID="recovery-code"
          placeholder="1234 5678"
          placeholderTextColor={light.textSecondary}
          value={code}
          onChangeText={(text) => setCode(text.replace(/[^0-9\s-]/g, ""))}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete={Platform.OS === "android" ? "sms-otp" : "one-time-code"}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={14}
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          selectionColor={light.text}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>New password</Text>
        <View>
          <TextInput
            ref={passwordRef}
            style={[styles.input, styles.passwordInput]}
            accessibilityLabel="New password"
            testID="recovery-password"
            placeholder="At least 8 characters"
            placeholderTextColor={light.textSecondary}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPasswords}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="newPassword"
            autoComplete="new-password"
            returnKeyType="next"
            onSubmitEditing={() => confirmationRef.current?.focus()}
            selectionColor={light.text}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showPasswords ? "Hide passwords" : "Show passwords"}
            onPress={() => setShowPasswords((visible) => !visible)}
            style={styles.eyeButton}
          >
            <Ionicons name={showPasswords ? "eye-off-outline" : "eye-outline"} size={22} color={light.textSecondary} />
          </Pressable>
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Confirm new password</Text>
        <TextInput
          ref={confirmationRef}
          style={[styles.input, mismatch && { borderColor: light.danger }]}
          accessibilityLabel="Confirm new password"
          testID="recovery-confirm"
          placeholderTextColor={light.textSecondary}
          value={confirmation}
          onChangeText={setConfirmation}
          secureTextEntry={!showPasswords}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="newPassword"
          autoComplete="new-password"
          returnKeyType="go"
          onSubmitEditing={reset}
          selectionColor={light.text}
        />
        {mismatch ? (
          <Text accessibilityLiveRegion="polite" style={[styles.errorText, { marginTop: 6, marginLeft: 4 }]}>
            The two passwords do not match.
          </Text>
        ) : null}
      </View>

      {recovery.resent && !recovery.error ? (
        <View style={styles.errorRow}>
          <Ionicons name="mail-outline" size={18} color={light.positive} accessible={false} />
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.errorText, { color: light.text }]}>
            A new code was requested. Earlier codes no longer work.
          </Text>
        </View>
      ) : null}
      {recovery.error ? <ErrorRow message={recovery.error.message} /> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Reset password"
        testID="recovery-submit"
        accessibilityState={{ busy: resetting, disabled: locked || recovery.exhausted }}
        style={({ pressed }) => [
          styles.button,
          pressed && styles.buttonPressed,
          (locked || recovery.exhausted) && styles.buttonBusy,
        ]}
        onPress={reset}
        disabled={locked || recovery.exhausted}
      >
        {resetting ? <ActivityIndicator color={light.onPrimary} /> : <Text style={styles.buttonText}>Reset password</Text>}
      </Pressable>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={cooling ? `Send a new code, available in ${remaining} seconds` : "Send a new code"}
          testID="recovery-resend"
          accessibilityState={{ disabled: cooling || locked }}
          style={[styles.linkButton, (cooling || locked) && { opacity: 0.5 }]}
          onPress={resend}
          disabled={cooling || locked}
        >
          <Text style={secondaryText}>
            {requesting ? "Sending…" : cooling ? `Send a new code in ${remaining} s` : "Send a new code"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Use a different email"
          testID="recovery-change-email"
          style={styles.linkButton}
          onPress={() => recoveryStore.changeEmail()}
          disabled={locked}
        >
          <Text style={secondaryText}>Use a different email</Text>
        </Pressable>
      </View>
      <BackToSignIn />
    </>
  );
}

function DoneStep() {
  const router = useRouter();
  return (
    <>
      <View style={styles.errorRow}>
        <Ionicons name="checkmark-circle-outline" size={22} color={light.positive} accessible={false} />
        <Text accessibilityRole="header" style={[styles.title, { marginBottom: 0, flex: 1 }]}>
          Password updated
        </Text>
      </View>
      <Text accessibilityLiveRegion="polite" style={[lead, { marginTop: 16 }]}>
        Your password was changed and every session was signed out. Sign in with your new password.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go to sign in"
        testID="recovery-done"
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={() => router.replace("/login")}
      >
        <Text style={styles.buttonText}>Go to sign in</Text>
      </Pressable>
    </>
  );
}
