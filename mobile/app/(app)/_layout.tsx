/**
 * Signed-in area. The guard lives here; anyone without a session is sent to
 * login before a protected screen renders.
 *
 * A Stack rather than Tabs directly, because the active workout screen should
 * cover the tab bar: mid-set is not the moment to offer navigation elsewhere.
 */

import { Redirect, Stack } from "expo-router";

import { useAuth } from "../../src/auth/AuthContext";
import { lightHeaderOptions } from "../../src/lightHeaderOptions";
import { light } from "../../src/lightTheme";

/**
 * Deep links (and reloads) that land on a screen below the tabs, such as
 * /research, have no history of their own, so the stack would show no back
 * control. Anchoring on (tabs) puts the tabs — Training first — underneath
 * the linked screen, and the native back arrow, swipe-back gesture and Android
 * back button all return there. In-app navigation is unaffected: router.push
 * from a tab already stacks on top of it.
 */
export const unstable_settings = {
  anchor: "(tabs)",
};

export default function AppLayout() {
  const { status } = useAuth();

  if (status === "signedOut") {
    return <Redirect href="/login" />;
  }

  return (
    <Stack
      // Every screen in this area is light. The header and the page behind it
      // are set once here rather than per screen, so a pushed screen never
      // flashes a different colour while it mounts.
      screenOptions={{
        ...lightHeaderOptions,
        // Arrow only: without this iOS shows the previous screen's title, which for
        // screens pushed from the tabs is the raw route name "(tabs)".
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: light.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="diagnosis" options={{ title: "Diagnosis" }} />
      <Stack.Screen name="research" options={{ title: "Research" }} />
      <Stack.Screen name="coaching/athletes" options={{ title: "My Athletes" }} />
      <Stack.Screen name="coaching/coaches" options={{ title: "My Coaches" }} />
      <Stack.Screen name="coaching/athlete/[linkId]/index" options={{ title: "Athlete" }} />
      <Stack.Screen name="coaching/athlete/[linkId]/workout/[workoutId]" options={{ title: "Workout" }} />
      <Stack.Screen name="coaching/athlete/[linkId]/send-program" options={{ title: "Send program" }} />
      <Stack.Screen name="coaching/programs-received" options={{ title: "Received programs" }} />
      <Stack.Screen name="coaching/program-offer/[offerId]" options={{ title: "Program" }} />
      <Stack.Screen name="workout/[id]" options={{ title: "Workout" }} />
      <Stack.Screen
        name="workout/exercise-picker"
        options={{ title: "Add exercise", presentation: "modal" }}
      />
      <Stack.Screen
        name="workout/checkin"
        options={{ title: "Check-in", presentation: "modal" }}
      />
      {/* Draws its own bar (back arrow, delete, editable name); a native header too would show the name twice. */}
      <Stack.Screen name="program/[id]" options={{ title: "Program", headerShown: false }} />
      <Stack.Screen name="program/template/[id]" options={{ title: "Template" }} />
      <Stack.Screen
        name="profile/edit"
        options={{ title: "Edit Profile", presentation: "modal" }}
      />
      <Stack.Screen name="profile/personal-details" options={{ title: "Personal Details" }} />
      <Stack.Screen name="profile/weight-history" options={{ title: "Weight History" }} />
      <Stack.Screen name="profile/preferences" options={{ title: "Preferences" }} />
      <Stack.Screen name="profile/nutrition-goals" options={{ title: "Nutrition Goals" }} />
    </Stack>
  );
}
