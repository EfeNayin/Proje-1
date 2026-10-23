import { Ionicons } from "@expo/vector-icons";
import { useFonts } from "expo-font";
import { Image } from "expo-image";
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
import { createLoginSubmitter } from "../../src/auth/loginSubmit";
import { colors } from "../../src/theme";

// Scoped to this screen on purpose: the rest of the app still uses the global
// theme, and switching it is a separate decision.
const palette = {
  background: "#09090B",
  surface: "#171719",
  border: "#2E2E34",
  gold: "#C5A46D",
  goldPressed: "#B3925B",
  goldLight: "#E4CD95",
  text: "#E7E7EB",
  textMuted: "#A0A0A8",
  placeholder: "#6B6B73",
  // Same colour as the transparent end of each gradient: fading to the
  // literal "transparent" can leave a grey fringe on iOS.
  backgroundClear: "rgba(9, 9, 11, 0)",
} as const;

const heroImage = require("../../assets/images/login/hercules-bronze.jpg");

const fontFiles = {
  "Cinzel-Medium": require("../../assets/fonts/cinzel/Cinzel-Medium.ttf"),
  "PlusJakartaSans-Regular": require("../../assets/fonts/plus-jakarta-sans/PlusJakartaSans-Regular.ttf"),
  "PlusJakartaSans-Medium": require("../../assets/fonts/plus-jakarta-sans/PlusJakartaSans-Medium.ttf"),
  "PlusJakartaSans-SemiBold": require("../../assets/fonts/plus-jakarta-sans/PlusJakartaSans-SemiBold.ttf"),
};

// The statue fills roughly the top 60% of the screen and fades out beneath
// the form. Height follows the window so short screens are not stretched.
const HERO_HEIGHT_RATIO = 0.6;
const MIN_TOUCH = 44;

export default function LoginScreen() {
  const { signIn } = useAuth();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [fontsLoaded] = useFonts(fontFiles);

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

  // Until the bundled fonts register, the screen renders with system fonts and
  // stays fully usable; a failed load simply leaves it that way.
  const font = fontsLoaded
    ? {
        title: { fontFamily: "Cinzel-Medium", fontWeight: "normal" as const },
        regular: { fontFamily: "PlusJakartaSans-Regular", fontWeight: "normal" as const },
        medium: { fontFamily: "PlusJakartaSans-Medium", fontWeight: "normal" as const },
        semibold: { fontFamily: "PlusJakartaSans-SemiBold", fontWeight: "normal" as const },
      }
    : { title: null, regular: null, medium: null, semibold: null };

  const heroHeight = Math.round(windowHeight * HERO_HEIGHT_RATIO);

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
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          contentPosition="top"
          accessible={false}
        />
        <LinearGradient
          colors={["rgba(9, 9, 11, 0.55)", palette.backgroundClear]}
          locations={[0, 0.3]}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={[palette.backgroundClear, "rgba(9, 9, 11, 0.6)", palette.background]}
          locations={[0.35, 0.7, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        // iOS pushes content up; Android already resizes the window.
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          // The form sits at the bottom when it is short, and the whole
          // content scrolls when text is large, the screen is small or the
          // keyboard is open.
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + 24, paddingBottom: Math.max(insets.bottom, 24) },
          ]}
        >
          <Text accessibilityRole="header" style={[styles.title, font.title]}>
            Find your strength.
          </Text>

          <View style={styles.field}>
            <Text style={[styles.label, font.medium]}>Email</Text>
            <TextInput
              style={[styles.input, font.regular]}
              accessibilityLabel="Email"
              placeholder="name@example.com"
              placeholderTextColor={palette.placeholder}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              autoComplete="email"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              selectionColor={palette.gold}
            />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, font.medium]}>Password</Text>
            <View>
              <TextInput
                ref={passwordRef}
                style={[styles.input, styles.passwordInput, font.regular]}
                accessibilityLabel="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
                autoComplete="current-password"
                returnKeyType="go"
                onSubmitEditing={handleSubmit}
                selectionColor={palette.gold}
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
                  color={palette.textMuted}
                />
              </Pressable>
            </View>
          </View>

          {error ? (
            <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.error, font.medium]}>
              {error}
            </Text>
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
              <ActivityIndicator color={palette.background} />
            ) : (
              <Text style={[styles.buttonText, font.semibold]}>Sign in</Text>
            )}
          </Pressable>

          <View style={styles.footer}>
            <Text style={[styles.footerText, font.regular]}>Don’t have an account?</Text>
            <Link href="/register" asChild>
              <Pressable accessibilityRole="link" style={styles.linkButton}>
                <Text style={[styles.link, font.medium]}>Create account</Text>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  flex: { flex: 1 },
  hero: { position: "absolute", top: 0, left: 0, right: 0 },
  content: {
    flexGrow: 1,
    justifyContent: "flex-end",
    paddingHorizontal: 24,
  },
  title: {
    color: palette.text,
    fontSize: 30,
    fontWeight: "600",
    letterSpacing: 0.6,
    marginBottom: 28,
  },
  field: { marginBottom: 16 },
  label: {
    color: palette.textMuted,
    fontSize: 12,
    fontWeight: "500",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  input: {
    minHeight: 52,
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 12,
    color: palette.text,
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
    color: colors.danger,
    fontSize: 14,
    marginBottom: 12,
  },
  button: {
    minHeight: 52,
    backgroundColor: palette.gold,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  buttonPressed: { backgroundColor: palette.goldPressed },
  buttonBusy: { opacity: 0.6 },
  buttonText: {
    color: palette.background,
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
  footerText: { color: palette.textMuted, fontSize: 14 },
  linkButton: {
    minHeight: MIN_TOUCH,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  link: { color: palette.goldLight, fontSize: 14, fontWeight: "500" },
});
