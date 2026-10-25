import { Ionicons } from "@expo/vector-icons";
import { Link } from "expo-router";
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../../src/auth/AuthContext";
import { authStyles as styles } from "../../src/auth/authStyles";
import { createLoginSubmitter } from "../../src/auth/loginSubmit";
import { FocusedDarkStatusBar } from "../../src/FocusedDarkStatusBar";
import { light } from "../../src/lightTheme";

export default function LoginScreen() {
  const { signIn } = useAuth();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  const submit = useMemo(
    () =>
      createLoginSubmitter(signIn, () => {
        setError(null);
        setBusy(true);
      }),
    [signIn],
  );

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
      <FocusedDarkStatusBar />
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
          <Text accessibilityRole="header" style={styles.title}>
            Find your strength.
          </Text>

          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              accessibilityLabel="Email"
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
