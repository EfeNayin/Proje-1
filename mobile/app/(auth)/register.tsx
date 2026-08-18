import { Link } from "expo-router";
import { useState } from "react";
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
import * as Localization from "expo-localization";

import { useAuth } from "../../src/auth/AuthContext";
import { colors, radius, spacing } from "../../src/theme";

export default function RegisterScreen() {
  const { signUp } = useAuth();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Validate on press rather than disabling the button.
   *
   * A disabled button that does nothing when tapped gives the user no idea
   * what is wrong; they just tap and the screen sits there. Better to accept
   * the tap and say which field is the problem.
   */
  const findProblem = (): string | null => {
    if (!email.trim().includes("@")) return "Enter a valid email address.";
    if (username.trim().length < 3) return "Username must be at least 3 characters.";
    if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) {
      return "Username can only contain letters, numbers and underscores.";
    }
    if (password.length < 8) return "Password must be at least 8 characters.";
    return null;
  };

  const handleSubmit = async () => {
    const problem = findProblem();
    if (problem) {
      setError(problem);
      return;
    }

    setError(null);
    setBusy(true);
    try {
      await signUp({
        email: email.trim(),
        username: username.trim().toLowerCase(),
        password,
        display_name: displayName.trim() || undefined,
        // Sent at signup because it cannot be reconstructed later, and weekly
        // volume is sliced in the user's local week: a Monday 01:00 session in
        // Istanbul is Sunday 22:00 UTC and would otherwise land in the wrong
        // week.
        timezone: Localization.getCalendars()[0]?.timeZone ?? undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Create account</Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.textMuted}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />

        <TextInput
          style={styles.input}
          placeholder="Username (letters, numbers, _)"
          placeholderTextColor={colors.textMuted}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <TextInput
          style={styles.input}
          placeholder="Display name (optional)"
          placeholderTextColor={colors.textMuted}
          value={displayName}
          onChangeText={setDisplayName}
        />

        <TextInput
          style={styles.input}
          placeholder="Password (at least 8 characters)"
          placeholderTextColor={colors.textMuted}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color={colors.accentText} />
          ) : (
            <Text style={styles.buttonText}>Create account</Text>
          )}
        </Pressable>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have one? </Text>
          <Link href="/login" style={styles.link}>
            Sign in
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, justifyContent: "center", padding: spacing.lg },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "700",
    marginBottom: spacing.xl,
    textAlign: "center",
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: 16,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  error: { color: colors.danger, marginBottom: spacing.md },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    padding: spacing.md,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.accentText, fontSize: 16, fontWeight: "600" },
  footer: { flexDirection: "row", justifyContent: "center", marginTop: spacing.lg },
  footerText: { color: colors.textMuted },
  link: { color: colors.accent, fontWeight: "600" },
});
