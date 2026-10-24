/**
 * My Athletes: turn on coach tools, create single-use invite codes and see who
 * has accepted.
 *
 * Turning coach tools on only adds this screen's abilities. It gives no access
 * to anyone's data. A coach can read an athlete's completed workouts only after
 * that athlete switches sharing on for this connection; weight and nutrition
 * are never shared. The backend enforces who may do what; hiding things here
 * is only a convenience.
 */

import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../../../src/auth/AuthContext";
import { coachingStore } from "../../../src/coaching/coachingSession";
import { ConnectionRow } from "../../../src/coaching/ConnectionRow";
import { formatExpiry, personName } from "../../../src/coaching/presentation";
import { useCoaching } from "../../../src/coaching/useCoaching";
import { roman, romanFont, useRomanFonts } from "../../../src/romanTheme";

const MIN_TOUCH = 44;

export default function MyAthletesScreen() {
  const { user, refreshProfile } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  useRomanFonts();
  const userId = user?.id ?? null;
  const coachEnabled = user?.coach_enabled ?? false;
  const state = useCoaching(userId);
  const [notice, setNotice] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      coachingStore.bind(userId);
      if (coachEnabled) void coachingStore.load("coach");
    }, [userId, coachEnabled]),
  );

  const enable = async () => {
    setNotice(null);
    const outcome = await coachingStore.enableCoach();
    if (outcome.kind === "stale" || outcome.kind === "ignored") return;
    if (outcome.kind === "done" || (outcome.kind === "failed" && outcome.ambiguous)) {
      // After a lost response the profile is the source of truth: re-read it.
      try {
        await refreshProfile();
      } catch {
        // The server may well have it on already; do not leave the card silent.
        setNotice(
          "We could not confirm that coach tools are on. Tap Turn on again to check; it is safe to repeat.",
        );
        return;
      }
    }
    if (outcome.kind === "failed") setNotice(outcome.message);
  };

  const confirmEnable = () =>
    Alert.alert(
      "Turn on coach tools?",
      "You will be able to invite athletes. Your own training stays exactly as it is, and this gives you no access to anyone's data.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Turn on", onPress: () => void enable() },
      ],
    );

  const createInvite = async () => {
    setNotice(null);
    await coachingStore.createInvite(); // failures land in state.invite.error
  };

  const end = async (linkId: string, name: string) => {
    setNotice(null);
    const outcome = await coachingStore.endConnection("coach", linkId);
    if (outcome.kind === "failed" || outcome.kind === "unknown") setNotice(outcome.message);
    if (outcome.kind === "done") setNotice(`Connection with ${name} ended.`);
  };

  const confirmEnd = (linkId: string, name: string) =>
    Alert.alert(
      `End connection with ${name}?`,
      "No account, program or workout is deleted. To connect again, they will need a new invite code.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "End connection", style: "destructive", onPress: () => void end(linkId, name) },
      ],
    );

  const padding = { paddingBottom: Math.max(insets.bottom, 16) + 24 };

  if (!coachEnabled) {
    return (
      <View style={[styles.screen, styles.content, padding]}>
        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.cardTitle}>
            Coach tools
          </Text>
          <Text style={styles.body}>
            Invite athletes with a single-use code and see who has accepted. You keep every
            personal training feature. Turning this on gives you no access to anyone&apos;s data,
            and athletes can end a connection at any time.
          </Text>
          {notice ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {notice}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Turn on coach tools"
            accessibilityState={{ busy: state.enabling, disabled: state.enabling }}
            disabled={state.enabling}
            style={({ pressed }) => [
              styles.primary,
              pressed && styles.primaryPressed,
              state.enabling && styles.busy,
            ]}
            onPress={confirmEnable}
          >
            {state.enabling ? (
              <ActivityIndicator color={roman.background} />
            ) : (
              <Text style={styles.primaryText}>Turn on coach tools</Text>
            )}
          </Pressable>
        </View>
      </View>
    );
  }

  const { created, creating, error: inviteError } = state.invite;
  const list = state.athletes;
  const firstLoad = !list.loaded && list.loading;

  const header = (
    <View>
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.cardTitle}>
          Invite an athlete
        </Text>
        {created ? (
          <View>
            <Text style={styles.body}>Give this code to your athlete. It works once.</Text>
            <Text selectable accessibilityLabel={`Invite code ${created.code.split("").join(" ")}`} style={styles.code}>
              {created.code}
            </Text>
            <Text style={styles.meta}>Valid until {formatExpiry(created.expires_at)}</Text>
            <Text style={styles.meta}>
              They enter it under Profile → My coaches. The code is shown only now; if you lose it,
              create another.
            </Text>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
              onPress={() => coachingStore.clearInvite()}
            >
              <Text style={styles.secondaryText}>Hide code</Text>
            </Pressable>
          </View>
        ) : (
          <Text style={styles.body}>
            Create a code, then give it to your athlete. They see who it comes from and choose
            whether to connect. Their workouts stay private unless they choose to share them
            with you.
          </Text>
        )}
        {inviteError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {inviteError}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={created ? "Create another invite code" : "Create invite code"}
          accessibilityState={{ busy: creating, disabled: creating }}
          disabled={creating}
          style={({ pressed }) => [
            styles.primary,
            pressed && styles.primaryPressed,
            creating && styles.busy,
          ]}
          onPress={() => void createInvite()}
        >
          {creating ? (
            <ActivityIndicator color={roman.background} />
          ) : (
            <Text style={styles.primaryText}>{created ? "Create another code" : "Create invite code"}</Text>
          )}
        </Pressable>
      </View>

      <Text accessibilityRole="header" style={styles.sectionLabel}>
        Connected athletes
      </Text>
      {notice ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.notice}>
          {notice}
        </Text>
      ) : null}
      {list.error ? (
        <View style={styles.banner}>
          <Text accessibilityRole="alert" style={styles.error}>
            {list.loaded ? "Could not refresh." : "Could not load your athletes."} {list.error}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            onPress={() => void coachingStore.load("coach")}
          >
            <Text style={styles.secondaryText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={[styles.content, padding]}
      data={list.items}
      keyExtractor={(item) => item.id}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => (
        <ConnectionRow
          connection={item}
          ending={state.ending.includes(item.id)}
          onEnd={() => confirmEnd(item.id, personName(item.person))}
          onOpen={() => router.push(`/coaching/athlete/${item.id}`)}
          status={item.shares_workouts ? "Workouts shared" : "Workouts not shared"}
        />
      )}
      ListHeaderComponent={header}
      ListEmptyComponent={
        firstLoad ? (
          <ActivityIndicator color={roman.gold} accessibilityLabel="Loading athletes" />
        ) : list.error && !list.loaded ? null : (
          <Text style={styles.empty}>
            No athletes connected yet. Create an invite code to get started.
          </Text>
        )
      }
      refreshControl={
        <RefreshControl
          refreshing={list.loading && list.loaded}
          onRefresh={() => void coachingStore.load("coach")}
          tintColor={roman.gold}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: roman.background },
  content: { paddingHorizontal: 16, paddingTop: 8 },
  card: {
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    gap: 12,
  },
  cardTitle: { color: roman.text, fontFamily: romanFont.semibold, fontSize: 17 },
  body: { color: roman.textMuted, fontFamily: romanFont.regular, fontSize: 14, lineHeight: 21 },
  meta: { color: roman.textMuted, fontFamily: romanFont.regular, fontSize: 13, lineHeight: 19 },
  code: {
    color: roman.goldLight,
    fontFamily: romanFont.semibold,
    fontSize: 26,
    lineHeight: 34,
    letterSpacing: 2,
    marginVertical: 8,
  },
  sectionLabel: {
    color: roman.textMuted,
    fontFamily: romanFont.semibold,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  notice: { color: roman.goldLight, fontFamily: romanFont.medium, fontSize: 14, lineHeight: 20, marginBottom: 10 },
  error: { color: roman.danger, fontFamily: romanFont.medium, fontSize: 14, lineHeight: 20 },
  banner: {
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    gap: 8,
  },
  empty: {
    color: roman.textMuted,
    fontFamily: romanFont.regular,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    paddingVertical: 16,
  },
  primary: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: roman.gold,
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  primaryPressed: { backgroundColor: roman.goldPressed },
  primaryText: {
    color: roman.background,
    fontFamily: romanFont.semibold,
    fontSize: 14,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  secondary: {
    minHeight: MIN_TOUCH,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  secondaryText: { color: roman.goldLight, fontFamily: romanFont.semibold, fontSize: 14 },
  pressed: { backgroundColor: roman.surfaceRaised },
  busy: { opacity: 0.6 },
});
