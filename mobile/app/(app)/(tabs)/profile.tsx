/**
 * Profile screen.
 *
 * Restrained light style shared with Training, Programs and Volume: system
 * font, a compact identity row and grouped settings rows. The identity row
 * taps through to /profile/edit. Below it: the latest weigh-in (linking to
 * weight history) and the menu, grouped into sections. Sign out sits apart at
 * the bottom.
 *
 * The weigh-in row shows the API's most recent measurement with its date and
 * says so ("Last recorded"): it is not today's weight. Nothing is calculated
 * here. "No weight recorded yet" and "could not load" are different states and
 * never share text.
 */

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fullName, initials } from "../../../src/api/auth";
import * as bodyApi from "../../../src/api/body";
import { useAuth } from "../../../src/auth/AuthContext";
import { FocusedDarkStatusBar } from "../../../src/FocusedDarkStatusBar";
import { light } from "../../../src/lightTheme";
import {
  createBodySummaryLoader,
  initialBodySummaryState,
} from "../../../src/profile/bodySummaryLoader";
import { describeLatestWeight } from "../../../src/profile/profilePresentation";
import { createSignOutAction } from "../../../src/profile/signOutAction";

const MIN_TOUCH = 44;

type IconName = React.ComponentProps<typeof Ionicons>["name"];

function MenuRow({
  icon,
  label,
  hint,
  onPress,
  last,
}: {
  icon: IconName;
  label: string;
  hint: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${hint}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={22} color={light.textSecondary} />
      <View style={[styles.rowBody, !last && styles.rowDivider]}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>{label}</Text>
          <Text style={styles.rowHint}>{hint}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={light.textSecondary} />
      </View>
    </Pressable>
  );
}

export default function ProfileScreen() {
  const { user, signOut, refreshProfile } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const [bodyState, setBodyState] = useState(initialBodySummaryState);
  const [bodyLoader] = useState(() => createBodySummaryLoader(bodyApi.fetchBodySummary, setBodyState));
  const submitSignOut = useMemo(
    () => createSignOutAction(signOut, () => setSigningOut(true)),
    [signOut],
  );

  const userId = user?.id ?? null;

  // Reload on focus: returning from Personal Details or Weight History shows
  // the new weight. The profile itself is refreshed by those screens through
  // AuthContext.
  useFocusEffect(
    useCallback(() => {
      if (userId === null) return undefined;
      void bodyLoader.load(userId);
      return () => bodyLoader.invalidate();
    }, [bodyLoader, userId]),
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const reload = userId !== null ? bodyLoader.load(userId) : Promise.resolve();
      try {
        await refreshProfile();
      } catch (err) {
        // The last known profile stays on screen; the client already signs the
        // user out if the session is genuinely gone.
        setRefreshError(err instanceof Error && err.message ? err.message : "Could not refresh");
      }
      await reload;
    } finally {
      setRefreshing(false);
    }
  };

  const handleSignOut = async () => {
    setSignOutError(null);
    const outcome = await submitSignOut();
    if (outcome.kind === "ignored") return; // the running sign-out owns the busy state
    setSigningOut(false);
    if (outcome.kind === "failed") setSignOutError(outcome.message);
  };

  const topBar = (
    <View style={[styles.topBar, { paddingTop: insets.top }]}>
      <View style={styles.topBarRow}>
        <Text accessibilityRole="header" style={styles.topBarTitle}>
          Profile
        </Text>
      </View>
    </View>
  );

  if (!user) {
    return (
      <View style={styles.screen}>
        <FocusedDarkStatusBar />
        {topBar}
        <View style={styles.centered}>
          <ActivityIndicator color={light.textSecondary} />
        </View>
      </View>
    );
  }

  const name = fullName(user);
  // Never another user's weight, even for the render before the focus effect runs.
  const own = bodyState.userId === user.id;
  const summary = own ? bodyState.summary : null;
  const bodyLoading = !own || bodyState.loading;
  const bodyError = own ? bodyState.error : null;
  const latest = summary ? describeLatestWeight(summary, user.weight_unit) : null;
  const retryBody = () => void bodyLoader.load(user.id);

  return (
    <View style={styles.screen}>
      <FocusedDarkStatusBar />
      {topBar}
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.container, { paddingBottom: 32 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void handleRefresh()}
            tintColor={light.textSecondary}
            colors={[light.textSecondary]}
            progressBackgroundColor={light.surface}
          />
        }
      >
        {refreshError ? (
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[styles.errorText, styles.refreshError]}
          >
            {`Could not refresh your profile: ${refreshError}`}
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Edit profile. ${name ?? user.username}, username ${user.username}`}
          style={({ pressed }) => [styles.group, styles.identity, pressed && styles.pressed]}
          onPress={() => router.push("/profile/edit")}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials(user)}</Text>
          </View>
          <View style={styles.identityText}>
            <Text numberOfLines={2} style={styles.name}>
              {name ?? user.username}
            </Text>
            {/* Without a name the username is already the title; repeating it would just stutter. */}
            {name ? (
              <Text numberOfLines={1} style={styles.username}>
                @{user.username}
              </Text>
            ) : null}
          </View>
          <Text style={styles.editText}>Edit</Text>
          <Ionicons name="chevron-forward" size={18} color={light.textSecondary} />
        </Pressable>

        <Text accessibilityRole="header" style={styles.sectionLabel}>
          Body
        </Text>
        <View style={styles.group}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              latest?.kind === "recorded"
                ? `Weight history. ${latest.accessibilityLabel}`
                : latest?.kind === "none"
                  ? "Weight history. No weight recorded yet"
                  : "Weight history"
            }
            accessibilityHint="Opens weight history"
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            onPress={() => router.push("/profile/weight-history")}
          >
            <Ionicons name="trending-up" size={22} color={light.textSecondary} />
            <View style={[styles.rowBody, bodyError ? styles.rowDivider : null]}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>Weight history</Text>
                {latest?.kind === "recorded" ? (
                  <>
                    <Text style={styles.weightValue}>{latest.value}</Text>
                    {/* "Last recorded", with its date: the newest entry, not necessarily today's weight. */}
                    <Text style={styles.rowHint}>
                      {latest.date ? `Last recorded ${latest.date}` : "Last recorded"}
                    </Text>
                  </>
                ) : latest?.kind === "none" ? (
                  <Text style={styles.rowHint}>No weight recorded yet</Text>
                ) : bodyLoading && !bodyError ? (
                  <Text style={styles.rowHint}>Loading latest weigh-in…</Text>
                ) : (
                  <Text style={styles.rowHint}>View your weigh-ins</Text>
                )}
              </View>
              {bodyLoading && !bodyError && latest === null ? (
                <ActivityIndicator size="small" color={light.textSecondary} />
              ) : (
                <Ionicons name="chevron-forward" size={18} color={light.textSecondary} />
              )}
            </View>
          </Pressable>

          {/* Not recorded and could not load are different things, so they get different text. */}
          {bodyError ? (
            <View style={styles.bodyError}>
              <Text
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={styles.errorText}
              >
                {latest
                  ? `Could not refresh. Showing the last loaded weight. ${bodyError}`
                  : `Could not load your latest weight. ${bodyError}`}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Try loading your weight again"
                disabled={bodyState.refreshing || bodyState.loading}
                style={styles.retryButton}
                onPress={retryBody}
              >
                {bodyState.refreshing || bodyState.loading ? (
                  <ActivityIndicator color={light.text} size="small" />
                ) : (
                  <Text style={styles.retryText}>Try again</Text>
                )}
              </Pressable>
            </View>
          ) : null}
        </View>

        <Text accessibilityRole="header" style={styles.sectionLabel}>
          Account
        </Text>
        <View style={styles.group}>
          <MenuRow
            icon="id-card-outline"
            label="Personal Details"
            hint="Manage your profile details"
            onPress={() => router.push("/profile/personal-details")}
          />
          <MenuRow
            icon="options-outline"
            label="Preferences"
            hint="Weight unit, rest timer, time zone"
            onPress={() => router.push("/profile/preferences")}
            last
          />
        </View>

        <Text accessibilityRole="header" style={styles.sectionLabel}>
          Goals & Tracking
        </Text>
        <View style={styles.group}>
          <MenuRow
            icon="nutrition-outline"
            label="Nutrition Goals"
            hint="View and update your targets"
            onPress={() => router.push("/profile/nutrition-goals")}
            last
          />
        </View>

        <Text accessibilityRole="header" style={styles.sectionLabel}>
          Coaching
        </Text>
        <View style={styles.group}>
          <MenuRow
            icon="people-outline"
            label="My Coaches"
            hint="Connect with a coach using an invite code"
            onPress={() => router.push("/coaching/coaches")}
          />
          <MenuRow
            icon="clipboard-outline"
            label={user.coach_enabled ? "My Athletes" : "Coach Tools"}
            hint={
              user.coach_enabled
                ? "Invite athletes and see who is connected"
                : "Turn on to invite athletes"
            }
            onPress={() => router.push("/coaching/athletes")}
            last
          />
        </View>

        {signOutError ? (
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[styles.errorText, styles.signOutError]}
          >
            {signOutError}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          accessibilityState={{ busy: signingOut, disabled: signingOut }}
          disabled={signingOut}
          style={({ pressed }) => [
            styles.group,
            styles.signOut,
            pressed && styles.pressed,
            signingOut && styles.busy,
          ]}
          onPress={() => void handleSignOut()}
        >
          {signingOut ? (
            <ActivityIndicator color={light.danger} size="small" />
          ) : (
            <>
              <Ionicons name="log-out-outline" size={20} color={light.danger} />
              <Text style={styles.signOutText}>Sign out</Text>
            </>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  container: { paddingHorizontal: 16 },
  pressed: { backgroundColor: light.pressed },
  busy: { opacity: 0.6 },

  topBar: { backgroundColor: light.background, paddingHorizontal: 16 },
  topBarRow: { minHeight: 56, flexDirection: "row", alignItems: "center" },
  topBarTitle: { flexShrink: 1, color: light.text, fontSize: 28, fontWeight: "700" },

  errorText: { color: light.danger, fontSize: 14, lineHeight: 20 },
  refreshError: { marginBottom: 12 },

  group: {
    backgroundColor: light.surface,
    borderRadius: 12,
    overflow: "hidden",
  },
  identity: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: light.background,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: light.text, fontSize: 18, fontWeight: "600" },
  identityText: { flex: 1, rowGap: 2 },
  name: { color: light.text, fontSize: 18, lineHeight: 24, fontWeight: "600" },
  username: { color: light.textSecondary, fontSize: 14, lineHeight: 20 },
  editText: { color: light.textSecondary, fontSize: 15 },

  sectionLabel: {
    color: light.textSecondary,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 24,
    marginBottom: 8,
    marginLeft: 4,
  },
  row: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 14,
    paddingLeft: 16,
  },
  // The hairline starts at the text, not at the card edge, like iOS grouped lists.
  rowBody: {
    flex: 1,
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 8,
    paddingVertical: 10,
    paddingRight: 16,
  },
  rowDivider: { borderBottomColor: light.separator, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, rowGap: 2 },
  rowTitle: { color: light.text, fontSize: 16, lineHeight: 22 },
  rowHint: { color: light.textSecondary, fontSize: 13, lineHeight: 18 },
  weightValue: { color: light.text, fontSize: 20, lineHeight: 26, fontWeight: "600" },

  bodyError: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
    rowGap: 2,
  },
  retryButton: {
    minHeight: MIN_TOUCH,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingRight: 12,
  },
  retryText: { color: light.text, fontSize: 15, fontWeight: "600", textDecorationLine: "underline" },

  // Set apart from the settings above: more space, red text plus an icon and
  // the label, so the meaning never rests on the colour.
  signOutError: { marginTop: 32 },
  signOut: {
    minHeight: 52,
    flexDirection: "row",
    columnGap: 8,
    marginTop: 32,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  signOutText: { color: light.danger, fontSize: 16, fontWeight: "600" },
});
