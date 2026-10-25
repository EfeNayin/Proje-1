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
import { light } from "../src/lightTheme";

function RootNavigator() {
  const { status, retryRestore } = useAuth();

  if (status === "loading") {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={light.textSecondary} />
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
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: light.background } }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(app)" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      {/* The one status-bar owner: every screen is light, so dark icons everywhere. */}
      <StatusBar style="dark" />
      <RootNavigator />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  title: { color: light.text, fontSize: 20, fontWeight: "600" },
  message: {
    color: light.textSecondary,
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center",
    marginTop: 12,
    maxWidth: 340,
  },
  retry: {
    minHeight: 52,
    backgroundColor: light.primary,
    paddingHorizontal: 24,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
  },
  retryText: { color: light.onPrimary, fontSize: 16, fontWeight: "600" },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: light.background,
    padding: 24,
  },
});
