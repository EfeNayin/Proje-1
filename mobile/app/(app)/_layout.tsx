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
import { roman, romanFont, useRomanFonts } from "../../src/romanTheme";
import { colors } from "../../src/theme";

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

// Screens that draw their content in the Roman theme keep the native header
// (title + back arrow) but match its colours and font to the page.
const romanHeader = {
  headerStyle: { backgroundColor: roman.background },
  headerTitleStyle: { color: roman.gold, fontFamily: romanFont.title, fontSize: 18 },
  contentStyle: { backgroundColor: roman.background },
};

// The light counterpart for the coach screens (connections, workout review and
// program offers):
// set here rather than inside each screen so the header is already light while
// the screen is pushed, and the page behind it does not flash dark.
const lightHeader = {
  ...lightHeaderOptions,
  contentStyle: { backgroundColor: light.background },
};

export default function AppLayout() {
  const { status } = useAuth();
  // Registers the bundled fonts for the native header below; a deep link to
  // Research would otherwise draw its header before any screen had done so.
  useRomanFonts();

  if (status === "signedOut") {
    return <Redirect href="/login" />;
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        // Arrow only: without this iOS shows the previous screen's title, which for
        // screens pushed from the tabs is the raw route name "(tabs)".
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="diagnosis" options={{ title: "Diagnosis" }} />
      <Stack.Screen
        name="research"
        options={{ title: "Research", ...romanHeader }}
      />
      <Stack.Screen name="coaching/athletes" options={{ title: "My Athletes", ...lightHeader }} />
      <Stack.Screen name="coaching/coaches" options={{ title: "My Coaches", ...lightHeader }} />
      <Stack.Screen
        name="coaching/athlete/[linkId]/index"
        options={{ title: "Athlete", ...lightHeader }}
      />
      <Stack.Screen
        name="coaching/athlete/[linkId]/workout/[workoutId]"
        options={{ title: "Workout", ...lightHeader }}
      />
      <Stack.Screen
        name="coaching/athlete/[linkId]/send-program"
        options={{ title: "Send program", ...lightHeader }}
      />
      <Stack.Screen
        name="coaching/programs-received"
        options={{ title: "Received programs", ...lightHeader }}
      />
      <Stack.Screen
        name="coaching/program-offer/[offerId]"
        options={{ title: "Program", ...lightHeader }}
      />
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
