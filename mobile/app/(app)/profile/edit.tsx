/**
 * Profile edit screen.
 *
 * Only the fields the header card shows are editable here — first name,
 * last name, username. Everything else (bio, units, timezone, ...) belongs
 * to the Personal Details / Preferences sections from a later task.
 */

import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
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
} from "react-native";

import { initials, updateMe } from "../../../src/api/auth";
import { ApiError } from "../../../src/api/client";
import { useAuth } from "../../../src/auth/AuthContext";
import { colors, radius, spacing } from "../../../src/theme";

export default function EditProfileScreen() {
  const { user, refreshProfile } = useAuth();
  const router = useRouter();

  const [firstName, setFirstName] = useState(user?.first_name ?? "");
  const [lastName, setLastName] = useState(user?.last_name ?? "");
  const [username, setUsername] = useState(user?.username ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const findProblem = (): string | null => {
    const trimmed = username.trim();
    if (trimmed.length < 3) return "Username must be at least 3 characters.";
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
      return "Username can only contain letters, numbers and underscores.";
    }
    return null;
  };

  const handleSave = async () => {
    const problem = findProblem();
    if (problem) {
      setError(problem);
      return;
    }

    setError(null);
    setBusy(true);
    try {
      await updateMe({
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        username: username.trim(),
      });
      // Syncs AuthContext.user so the header card reflects the change the
      // moment we go back, rather than showing stale data until the next
      // pull-to-refresh.
      await refreshProfile();
      router.back();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError("Bu kullanıcı adı alınmış");
      } else {
        setError(err instanceof Error ? err.message : "Could not save changes");
      }
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
        <LinearGradient colors={[colors.accent, colors.accentDark]} style={styles.avatar}>
          <Text style={styles.avatarText}>{initials({ first_name: firstName, last_name: lastName, username })}</Text>
        </LinearGradient>

        <Text style={styles.label}>First Name</Text>
        <TextInput
          style={styles.input}
          placeholder="First name"
          placeholderTextColor={colors.textMuted}
          value={firstName}
          onChangeText={setFirstName}
        />

        <Text style={styles.label}>Last Name</Text>
        <TextInput
          style={styles.input}
          placeholder="Last name"
          placeholderTextColor={colors.textMuted}
          value={lastName}
          onChangeText={setLastName}
        />

        <Text style={styles.label}>Username</Text>
        <TextInput
          style={styles.input}
          placeholder="Username"
          placeholderTextColor={colors.textMuted}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={() => void handleSave()}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color={colors.accentText} />
          ) : (
            <Text style={styles.buttonText}>Save</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, padding: spacing.lg },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: spacing.xl,
  },
  avatarText: { color: colors.accentText, fontSize: 32, fontWeight: "700" },
  label: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.xs },
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
});
