/**
 * Layout for the signed-in screens. The guard: anyone without a session is
 * sent to login before a protected screen can render.
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
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
