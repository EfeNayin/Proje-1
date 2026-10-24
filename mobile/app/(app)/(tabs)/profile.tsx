/**
 * Profile screen.
 *
 * The header card is editable (taps through to /profile/edit). Below it: the
 * latest weigh-in (linking to weight history) and the menu, grouped into
 * sections. Sign out sits apart at the bottom.
 *
 * The weigh-in card shows the API's most recent measurement with its date and
 * says so ("Last recorded"): it is not today's weight. Nothing is calculated
 * here.
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
import {
  createBodySummaryLoader,
  initialBodySummaryState,
} from "../../../src/profile/bodySummaryLoader";
import { describeLatestWeight } from "../../../src/profile/profilePresentation";
import { createSignOutAction } from "../../../src/profile/signOutAction";
import { roman, useRomanFonts } from "../../../src/romanTheme";

const MIN_TOUCH = 44;

type Fonts = ReturnType<typeof useRomanFonts>;
type IconName = React.ComponentProps<typeof Ionicons>["name"];

function MenuRow({
  icon,
  label,
  hint,
  onPress,
  last,
  font,
}: {
  icon: IconName;
  label: string;
  hint: string;
  onPress: () => void;
  last?: boolean;
  font: Fonts;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${hint}`}
      style={({ pressed }) => [
        styles.row,
        !last && styles.rowDivider,
        pressed && styles.pressed,
      ]}
      onPress={onPress}
    >
      <View style={styles.iconBox}>
        <Ionicons name={icon} size={20} color={roman.gold} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, font.semibold]}>{label}</Text>
        <Text style={[styles.rowHint, font.regular]}>{hint}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={roman.textMuted} />
    </Pressable>
  );
}

export default function ProfileScreen() {
  const { user, signOut, refreshProfile } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const font = useRomanFonts();

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
        <Text accessibilityRole="header" style={[styles.topBarTitle, font.title]}>
          Profile
        </Text>
      </View>
    </View>
  );

  if (!user) {
    return (
      <View style={styles.screen}>
        {topBar}
        <View style={styles.centered}>
          <ActivityIndicator color={roman.gold} />
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
      {topBar}
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void handleRefresh()}
            tintColor={roman.gold}
            colors={[roman.gold]}
            progressBackgroundColor={roman.surface}
          />
        }
      >
        {refreshError ? (
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[styles.errorText, styles.refreshError, font.medium]}
          >
            {`Could not refresh your profile: ${refreshError}`}
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Edit profile. ${name ?? user.username}, username ${user.username}`}
          style={({ pressed }) => [styles.headerCard, pressed && styles.pressed]}
          onPress={() => router.push("/profile/edit")}
        >
          <View style={styles.avatar}>
            <Text style={[styles.avatarText, font.title]}>{initials(user)}</Text>
          </View>
          <View style={styles.headerText}>
            <Text style={[styles.name, font.semibold]}>{name ?? user.username}</Text>
            {/* Without a name the username is already the title; repeating it would just stutter. */}
            {name ? (
              <Text style={[styles.username, font.regular]}>@{user.username}</Text>
            ) : null}
          </View>
          <View style={styles.editPill}>
            <Ionicons name="pencil" size={14} color={roman.goldLight} />
            <Text style={[styles.editText, font.semibold]}>Edit</Text>
          </View>
        </Pressable>

        <Text accessibilityRole="header" style={[styles.sectionLabel, font.semibold]}>
          Body
        </Text>
        <View style={styles.card}>
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
            <View style={styles.iconBox}>
              <Ionicons name="trending-up" size={20} color={roman.gold} />
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, font.semibold]}>Weight history</Text>
              {latest?.kind === "recorded" ? (
                <>
                  <Text style={[styles.weightValue, font.semibold]}>{latest.value}</Text>
                  {/* "Last recorded", with its date: the newest entry, not necessarily today's weight. */}
                  <Text style={[styles.rowHint, font.regular]}>
                    {latest.date ? `Last recorded ${latest.date}` : "Last recorded"}
                  </Text>
                </>
              ) : latest?.kind === "none" ? (
                <Text style={[styles.rowHint, font.regular]}>No weight recorded yet</Text>
              ) : bodyLoading && !bodyError ? (
                <Text style={[styles.rowHint, font.regular]}>Loading latest weigh-in…</Text>
              ) : (
                <Text style={[styles.rowHint, font.regular]}>View your weigh-ins</Text>
              )}
            </View>
            {bodyLoading && !bodyError && latest === null ? (
              <ActivityIndicator size="small" color={roman.textMuted} />
            ) : (
              <Ionicons name="chevron-forward" size={18} color={roman.textMuted} />
            )}
          </Pressable>

          {/* Not recorded and could not load are different things, so they get different text. */}
          {bodyError ? (
            <View style={styles.bodyError}>
              <Text
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={[styles.errorText, font.medium]}
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
                  <ActivityIndicator color={roman.goldLight} size="small" />
                ) : (
                  <Text style={[styles.retryText, font.semibold]}>Try again</Text>
                )}
              </Pressable>
            </View>
          ) : null}
        </View>

        <Text accessibilityRole="header" style={[styles.sectionLabel, styles.sectionSpaced, font.semibold]}>
          Account
        </Text>
        <View style={styles.card}>
          <MenuRow
            icon="id-card-outline"
            label="Personal Details"
            hint="Manage your profile details"
            onPress={() => router.push("/profile/personal-details")}
            font={font}
          />
          <MenuRow
            icon="options-outline"
            label="Preferences"
            hint="Weight unit, rest timer, time zone"
            onPress={() => router.push("/profile/preferences")}
            last
            font={font}
          />
        </View>

        <Text accessibilityRole="header" style={[styles.sectionLabel, styles.sectionSpaced, font.semibold]}>
          Goals & Tracking
        </Text>
        <View style={styles.card}>
          <MenuRow
            icon="nutrition-outline"
            label="Nutrition Goals"
            hint="View and update your targets"
            onPress={() => router.push("/profile/nutrition-goals")}
            last
            font={font}
          />
        </View>

        <Text accessibilityRole="header" style={[styles.sectionLabel, styles.sectionSpaced, font.semibold]}>
          Coaching
        </Text>
        <View style={styles.card}>
          <MenuRow
            icon="people-outline"
            label="My Coaches"
            hint="Connect with a coach using an invite code"
            onPress={() => router.push("/coaching/coaches")}
            font={font}
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
            font={font}
          />
        </View>

        {signOutError ? (
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[styles.errorText, styles.signOutError, font.medium]}
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
            styles.signOut,
            pressed && styles.signOutPressed,
            signingOut && styles.busy,
          ]}
          onPress={() => void handleSignOut()}
        >
          {signingOut ? (
            <ActivityIndicator color={roman.danger} size="small" />
          ) : (
            <>
              <Ionicons name="log-out-outline" size={20} color={roman.danger} />
              <Text style={[styles.signOutText, font.semibold]}>Sign out</Text>
            </>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: roman.background },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  container: { paddingHorizontal: 16, paddingBottom: 32 },
  pressed: { backgroundColor: roman.surfaceRaised },
  busy: { opacity: 0.6 },

  topBar: { backgroundColor: roman.background, paddingHorizontal: 16 },
  topBarRow: { minHeight: 56, flexDirection: "row", alignItems: "center" },
  topBarTitle: {
    flexShrink: 1,
    color: roman.gold,
    fontSize: 22,
    fontWeight: "600",
    letterSpacing: 2,
    textTransform: "uppercase",
  },

  errorText: { color: roman.danger, fontSize: 14, lineHeight: 20 },
  refreshError: { marginTop: 8 },

  headerCard: {
    minHeight: 88,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 14,
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    marginBottom: 24,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderColor: roman.gold,
    borderWidth: 1.5,
    backgroundColor: roman.background,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: roman.gold, fontSize: 22, fontWeight: "600" },
  headerText: { flex: 1, rowGap: 2 },
  name: { color: roman.text, fontSize: 18, lineHeight: 24 },
  username: { color: roman.textMuted, fontSize: 14, lineHeight: 20 },
  editPill: {
    minHeight: MIN_TOUCH,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 6,
    paddingHorizontal: 12,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: roman.surfaceRaised,
  },
  editText: {
    color: roman.goldLight,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: "uppercase",
  },

  sectionLabel: {
    color: roman.gold,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  sectionSpaced: { marginTop: 24 },
  card: {
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
  },
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  rowDivider: { borderBottomColor: roman.border, borderBottomWidth: StyleSheet.hairlineWidth },
  iconBox: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: 10,
    backgroundColor: roman.background,
    borderColor: roman.border,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, rowGap: 2 },
  rowTitle: { color: roman.text, fontSize: 16, lineHeight: 22 },
  rowHint: { color: roman.textMuted, fontSize: 13, lineHeight: 18 },
  weightValue: { color: roman.goldLight, fontSize: 20, lineHeight: 26 },

  bodyError: {
    borderTopColor: roman.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
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
  retryText: { color: roman.goldLight, fontSize: 14 },

  // Set apart from the settings above: more space and its own outlined shape.
  signOutError: { marginTop: 32 },
  signOut: {
    minHeight: 52,
    flexDirection: "row",
    columnGap: 8,
    marginTop: 40,
    borderColor: roman.danger,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  signOutPressed: { backgroundColor: roman.surface },
  signOutText: { color: roman.danger, fontSize: 15, letterSpacing: 0.5 },
});
