/**
 * One received program: who sent it, everything in it, and the athlete's choice
 * to add it or decline.
 *
 * Accepting creates an independent copy among the athlete's own programs. It is
 * created inactive, so the current program stays active until the athlete
 * switches on the copy themselves, and nothing keeps it in step with the coach's
 * original afterwards. The coach never gets access to the copy.
 */

import { Ionicons } from "@expo/vector-icons";
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
import { FocusedDarkStatusBar } from "../../../../src/FocusedDarkStatusBar";
import { light } from "../../../../src/lightTheme";
import { OfferProgramView } from "../../../../src/coaching/OfferProgramView";
import { offerStatusLabel } from "../../../../src/coaching/offerDisplay";
import { formatConnectedDate, personHandle, personName } from "../../../../src/coaching/presentation";
import { programOffersStore } from "../../../../src/coaching/programOffersSession";
import { useProgramOffers } from "../../../../src/coaching/useProgramOffers";

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

const STATUS_ICON = {
  pending: "time-outline",
  accepted: "checkmark-circle-outline",
  declined: "close-circle-outline",
} as const;

function ProgramOffer({ userId, offerId }: { userId: string | null; offerId: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const view = useProgramOffers(userId);
  const [notice, setNotice] = useState<string | null>(null);
  // Display only: a refusal reads as an error, a success as a plain confirmation.
  const [noticeFailed, setNoticeFailed] = useState(false);
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
    setNoticeFailed(false);
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
    setNoticeFailed(true);
  };

  const confirmDecline = () =>
    Alert.alert("Decline this program?", "Nothing is added to your programs. Your coach can send it again.", [
      { text: "Cancel", style: "cancel" },
      { text: "Decline", style: "destructive", onPress: () => void run("decline") },
    ]);

  if (shown?.unavailable) {
    return (
      <View style={[styles.screen, styles.content, padding]}>
        <FocusedDarkStatusBar />
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
        <FocusedDarkStatusBar />
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
          <ActivityIndicator color={light.textSecondary} accessibilityLabel="Loading program" />
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
      <FocusedDarkStatusBar />
      <View style={styles.card}>
        {/* The word and its icon say where the offer stands, never the colour alone. */}
        <View style={styles.statusRow}>
          <Ionicons name={STATUS_ICON[offer.status]} size={16} color={light.text} />
          <Text style={styles.status}>{offerStatusLabel(offer.status)}</Text>
        </View>
        <Text accessibilityRole="header" style={styles.cardTitle}>
          From {from}
        </Text>
        {handle ? <Text style={styles.meta}>{handle}</Text> : null}
        {formatConnectedDate(offer.sent_at) ? (
          <Text style={styles.meta}>Sent {formatConnectedDate(offer.sent_at)}</Text>
        ) : null}
        {offer.responded_at && formatConnectedDate(offer.responded_at) ? (
          <Text style={styles.meta}>
            {offer.status === "accepted" ? "Added" : "Declined"}{" "}
            {formatConnectedDate(offer.responded_at)}
          </Text>
        ) : null}
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
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={noticeFailed ? styles.error : styles.notice}
        >
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
              <ActivityIndicator color={light.onPrimary} />
            ) : (
              <Text style={styles.primaryText}>Add to my programs</Text>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Decline this program"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            style={({ pressed }) => [styles.decline, pressed && styles.pressed, busy && styles.busy]}
            onPress={confirmDecline}
          >
            <Text style={styles.declineText}>Decline</Text>
          </Pressable>
        </View>
      ) : offer.status === "accepted" ? (
        <View style={styles.card}>
          {offer.program_id ? (
            <>
              <Text style={styles.body}>
                This program is in your programs as your own copy. It was added inactive, so your
                active program was not changed. Open it to activate it or change it.
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
  screen: { flex: 1, backgroundColor: light.background },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  card: {
    backgroundColor: light.surface,
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  cardTitle: { color: light.text, fontSize: 18, fontWeight: "600", lineHeight: 24 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  status: { color: light.text, fontSize: 14, fontWeight: "600" },
  body: { color: light.textSecondary, fontSize: 14, lineHeight: 21 },
  meta: { color: light.textSecondary, fontSize: 13, lineHeight: 19 },
  notice: { color: light.text, fontSize: 14, fontWeight: "500", lineHeight: 20 },
  error: { color: light.danger, fontSize: 14, lineHeight: 20 },
  banner: {
    backgroundColor: light.surface,
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  empty: {
    color: light.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    paddingVertical: 16,
  },
  primary: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: light.primary,
    borderRadius: 14,
    paddingHorizontal: 16,
  },
  primaryPressed: { backgroundColor: light.primaryPressed },
  primaryText: { color: light.onPrimary, fontSize: 16, fontWeight: "600" },
  // Decline is a full-width, clearly separate control, not a link beside Add.
  decline: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: light.background,
    borderRadius: 14,
    paddingHorizontal: 16,
  },
  declineText: { color: light.text, fontSize: 16, fontWeight: "600" },
  secondary: {
    minHeight: MIN_TOUCH,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  secondaryText: { color: light.text, fontSize: 15, fontWeight: "600", textDecorationLine: "underline" },
  pressed: { backgroundColor: light.pressed },
  busy: { opacity: 0.6 },
});
