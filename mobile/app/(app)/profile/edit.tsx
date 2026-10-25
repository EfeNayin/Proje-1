/**
 * Profile edit screen.
 *
 * Only the fields the identity row shows are editable here — first name,
 * last name, username. Everything else (bio, units, timezone, ...) belongs
 * to the Personal Details / Preferences sections from a later task.
 */

import { Stack, useRouter } from "expo-router";
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

import { initials, updateMe } from "../../../src/api/auth";
import { ApiError } from "../../../src/api/client";
import { useAuth } from "../../../src/auth/AuthContext";
import { FocusedDarkStatusBar } from "../../../src/FocusedDarkStatusBar";
import { lightHeaderOptions } from "../../../src/lightHeaderOptions";
import { light } from "../../../src/lightTheme";

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
      // Syncs AuthContext.user so the identity row reflects the change the
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
      <Stack.Screen options={lightHeaderOptions} />
      <FocusedDarkStatusBar />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {initials({ first_name: firstName, last_name: lastName, username })}
          </Text>
        </View>

        <Text style={styles.label}>First name (optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="First name"
          placeholderTextColor={light.textSecondary}
          accessibilityLabel="First name, optional"
          value={firstName}
          onChangeText={setFirstName}
        />

        <Text style={styles.label}>Last name (optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="Last name"
          placeholderTextColor={light.textSecondary}
          accessibilityLabel="Last name, optional"
          value={lastName}
          onChangeText={setLastName}
        />

        <Text style={styles.label}>Username</Text>
        <TextInput
          style={styles.input}
          placeholder="Username"
          placeholderTextColor={light.textSecondary}
          accessibilityLabel="Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.hint}>At least 3 characters: letters, numbers and underscores.</Text>

        {error ? (
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>
            {error}
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save profile"
          accessibilityState={{ busy, disabled: busy }}
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
            busy && styles.buttonDisabled,
          ]}
          onPress={() => void handleSave()}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color={light.onPrimary} />
          ) : (
            <Text style={styles.buttonText}>Save</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: light.background },
  container: { flexGrow: 1, padding: 16, paddingBottom: 32 },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: light.surface,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginTop: 8,
    marginBottom: 24,
  },
  avatarText: { color: light.text, fontSize: 24, fontWeight: "600" },
  label: {
    color: light.textSecondary,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 6,
    marginLeft: 4,
  },
  input: {
    minHeight: 48,
    backgroundColor: light.surface,
    borderRadius: 10,
    color: light.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  hint: {
    color: light.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginTop: -8,
    marginBottom: 16,
    marginLeft: 4,
  },
  error: { color: light.danger, fontSize: 14, lineHeight: 20, marginBottom: 16 },
  button: {
    minHeight: 52,
    backgroundColor: light.primary,
    borderRadius: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  buttonPressed: { backgroundColor: light.primaryPressed },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: light.onPrimary, fontSize: 16, fontWeight: "600" },
});
