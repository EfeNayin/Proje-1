import { Ionicons } from "@expo/vector-icons";
import * as Localization from "expo-localization";
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
import { createRegisterSubmitter } from "../../src/auth/registerSubmit";
import { FocusedDarkStatusBar } from "../../src/FocusedDarkStatusBar";
import { light } from "../../src/lightTheme";

export default function RegisterScreen() {
  const { signUp } = useAuth();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [firstName, setFirstName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const usernameRef = useRef<TextInput>(null);
  const firstNameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const submit = useMemo(
    () =>
      createRegisterSubmitter(signUp, () => {
        setError(null);
        setBusy(true);
      }),
    [signUp],
  );

  const handleSubmit = async () => {
    const outcome = await submit({
      email,
      username,
      password,
      firstName,
      timezone: Localization.getCalendars()[0]?.timeZone ?? undefined,
    });
    if (outcome.kind === "ignored") return; // the running request owns the busy state
    // On success there is no navigation here: the auth layout redirects once
    // status flips. Field values stay in state on failure so a retry is one tap.
    if (outcome.kind === "invalid" || outcome.kind === "failed") {
      setError(outcome.message);
      // The message renders just above the button; bring both into view even
      // with the keyboard open on a small screen.
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: false }));
    }
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
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + 32, paddingBottom: Math.max(insets.bottom, 24) + 16 },
          ]}
        >
          <Text accessibilityRole="header" style={styles.title}>
            Create account
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
              onSubmitEditing={() => usernameRef.current?.focus()}
              selectionColor={light.text}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Username</Text>
            <TextInput
              ref={usernameRef}
              style={styles.input}
              accessibilityLabel="Username"
              placeholder="Letters, numbers, _"
              placeholderTextColor={light.textSecondary}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="username"
              autoComplete="username-new"
              returnKeyType="next"
              onSubmitEditing={() => firstNameRef.current?.focus()}
              selectionColor={light.text}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>
              First name <Text style={styles.optional}>(optional)</Text>
            </Text>
            <TextInput
              ref={firstNameRef}
              style={styles.input}
              accessibilityLabel="First name, optional"
              value={firstName}
              onChangeText={setFirstName}
              textContentType="givenName"
              autoComplete="given-name"
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
                placeholder="At least 8 characters"
                placeholderTextColor={light.textSecondary}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="newPassword"
                autoComplete="new-password"
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
            accessibilityLabel="Create account"
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
              <Text style={styles.buttonText}>Create account</Text>
            )}
          </Pressable>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account?</Text>
            <Link href="/login" asChild>
              <Pressable accessibilityRole="link" style={styles.linkButton}>
                <Text style={styles.link}>Sign in</Text>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
