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

import { PHONE_INPUT_MAX_LENGTH } from "../../src/account/phoneNumber";
import { useAuth } from "../../src/auth/AuthContext";
import { authStyles as styles } from "../../src/auth/authStyles";
import { createRegisterSubmitter } from "../../src/auth/registerSubmit";
import { light } from "../../src/lightTheme";

export default function RegisterScreen() {
  const { signUp } = useAuth();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [firstName, setFirstName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const usernameRef = useRef<TextInput>(null);
  const firstNameRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
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
      phoneNumber,
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
      <KeyboardAvoidingView
        style={styles.flex}
        // iOS pushes content up; Android already resizes the window.
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          // iOS: "on-drag" closes the keyboard the moment a scroll begins, so on a small phone
          // the button could only be reached by losing the keyboard. "interactive" keeps it open
          // while the form scrolls up and still lets a downward drag onto the keyboard dismiss
          // it. On Android "interactive" would behave like "none", so it keeps "on-drag".
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + 32, paddingBottom: Math.max(insets.bottom, 24) + 16 },
          ]}
        >
          <Text accessibilityRole="header" style={styles.title}>
            Create Account
          </Text>

          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              testID="register-email"
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
              testID="register-username"
              accessibilityLabel="Username"
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
              testID="register-first-name"
              accessibilityLabel="First name, optional"
              value={firstName}
              onChangeText={setFirstName}
              textContentType="givenName"
              autoComplete="given-name"
              returnKeyType="next"
              onSubmitEditing={() => phoneRef.current?.focus()}
              selectionColor={light.text}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>
              Phone number <Text style={styles.optional}>(optional)</Text>
            </Text>
            <TextInput
              ref={phoneRef}
              style={styles.input}
              testID="register-phone"
              accessibilityLabel="Phone number, optional"
              accessibilityHint="Include the country code, for example plus 90"
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
              autoCorrect={false}
              maxLength={PHONE_INPUT_MAX_LENGTH}
              // The phone pad has no return key on every iOS version (newer ones float a Next
              // button over it); where there is one it moves on to Password, and otherwise the
              // Password field stays in reach to tap.
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
                testID="register-password"
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
            testID="register-submit"
            accessibilityLabel="Create Account"
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
              <Text style={styles.buttonText}>Create Account</Text>
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
