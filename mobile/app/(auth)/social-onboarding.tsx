/**
 * The step after a first Google or Apple sign-in. The server has verified the identity and
 * created nothing; here the person either makes an Aures account (a username, and an email
 * when the provider gave no usable one) or signs in to the account they already have and
 * links the provider to it. The provider's email never decides which: see social/onboarding.ts.
 */

import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Localization from "expo-localization";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
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

import { socialComplete, socialLinkExisting } from "../../src/api/social";
import { useAuth } from "../../src/auth/AuthContext";
import { authStyles as styles } from "../../src/auth/authStyles";
import { light } from "../../src/lightTheme";
import { createOnboarding } from "../../src/social/onboarding";
import { onboardingStore, signInGate } from "../../src/social/providerSession";

const PROVIDER_NAME = { google: "Google", apple: "Apple" } as const;

export default function SocialOnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { establish } = useAuth();
  const { offer } = useSyncExternalStore(onboardingStore.subscribe, onboardingStore.getSnapshot);

  const [username, setUsername] = useState(offer?.suggested_username ?? "");
  const [firstName, setFirstName] = useState(offer?.first_name ?? "");
  const [email, setEmail] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkEmail, setLinkEmail] = useState("");
  const [linkPassword, setLinkPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const usernameRef = useRef<TextInput>(null);

  const onboarding = useMemo(
    () =>
      createOnboarding({
        store: onboardingStore,
        establish,
        complete: socialComplete,
        linkExisting: socialLinkExisting,
        gate: signInGate,
        // Sent now because it cannot be reconstructed later: weekly volume is cut in the
        // person's own week. Same as registration.
        timezone: () => Localization.getCalendars()[0]?.timeZone ?? undefined,
      }),
    [establish],
  );

  const leave = () => {
    onboardingStore.clear();
    if (router.canGoBack()) router.back();
    else router.replace("/login");
  };

  if (!offer) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 32, paddingHorizontal: 24 }]}>
        <Text accessibilityRole="header" style={styles.title}>
          Sign in again
        </Text>
        <Text style={localStyles.body}>
          That sign-in expired or was already used. Go back and sign in with Google or Apple again.
        </Text>
        <Pressable accessibilityRole="button" style={styles.button} onPress={leave}>
          <Text style={styles.buttonText}>Back to sign in</Text>
        </Pressable>
      </View>
    );
  }

  const provider = PROVIDER_NAME[offer.provider];

  const finish = async (run: () => ReturnType<typeof onboarding.create>) => {
    setError(null);
    setBusy(true);
    const outcome = await run();
    if (outcome.kind === "ignored") return; // the running attempt owns the busy state
    // On success there is no navigation here: the auth layout redirects once status flips.
    if (outcome.kind === "email-in-use") {
      // Offer the way forward instead of only an error.
      setLinkOpen(true);
      setLinkEmail(email.trim() || (offer.email_is_usable ? (offer.email ?? "") : ""));
      setError(outcome.message);
    } else if (
      outcome.kind === "invalid" ||
      outcome.kind === "username-taken" ||
      outcome.kind === "failed" ||
      outcome.kind === "expired"
    ) {
      setError(outcome.message);
    }
    setBusy(false);
  };

  const create = () => finish(() => onboarding.create({ username, firstName, email }));
  const link = () => finish(() => onboarding.link({ email: linkEmail, password: linkPassword }));

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + 32, paddingBottom: Math.max(insets.bottom, 24) + 16 },
          ]}
        >
          <Text accessibilityRole="header" style={styles.title}>
            Almost there.
          </Text>
          <Text style={localStyles.body}>
            You signed in with {provider}. Choose a username to create your Aures account.
          </Text>

          <View style={styles.field}>
            <Text style={styles.label}>Username</Text>
            <TextInput
              ref={usernameRef}
              style={styles.input}
              accessibilityLabel="Username"
              testID="onboarding-username"
              placeholder="lifter_42"
              placeholderTextColor={light.textSecondary}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              selectionColor={light.text}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>
              First name <Text style={styles.optional}>(optional)</Text>
            </Text>
            <TextInput
              style={styles.input}
              accessibilityLabel="First name, optional"
              testID="onboarding-first-name"
              value={firstName}
              onChangeText={setFirstName}
              autoCapitalize="words"
              textContentType="givenName"
              returnKeyType={offer.email_is_usable ? "go" : "next"}
              onSubmitEditing={offer.email_is_usable ? create : undefined}
              placeholderTextColor={light.textSecondary}
              selectionColor={light.text}
            />
          </View>

          {offer.email_is_usable ? (
            <View style={styles.field}>
              <Text style={styles.label}>Email</Text>
              <Text style={localStyles.readonly} accessibilityLabel={`Email ${offer.email ?? ""}`}>
                {offer.email}
              </Text>
              {offer.is_private_email ? (
                <Text style={localStyles.note}>
                  This is the private relay address Apple created for you. Mail sent to it is
                  forwarded to your real inbox.
                </Text>
              ) : null}
            </View>
          ) : (
            <View style={styles.field}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                accessibilityLabel="Email"
                testID="onboarding-email"
                placeholder="name@example.com"
                placeholderTextColor={light.textSecondary}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete="email"
                returnKeyType="go"
                onSubmitEditing={create}
                selectionColor={light.text}
              />
              <Text style={localStyles.note}>
                {provider} did not share a usable email address, so we need one for your account.
              </Text>
            </View>
          )}

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
            testID="onboarding-create"
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, busy && styles.buttonBusy]}
            onPress={create}
            disabled={busy}
          >
            {busy ? <ActivityIndicator color={light.onPrimary} /> : <Text style={styles.buttonText}>Create account</Text>}
          </Pressable>

          <View style={localStyles.section}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: linkOpen }}
              testID="onboarding-have-account"
              style={styles.linkButton}
              onPress={() => setLinkOpen((open) => !open)}
            >
              <Text style={styles.link}>I already have an Aures account</Text>
            </Pressable>

            {linkOpen ? (
              <View>
                <Text style={localStyles.body}>
                  Sign in to your account to add {provider} to it. Use the email and password you
                  signed up with.
                </Text>
                <View style={styles.field}>
                  <Text style={styles.label}>Aures email</Text>
                  <TextInput
                    style={styles.input}
                    accessibilityLabel="Aures account email"
                    testID="onboarding-link-email"
                    value={linkEmail}
                    onChangeText={setLinkEmail}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    textContentType="emailAddress"
                    returnKeyType="next"
                    placeholderTextColor={light.textSecondary}
                    selectionColor={light.text}
                  />
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>Password</Text>
                  <TextInput
                    style={styles.input}
                    accessibilityLabel="Aures account password"
                    testID="onboarding-link-password"
                    value={linkPassword}
                    onChangeText={setLinkPassword}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="password"
                    returnKeyType="go"
                    onSubmitEditing={link}
                    placeholderTextColor={light.textSecondary}
                    selectionColor={light.text}
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Sign in and link ${provider}`}
                  accessibilityState={{ busy, disabled: busy }}
                  testID="onboarding-link"
                  style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, busy && styles.buttonBusy]}
                  onPress={link}
                  disabled={busy}
                >
                  <Text style={styles.buttonText}>Sign in and link {provider}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          <View style={styles.footer}>
            <Pressable accessibilityRole="link" style={styles.linkButton} onPress={leave} disabled={busy}>
              <Text style={styles.link}>Use a different account</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const localStyles = StyleSheet.create({
  body: { color: light.textSecondary, fontSize: 15, lineHeight: 22, marginBottom: 20 },
  readonly: {
    minHeight: 52,
    backgroundColor: light.surface,
    borderColor: light.separator,
    borderWidth: 1,
    borderRadius: 12,
    color: light.text,
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    overflow: "hidden",
  },
  note: { color: light.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 6, marginLeft: 4 },
  section: { marginTop: 24 },
});
