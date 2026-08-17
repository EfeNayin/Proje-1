/**
 * Layout for the signed-out screens.
 *
 * A signed-in user landing here is bounced to the app, which also handles the
 * moment just after login: the auth state flips and this redirect fires.
 */

import { Redirect, Stack } from "expo-router";

import { useAuth } from "../../src/auth/AuthContext";
import { colors } from "../../src/theme";

export default function AuthLayout() {
  const { status } = useAuth();

  if (status === "signedIn") {
    return <Redirect href="/" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
