/**
 * One connected athlete, as the coach sees them: who they are, whether they
 * share their workouts, and (only if they do) their completed workouts, newest
 * first. Read-only: nothing here can change the athlete's records, and a
 * workout opens a read-only detail rather than the athlete's own workout screen.
 *
 * Whether anything is shown is decided by the backend on every request. The
 * switch state from the coach's connection list is used only to avoid asking
 * when the answer is already known to be no.
 */

import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { AthleteWorkoutSummary } from "../../../../../src/api/coaching";
import { athleteWorkoutsStore } from "../../../../../src/coaching/athleteWorkoutsSession";
import {
  durationText,
  formatSessionDate,
  setCountText,
} from "../../../../../src/coaching/athleteWorkoutDisplay";
import { coachingStore } from "../../../../../src/coaching/coachingSession";
import { refreshAthleteView } from "../../../../../src/coaching/openAthlete";
import { personHandle, personName } from "../../../../../src/coaching/presentation";
import { useAthleteWorkouts } from "../../../../../src/coaching/useAthleteWorkouts";
import { useCoaching } from "../../../../../src/coaching/useCoaching";
import { useAuth } from "../../../../../src/auth/AuthContext";
import { roman, romanFont, useRomanFonts } from "../../../../../src/romanTheme";

const MIN_TOUCH = 44;

export default function AthleteWorkoutsScreen() {
  const { linkId } = useLocalSearchParams<{ linkId: string }>();
  const { user } = useAuth();
  // Keyed by account and athlete: a different one remounts the body.
  return (
    <AthleteWorkouts
      key={`${user?.id ?? "signed-out"}:${linkId}`}
      userId={user?.id ?? null}
      linkId={linkId}
    />
  );
}

function AthleteWorkouts({ userId, linkId }: { userId: string | null; linkId: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  useRomanFonts();
  const coaching = useCoaching(userId);
  const view = useAthleteWorkouts(userId, linkId);
  const link = coaching.athletes.items.find((item) => item.id === linkId);
  const { list, denied } = view;

  const refresh = useCallback(async () => {
    if (userId) await refreshAthleteView(coachingStore, athleteWorkoutsStore, { userId, linkId });
  }, [userId, linkId]);

  // Same approach as the Training home: refresh on every focus, so a switch the
  // athlete flipped while this was in the background is picked up on return.
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const name = link ? personName(link.person) : "This athlete";
  const handle = link ? personHandle(link.person) : null;
  const connectionLoading = !link && coaching.athletes.loading && !coaching.athletes.loaded;
  const ended = denied === "ended" || (!link && coaching.athletes.loaded && !coaching.athletes.error);
  const notShared = !ended && (denied === "not_shared" || link?.shares_workouts === false);
  const firstLoad = !list.loaded && (list.loading || connectionLoading);

  const header = (
    <View>
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.cardTitle}>
          {name}
        </Text>
        {handle ? <Text style={styles.meta}>{handle}</Text> : null}
        <Text style={styles.status}>
          {ended
            ? "Connection ended"
            : notShared
              ? "Workouts not shared"
              : link?.shares_workouts
                ? "Workouts shared"
                : " "}
        </Text>
      </View>
      {list.error ? (
        <View style={styles.banner}>
          <Text accessibilityRole="alert" style={styles.error}>
            {list.loaded ? "Could not refresh." : "Could not load workouts."} {list.error}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            onPress={() => void refresh()}
          >
            <Text style={styles.secondaryText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  const message = ended
    ? "This connection has ended, so there is nothing to show."
    : notShared
      ? `${name} is not sharing workouts with you. They can turn this on in Profile → My Coaches.`
      : null;

  if (message) {
    return (
      <View style={[styles.screen, styles.content, { paddingBottom: insets.bottom + 24 }]}>
        {header}
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.empty}>
          {message}
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      data={list.items}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={header}
      renderItem={({ item }) => (
        <SessionRow
          session={item}
          onOpen={() => router.push(`/coaching/athlete/${linkId}/workout/${item.id}`)}
        />
      )}
      onEndReachedThreshold={0.4}
      onEndReached={() => void athleteWorkoutsStore.loadMore()}
      ListEmptyComponent={
        firstLoad ? (
          <ActivityIndicator color={roman.gold} accessibilityLabel="Loading workouts" />
        ) : list.error && !list.loaded ? null : (
          <Text style={styles.empty}>
            No completed workouts recorded yet. They appear here once {name} finishes one in the
            app.
          </Text>
        )
      }
      ListFooterComponent={
        list.loadingMore ? (
          <ActivityIndicator color={roman.gold} accessibilityLabel="Loading more workouts" />
        ) : list.moreError ? (
          <View style={styles.banner}>
            <Text accessibilityRole="alert" style={styles.error}>
              {list.moreError}
            </Text>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
              onPress={() => void athleteWorkoutsStore.loadMore()}
            >
              <Text style={styles.secondaryText}>Try again</Text>
            </Pressable>
          </View>
        ) : null
      }
      refreshControl={
        <RefreshControl
          refreshing={list.loading && list.loaded}
          onRefresh={() => void refresh()}
          tintColor={roman.gold}
        />
      }
    />
  );
}

function SessionRow({
  session,
  onOpen,
}: {
  session: AthleteWorkoutSummary;
  onOpen: () => void;
}) {
  const title = session.title ?? "Workout";
  const date = formatSessionDate(session.performed_at);
  const duration = durationText(session);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${date}, ${duration}, ${setCountText(session.total_sets)}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      onPress={onOpen}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.meta}>{date}</Text>
        <Text style={styles.meta}>{duration}</Text>
      </View>
      <Text style={styles.rowSets}>{setCountText(session.total_sets)}</Text>
    </Pressable>
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
    marginBottom: 16,
    gap: 4,
  },
  cardTitle: { color: roman.text, fontFamily: romanFont.semibold, fontSize: 18, lineHeight: 24 },
  meta: { color: roman.textMuted, fontFamily: romanFont.regular, fontSize: 13, lineHeight: 19 },
  status: { color: roman.goldLight, fontFamily: romanFont.medium, fontSize: 13, lineHeight: 19 },
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: MIN_TOUCH,
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderLeftColor: roman.gold,
    borderLeftWidth: 3,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  rowText: { flex: 1 },
  rowTitle: { color: roman.text, fontFamily: romanFont.semibold, fontSize: 16, lineHeight: 22 },
  rowSets: { color: roman.goldLight, fontFamily: romanFont.semibold, fontSize: 14 },
  secondary: {
    minHeight: MIN_TOUCH,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  secondaryText: { color: roman.goldLight, fontFamily: romanFont.semibold, fontSize: 14 },
  pressed: { backgroundColor: roman.surfaceRaised },
});
