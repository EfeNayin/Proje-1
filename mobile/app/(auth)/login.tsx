import { Ionicons } from "@expo/vector-icons";
import { Link, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { clearAccountDeletedNotice, useAccountDeletedNotice } from "../../src/account/deletionNotice";
import { useAuth } from "../../src/auth/AuthContext";
import { authStyles as styles } from "../../src/auth/authStyles";
import { createLoginSubmitter } from "../../src/auth/loginSubmit";
import { clearPasswordChangedNotice, usePasswordChangedNotice } from "../../src/auth/passwordChangedNotice";
import { recoveryStore } from "../../src/auth/recoverySession";
import { light } from "../../src/lightTheme";
import { socialLogin } from "../../src/api/social";
import type { SocialProvider } from "../../src/api/social";
import { ProviderButtons } from "../../src/social/ProviderButtons";
import { onboardingStore, providerDeps, signInGate } from "../../src/social/providerSession";
import {
  createProviderSubmitter,
  NO_PROVIDERS,
  resolveOfferedProviders,
} from "../../src/social/providerSignIn";
import type { OfferedProviders } from "../../src/social/providerSignIn";

// The notice is good news, not an error: same layout as the error line, its own colour.
const noticeText = [styles.errorText, { color: light.text }];

const localStyles = StyleSheet.create({
  divider: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 20 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: light.separator },
  dividerText: { color: light.textSecondary, fontSize: 14 },
});

export default function LoginScreen() {
  const { signIn, signInWithProvider } = useAuth();
  const accountDeleted = useAccountDeletedNotice();
  const passwordChanged = usePasswordChangedNotice();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  // Google/Apple buttons exist only once the server has said what works and this build
  // can do it; until then (and when the server is unreachable) the screen is email-only.
  const [offered, setOffered] = useState<OfferedProviders>(NO_PROVIDERS);
  useEffect(() => {
    let cancelled = false;
    void resolveOfferedProviders(providerDeps).then((result) => {
      if (!cancelled) setOffered(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // One attempt at a time, whichever button started it (see auth/attemptGate.ts).
  const submit = useMemo(
    () =>
      createLoginSubmitter(signIn, () => {
        setError(null);
        setBusy(true);
      }, signInGate),
    [signIn],
  );

  const submitProvider = useMemo(
    () =>
      createProviderSubmitter({
        deps: providerDeps,
        signInWithProvider,
        login: socialLogin,
        gate: signInGate,
        offered: () => offered,
        onStart: () => {
          setError(null);
          setBusy(true);
        },
      }),
    [signInWithProvider, offered],
  );

  const handleProvider = async (provider: SocialProvider) => {
    const outcome = await submitProvider(provider);
    if (outcome.kind === "ignored") return; // the running attempt owns the busy state
    // Cancelling the sheet is not an error, and what was typed above is left as it was.
    // Signing in needs no navigation: the auth layout redirects once status flips.
    if (outcome.kind === "onboarding") {
      onboardingStore.begin(outcome.offer);
      router.push("/social-onboarding");
    } else if (outcome.kind === "failed") {
      setError(outcome.message);
    }
    setBusy(false);
  };

  const handleSubmit = async () => {
    const outcome = await submit(email, password);
    if (outcome.kind === "ignored") return; // the running request owns the busy state
    // On success there is no navigation here: the auth layout redirects once
    // status flips.
    if (outcome.kind === "invalid" || outcome.kind === "failed") setError(outcome.message);
    setBusy(false);
  };

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        style={styles.flex}
        // iOS pushes content up; Android already resizes the window.
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          // The whole content scrolls when text is large, the screen is small
          // or the keyboard is open, so the button is always reachable.
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + 32, paddingBottom: Math.max(insets.bottom, 24) + 16 },
          ]}
        >
          {accountDeleted ? (
            <View style={styles.errorRow}>
              <Ionicons name="checkmark-circle-outline" size={18} color={light.positive} accessible={false} />
              <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={noticeText}>
                Your account has been deleted. You are signed out on this device.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss"
                onPress={clearAccountDeletedNotice}
                hitSlop={8}
              >
                <Ionicons name="close" size={18} color={light.textSecondary} />
              </Pressable>
            </View>
          ) : null}

          {passwordChanged ? (
            <View style={styles.errorRow}>
              <Ionicons name="checkmark-circle-outline" size={18} color={light.positive} accessible={false} />
              <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={noticeText}>
                Your password was changed. Sign in with your new password.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss"
                onPress={clearPasswordChangedNotice}
                hitSlop={8}
              >
                <Ionicons name="close" size={18} color={light.textSecondary} />
              </Pressable>
            </View>
          ) : null}

          <Text accessibilityRole="header" style={styles.title}>
            Find your strength.
          </Text>

          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              accessibilityLabel="Email"
              testID="login-email"
              placeholder="name@example.com"
              placeholderTextColor={light.textSecondary}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              autoComplete="email"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              selectionColor={light.text}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <View>
              <TextInput
                ref={passwordRef}
                style={[styles.input, styles.passwordInput]}
                accessibilityLabel="Password"
                testID="login-password"
                placeholderTextColor={light.textSecondary}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
                autoComplete="current-password"
                returnKeyType="go"
                onSubmitEditing={handleSubmit}
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
          </View>

          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Forgot password?"
            testID="login-forgot"
            style={[styles.linkButton, { alignSelf: "flex-end", marginTop: -8 }]}
            onPress={() => {
              // The address typed here carries over; the password never does.
              recoveryStore.setEmail(email.trim());
              router.push("/forgot-password");
            }}
          >
            <Text style={styles.link}>Forgot password?</Text>
          </Pressable>

          {error ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle-outline" size={18} color={light.danger} accessible={false} />
              <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.errorText}>
                {error}
              </Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign in"
            accessibilityState={{ busy, disabled: busy }}
            style={({ pressed }) => [
              styles.button,
              pressed && styles.buttonPressed,
              busy && styles.buttonBusy,
            ]}
            onPress={handleSubmit}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color={light.onPrimary} />
            ) : (
              <Text style={styles.buttonText}>Sign in</Text>
            )}
          </Pressable>

          {offered.apple || offered.google ? (
            <>
              <View style={localStyles.divider} accessibilityElementsHidden importantForAccessibility="no">
                <View style={localStyles.rule} />
                <Text style={localStyles.dividerText}>or</Text>
                <View style={localStyles.rule} />
              </View>
              <ProviderButtons offered={offered} disabled={busy} onPress={handleProvider} />
            </>
          ) : null}

          <View style={styles.footer}>
            <Text style={styles.footerText}>Don’t have an account?</Text>
            <Link href="/register" asChild>
              <Pressable accessibilityRole="link" style={styles.linkButton}>
                <Text style={styles.link}>Create account</Text>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
