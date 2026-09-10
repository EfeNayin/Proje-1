/**
 * Root layout.
 *
 * Wraps everything in the auth provider and holds the app on a spinner while
 * the stored session is verified, so a signed-in user never sees the login
 * screen flash on launch.
 */

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { AuthProvider, useAuth } from "../src/auth/AuthContext";
import { colors } from "../src/theme";

function RootNavigator() {
  const { status, retryRestore } = useAuth();

  if (status === "loading") {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (status === "unavailable") {
    return (
      <View style={styles.loading}>
        <Text style={styles.title}>Unable to connect</Text>
        <Text style={styles.message}>
          We could not check your session. Your sign-in details are still saved.
          Check your connection and try again.
        </Text>
        <Pressable accessibilityRole="button" style={styles.retry} onPress={retryRestore}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  // Both groups are declared; each group's own layout redirects if the user
  // is on the wrong side of the auth boundary.
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(app)" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <RootNavigator />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 20, fontWeight: "600" },
  message: { color: colors.textMuted, textAlign: "center", marginTop: 12, maxWidth: 340 },
  retry: {
    backgroundColor: colors.accent,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 24,
  },
  retryText: { color: colors.accentText, fontWeight: "600" },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
    padding: 24,
  },
});
