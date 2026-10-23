import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Localization from "expo-localization";
import { LinearGradient } from "expo-linear-gradient";
import { Link } from "expo-router";
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../../src/auth/AuthContext";
import { createRegisterSubmitter } from "../../src/auth/registerSubmit";
import { roman, useRomanFonts } from "../../src/romanTheme";

// Same bundled photo as the login screen; not copied.
const heroImage = require("../../assets/images/login/hercules-bronze.jpg");

// The form is longer than login's, so the statue is a short, dimmed backdrop
// instead of filling most of the screen.
const HERO_HEIGHT_RATIO = 0.3;
const HERO_MAX_HEIGHT = 260;
const HERO_OPACITY = 0.5;
const MIN_TOUCH = 44;

export default function RegisterScreen() {
  const { signUp } = useAuth();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const font = useRomanFonts();

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

  const heroHeight = Math.min(HERO_MAX_HEIGHT, Math.round(windowHeight * HERO_HEIGHT_RATIO));

  return (
    <View style={styles.root}>
      {/* Decorative background: never receives touches, hidden from screen readers. */}
      <View
        pointerEvents="none"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.hero, { height: heroHeight }]}
      >
        <Image
          source={heroImage}
          style={[StyleSheet.absoluteFill, { opacity: HERO_OPACITY }]}
          contentFit="cover"
          contentPosition="top"
          accessible={false}
        />
        <LinearGradient
          colors={[roman.backgroundClear, "rgba(9, 9, 11, 0.7)", roman.background]}
          locations={[0.1, 0.65, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>

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
            { paddingTop: insets.top + 24, paddingBottom: Math.max(insets.bottom, 24) },
          ]}
        >
          <Text accessibilityRole="header" style={[styles.title, font.title]}>
            Create account
          </Text>

          <View style={styles.field}>
            <Text style={[styles.label, font.medium]}>Email</Text>
            <TextInput
              style={[styles.input, font.regular]}
              accessibilityLabel="Email"
              placeholder="name@example.com"
              placeholderTextColor={roman.placeholder}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              autoComplete="email"
              returnKeyType="next"
              onSubmitEditing={() => usernameRef.current?.focus()}
              selectionColor={roman.gold}
            />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, font.medium]}>Username</Text>
            <TextInput
              ref={usernameRef}
              style={[styles.input, font.regular]}
              accessibilityLabel="Username"
              placeholder="Letters, numbers, _"
              placeholderTextColor={roman.placeholder}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="username"
              autoComplete="username-new"
              returnKeyType="next"
              onSubmitEditing={() => firstNameRef.current?.focus()}
              selectionColor={roman.gold}
            />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, font.medium]}>
              First name <Text style={[styles.optional, font.regular]}>(optional)</Text>
            </Text>
            <TextInput
              ref={firstNameRef}
              style={[styles.input, font.regular]}
              accessibilityLabel="First name, optional"
              value={firstName}
              onChangeText={setFirstName}
              textContentType="givenName"
              autoComplete="given-name"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              selectionColor={roman.gold}
            />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, font.medium]}>Password</Text>
            <View>
              <TextInput
                ref={passwordRef}
                style={[styles.input, styles.passwordInput, font.regular]}
                accessibilityLabel="Password"
                placeholder="At least 8 characters"
                placeholderTextColor={roman.placeholder}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="newPassword"
                autoComplete="new-password"
                returnKeyType="go"
                onSubmitEditing={handleSubmit}
                selectionColor={roman.gold}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                onPress={() => setShowPassword((visible) => !visible)}
                style={styles.eyeButton}
              >
                <Ionicons
                  name={showPassword ? "eye-off-outline" : "eye-outline"}
                  size={20}
                  color={roman.textMuted}
                />
              </Pressable>
            </View>
          </View>

          {error ? (
            <Text
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              style={[styles.error, font.medium]}
            >
              {error}
            </Text>
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
              <ActivityIndicator color={roman.background} />
            ) : (
              <Text style={[styles.buttonText, font.semibold]}>Create account</Text>
            )}
          </Pressable>

          <View style={styles.footer}>
            <Text style={[styles.footerText, font.regular]}>Already have an account?</Text>
            <Link href="/login" asChild>
              <Pressable accessibilityRole="link" style={styles.linkButton}>
                <Text style={[styles.link, font.medium]}>Sign in</Text>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: roman.background },
  flex: { flex: 1 },
  hero: { position: "absolute", top: 0, left: 0, right: 0 },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
  },
  title: {
    color: roman.text,
    fontSize: 28,
    fontWeight: "600",
    letterSpacing: 0.6,
    marginBottom: 24,
  },
  field: { marginBottom: 14 },
  label: {
    color: roman.textMuted,
    fontSize: 12,
    fontWeight: "500",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  optional: {
    fontWeight: "400",
    textTransform: "none",
    letterSpacing: 0,
  },
  input: {
    minHeight: 52,
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    color: roman.text,
    fontSize: 15,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  passwordInput: { paddingRight: 52 },
  eyeButton: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  error: {
    color: roman.danger,
    fontSize: 14,
    marginBottom: 12,
  },
  button: {
    minHeight: 52,
    backgroundColor: roman.gold,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  buttonPressed: { backgroundColor: roman.goldPressed },
  buttonBusy: { opacity: 0.6 },
  buttonText: {
    color: roman.background,
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    columnGap: 4,
    marginTop: 16,
  },
  footerText: { color: roman.textMuted, fontSize: 14 },
  linkButton: {
    minHeight: MIN_TOUCH,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  link: { color: roman.goldLight, fontSize: 14, fontWeight: "500" },
});
