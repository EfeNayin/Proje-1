/**
 * The rest countdown away from the workout screen.
 *
 * Three hosts, one look:
 *  - RestTimerStrip: in the tab bar, on the four tabs. In the layout flow, not
 *    floating, so it can never cover the last row of a list or sit under the
 *    tab bar or the safe area.
 *  - RestTimerOverlay: floats above a past workout's page.
 *  - RestCountdownChip: inside the exercise-history panel, a full-screen modal
 *    that would otherwise hide the countdown.
 *
 * Tapping a pill returns to the same workout (see useReturnToWorkout).
 * None of them exist unless a countdown is still running: when it ends the
 * pill is simply gone.
 */

import { Ionicons } from "@expo/vector-icons";
import { useGlobalSearchParams, useRouter, useSegments } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../auth/AuthContext";
import { light } from "../lightTheme";
import { formatRest } from "./restPreference";
import { pillOverlayAllowed, restTimerStore, spokenDuration } from "./restTimerStore";
import { useRestTimer } from "./useRestTimer";

/**
 * Brings the user back to a workout without creating one and without stacking
 * a second copy of its screen: when the workout's screen is still in the stack
 * (a past workout was opened on top of it) it is popped back to, otherwise the
 * workout is pushed. Repeated taps while the navigation is still settling are
 * ignored.
 */
function useReturnToWorkout(workoutId: string): () => void {
  const router = useRouter();
  const segments = useSegments();
  const route = segments.join("/");
  const busy = useRef(false);
  const release = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The screen changed: the tap has taken effect.
  useEffect(() => {
    busy.current = false;
  }, [route]);

  useEffect(
    () => () => {
      if (release.current !== null) clearTimeout(release.current);
    },
    [],
  );

  return useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    // Safety net only: if the route never changes (e.g. navigation was refused) the pill must not stay dead.
    release.current = setTimeout(() => {
      busy.current = false;
    }, 1000);
    const href = `/workout/${workoutId}` as const;
    if (restTimerStore.isWorkoutScreenOpen(workoutId)) router.dismissTo(href);
    else router.push(href);
  }, [router, workoutId]);
}

function RestTimerPill({ workoutId, remaining }: { workoutId: string; remaining: number }) {
  const returnToWorkout = useReturnToWorkout(workoutId);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Rest timer, ${spokenDuration(remaining)} remaining. Return to workout`}
      // The countdown changes every second; reading it out each time would drown the screen reader.
      style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
      onPress={returnToWorkout}
    >
      <Ionicons name="timer-outline" size={18} color={light.onPrimary} />
      <Text style={styles.time}>{formatRest(remaining)}</Text>
      <Ionicons name="chevron-forward" size={14} color={light.onPrimary} />
    </Pressable>
  );
}

/** On the tabs: a row above the tab bar, only while a countdown runs. */
export function RestTimerStrip() {
  const { user } = useAuth();
  const { timer, remaining, live } = useRestTimer(user?.id);
  if (!live || !timer) return null;

  return (
    <View style={styles.strip}>
      <RestTimerPill workoutId={timer.workoutId} remaining={remaining} />
    </View>
  );
}

/** Over a past workout's page (any workout other than the timer's own). */
export function RestTimerOverlay() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const params = useGlobalSearchParams<{ id?: string | string[] }>();
  const { timer, remaining, live, state } = useRestTimer(user?.id);

  const routeWorkoutId = Array.isArray(params.id) ? params.id[0] : params.id;
  if (
    !live ||
    !timer ||
    state.pillSuppressions > 0 ||
    !pillOverlayAllowed(segments, routeWorkoutId, timer.workoutId)
  ) {
    return null;
  }

  return (
    // box-none: only the pill takes touches, the page underneath stays usable around it.
    <View pointerEvents="box-none" style={[styles.overlay, { bottom: Math.max(insets.bottom, 8) + 12 }]}>
      <RestTimerPill workoutId={timer.workoutId} remaining={remaining} />
    </View>
  );
}

/** Inside the exercise-history panel. Informational: the panel is a modal, there is nowhere to go from it. */
export function RestCountdownChip() {
  const { user } = useAuth();
  const { remaining, live } = useRestTimer(user?.id);
  if (!live) return null;

  return (
    <View
      accessible
      accessibilityLabel={`Rest timer, ${spokenDuration(remaining)} remaining`}
      style={styles.chip}
    >
      <Ionicons name="timer-outline" size={14} color={light.onPrimary} />
      <Text style={styles.chipTime}>{formatRest(remaining)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: light.primary,
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  pillPressed: { backgroundColor: light.primaryPressed },
  time: {
    color: light.onPrimary,
    fontSize: 17,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  strip: {
    alignItems: "center",
    paddingVertical: 6,
    backgroundColor: light.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: light.separator,
  },
  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
    borderRadius: 14,
    backgroundColor: light.primary,
  },
  chipTime: {
    color: light.onPrimary,
    fontSize: 14,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
});
