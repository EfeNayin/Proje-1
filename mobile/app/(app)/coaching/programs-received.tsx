/**
 * Received programs: the programs your coaches have sent you. Opening one shows
 * everything in it; nothing is added to your own programs until you accept.
 *
 * Offers belong to a connection, so ending the connection removes them from
 * here. The backend decides what is visible on every request; the list only
 * shows what it returned.
 */

import { useFocusEffect, useRouter } from "expo-router";
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

import type { ReceivedOffer } from "../../../src/api/coaching";
import { useAuth } from "../../../src/auth/AuthContext";
import { offerStatusLabel, summaryText } from "../../../src/coaching/offerDisplay";
import { formatConnectedDate, personName } from "../../../src/coaching/presentation";
import { programOffersStore } from "../../../src/coaching/programOffersSession";
import { useProgramOffers } from "../../../src/coaching/useProgramOffers";
import { roman, romanFont, useRomanFonts } from "../../../src/romanTheme";

const MIN_TOUCH = 44;

export default function ReceivedProgramsScreen() {
  const { user } = useAuth();
  // Keyed by account: a different user remounts the body.
  return <ReceivedPrograms key={user?.id ?? "signed-out"} userId={user?.id ?? null} />;
}

function ReceivedPrograms({ userId }: { userId: string | null }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  useRomanFonts();
  const { received } = useProgramOffers(userId);

  // Every focus, so an offer answered on its own screen, or one that vanished
  // with a connection, is reflected on return. One request at a time.
  useFocusEffect(
    useCallback(() => {
      programOffersStore.bind(userId);
      void programOffersStore.refreshReceived();
    }, [userId]),
  );

  const firstLoad = !received.loaded && received.loading;

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
      data={received.items}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <OfferRow offer={item} onOpen={() => router.push(`/coaching/program-offer/${item.id}`)} />
      )}
      ListHeaderComponent={
        <View>
          <Text style={styles.intro}>
            A coach can send you a program, but it only becomes yours when you accept. Accepting
            adds an independent copy; it never changes your active program.
          </Text>
          {received.error ? (
            <View style={styles.banner}>
              <Text accessibilityRole="alert" style={styles.error}>
                {received.loaded ? "Could not refresh." : "Could not load programs."}{" "}
                {received.error}
              </Text>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
                onPress={() => void programOffersStore.refreshReceived()}
              >
                <Text style={styles.secondaryText}>Try again</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        firstLoad ? (
          <ActivityIndicator color={roman.gold} accessibilityLabel="Loading programs" />
        ) : received.error && !received.loaded ? null : (
          <Text style={styles.empty}>
            No programs received. When a coach you are connected to sends one, it appears here.
          </Text>
        )
      }
      ListFooterComponent={
        received.loadingMore ? (
          <ActivityIndicator color={roman.gold} accessibilityLabel="Loading more programs" />
        ) : received.moreError ? (
          <View style={styles.banner}>
            <Text accessibilityRole="alert" style={styles.error}>
              {received.moreError}
            </Text>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
              onPress={() => void programOffersStore.loadMoreReceived()}
            >
              <Text style={styles.secondaryText}>Try again</Text>
            </Pressable>
          </View>
        ) : null
      }
      onEndReachedThreshold={0.4}
      onEndReached={() => void programOffersStore.loadMoreReceived()}
      refreshControl={
        <RefreshControl
          refreshing={received.loading && received.loaded}
          onRefresh={() => void programOffersStore.refreshReceived()}
          tintColor={roman.gold}
        />
      }
    />
  );
}

function OfferRow({ offer, onOpen }: { offer: ReceivedOffer; onOpen: () => void }) {
  const from = personName(offer.coach);
  const status = offerStatusLabel(offer.status);
  const summary = summaryText(offer.template_count, offer.exercise_count);
  const sent = formatConnectedDate(offer.sent_at);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${offer.program_name}, from ${from}, ${status}, ${summary}`}
      accessibilityHint="Opens the program"
      style={({ pressed }) => [
        styles.row,
        offer.status === "pending" && styles.rowWaiting,
        pressed && styles.pressed,
      ]}
      onPress={onOpen}
    >
      <View style={styles.rowText}>
        {/* The word, not the border colour alone, says an offer is waiting. */}
        <Text style={[styles.status, offer.status === "pending" && styles.statusWaiting]}>
          {status}
        </Text>
        <Text style={styles.rowTitle}>{offer.program_name}</Text>
        <Text style={styles.meta}>From {from}</Text>
        <Text style={styles.meta}>{sent ? `${summary} · sent ${sent}` : summary}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: roman.background },
  content: { paddingHorizontal: 16, paddingTop: 8 },
  intro: {
    color: roman.textMuted,
    fontFamily: romanFont.regular,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 16,
  },
  row: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingLeft: 16,
    paddingRight: 4,
    marginBottom: 12,
    gap: 8,
  },
  rowWaiting: { borderColor: roman.gold },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: roman.text, fontFamily: romanFont.semibold, fontSize: 16, lineHeight: 22 },
  status: {
    color: roman.textMuted,
    fontFamily: romanFont.semibold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  statusWaiting: { color: roman.gold },
  meta: { color: roman.textMuted, fontFamily: romanFont.regular, fontSize: 13, lineHeight: 19 },
  chevron: { color: roman.textMuted, fontSize: 28, width: MIN_TOUCH, textAlign: "center" },
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
