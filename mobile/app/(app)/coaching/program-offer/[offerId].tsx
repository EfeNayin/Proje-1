/**
 * One received program: who sent it, everything in it, and the athlete's choice
 * to add it or decline.
 *
 * Accepting creates an independent copy among the athlete's own programs. It is
 * created inactive, so the current program stays active until the athlete
 * switches on the copy themselves, and nothing keeps it in step with the coach's
 * original afterwards. The coach never gets access to the copy.
 */

import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../../../../src/auth/AuthContext";
import { OfferProgramView } from "../../../../src/coaching/OfferProgramView";
import { offerStatusLabel } from "../../../../src/coaching/offerDisplay";
import { personHandle, personName } from "../../../../src/coaching/presentation";
import { programOffersStore } from "../../../../src/coaching/programOffersSession";
import { useProgramOffers } from "../../../../src/coaching/useProgramOffers";
import { roman, romanFont, useRomanFonts } from "../../../../src/romanTheme";

const MIN_TOUCH = 44;

export default function ProgramOfferScreen() {
  const { offerId } = useLocalSearchParams<{ offerId: string }>();
  const { user } = useAuth();
  // Keyed by account and offer: a different one remounts the body.
  return (
    <ProgramOffer
      key={`${user?.id ?? "signed-out"}:${offerId}`}
      userId={user?.id ?? null}
      offerId={offerId}
    />
  );
}

function ProgramOffer({ userId, offerId }: { userId: string | null; offerId: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  useRomanFonts();
  const view = useProgramOffers(userId);
  const [notice, setNotice] = useState<string | null>(null);
  const shown = view.detail.offerId === offerId ? view.detail : null;
  const offer = shown?.data ?? null;
  const busy = view.responding === offerId;

  useFocusEffect(
    useCallback(() => {
      programOffersStore.bind(userId);
      void programOffersStore.loadDetail(offerId);
      return () => programOffersStore.closeDetail();
    }, [userId, offerId]),
  );

  const padding = { paddingBottom: Math.max(insets.bottom, 16) + 24 };

  const run = async (action: "accept" | "decline") => {
    setNotice(null);
    const outcome =
      action === "accept"
        ? await programOffersStore.accept(offerId)
        : await programOffersStore.decline(offerId);
    if (outcome.kind === "ignored" || outcome.kind === "stale") return;
    if (outcome.kind === "done") {
      setNotice(
        action === "accept"
          ? "Added to your programs. It is not active yet."
          : "Declined. Nothing was added.",
      );
      return;
    }
    setNotice(outcome.message);
  };

  const confirmDecline = () =>
    Alert.alert("Decline this program?", "Nothing is added to your programs. Your coach can send it again.", [
      { text: "Cancel", style: "cancel" },
      { text: "Decline", style: "destructive", onPress: () => void run("decline") },
    ]);

  if (shown?.unavailable) {
    return (
      <View style={[styles.screen, styles.content, padding]}>
        <Text accessibilityRole="alert" style={styles.empty}>
          This program is no longer available. The connection with your coach may have ended.
        </Text>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          onPress={() => router.back()}
        >
          <Text style={styles.secondaryText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  if (!offer) {
    return (
      <View style={[styles.screen, styles.content, padding]}>
        {shown?.error ? (
          <View style={styles.banner}>
            <Text accessibilityRole="alert" style={styles.error}>
              {shown.error}
            </Text>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
              onPress={() => void programOffersStore.loadDetail(offerId)}
            >
              <Text style={styles.secondaryText}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <ActivityIndicator color={roman.gold} accessibilityLabel="Loading program" />
        )}
      </View>
    );
  }

  const from = personName(offer.coach);
  const handle = personHandle(offer.coach);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, padding]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.card}>
        <Text style={styles.status}>{offerStatusLabel(offer.status)}</Text>
        <Text accessibilityRole="header" style={styles.cardTitle}>
          From {from}
        </Text>
        {handle ? <Text style={styles.meta}>{handle}</Text> : null}
      </View>

      {shown?.error ? (
        <View style={styles.banner}>
          <Text accessibilityRole="alert" style={styles.error}>
            Could not refresh. {shown.error}
          </Text>
        </View>
      ) : null}

      <OfferProgramView program={offer.program} />

      {notice ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.notice}>
          {notice}
        </Text>
      ) : null}

      {offer.status === "pending" ? (
        <View style={styles.card}>
          <Text style={styles.body}>
            Adding this program puts an independent copy among your own programs. It is not
            switched on, so your current program stays active until you choose otherwise. It
            will not update if {from} changes theirs, and {from} cannot open or edit your copy.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Add ${offer.program_name} to my programs`}
            accessibilityState={{ busy, disabled: busy }}
            disabled={busy}
            style={({ pressed }) => [
              styles.primary,
              pressed && styles.primaryPressed,
              busy && styles.busy,
            ]}
            onPress={() => void run("accept")}
          >
            {busy ? (
              <ActivityIndicator color={roman.background} />
            ) : (
              <Text style={styles.primaryText}>Add to my programs</Text>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Decline this program"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed, busy && styles.busy]}
            onPress={confirmDecline}
          >
            <Text style={styles.secondaryText}>Decline</Text>
          </Pressable>
        </View>
      ) : offer.status === "accepted" ? (
        <View style={styles.card}>
          {offer.program_id ? (
            <>
              <Text style={styles.body}>
                This program is in your programs as your own copy. Open it to activate it or
                change it.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open my copy of this program"
                style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
                onPress={() => router.push(`/program/${offer.program_id}`)}
              >
                <Text style={styles.primaryText}>Open my copy</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.body}>
              You added this program and later deleted your copy. It will not be added again.
            </Text>
          )}
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.body}>You declined this program. Nothing was added.</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: roman.background },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  card: {
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  cardTitle: { color: roman.text, fontFamily: romanFont.semibold, fontSize: 17, lineHeight: 24 },
  status: {
    color: roman.gold,
    fontFamily: romanFont.semibold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  body: { color: roman.textMuted, fontFamily: romanFont.regular, fontSize: 14, lineHeight: 21 },
  meta: { color: roman.textMuted, fontFamily: romanFont.regular, fontSize: 13, lineHeight: 19 },
  notice: { color: roman.goldLight, fontFamily: romanFont.medium, fontSize: 14, lineHeight: 20 },
  error: { color: roman.danger, fontFamily: romanFont.medium, fontSize: 14, lineHeight: 20 },
  banner: {
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
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
