/**
 * Signed-in area. The guard lives here; anyone without a session is sent to
 * login before a protected screen renders.
 *
 * A Stack rather than Tabs directly, because the active workout screen should
 * cover the tab bar: mid-set is not the moment to offer navigation elsewhere.
 */

import { Redirect, Stack } from "expo-router";

import { useAuth } from "../../src/auth/AuthContext";
import { colors } from "../../src/theme";

export default function AppLayout() {
  const { status } = useAuth();

  if (status === "signedOut") {
    return <Redirect href="/login" />;
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="workout/[id]" options={{ title: "Workout" }} />
      <Stack.Screen
        name="workout/exercise-picker"
        options={{ title: "Add exercise", presentation: "modal" }}
      />
      <Stack.Screen
        name="workout/checkin"
        options={{ title: "Check-in", presentation: "modal" }}
      />
      <Stack.Screen name="program/[id]" options={{ title: "Program" }} />
      <Stack.Screen name="program/template/[id]" options={{ title: "Template" }} />
      <Stack.Screen
        name="profile/edit"
        options={{ title: "Edit Profile", presentation: "modal" }}
      />
      <Stack.Screen name="profile/personal-details" options={{ title: "Personal Details" }} />
      <Stack.Screen name="profile/weight-history" options={{ title: "Weight History" }} />
    </Stack>
  );
}
