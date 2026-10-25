/**
 * Send a program: the coach picks one of their own programs, reads exactly what
 * would be sent, and confirms. The athlete then receives a frozen copy as an
 * offer; nothing is added to their programs until they accept, and later edits
 * to the original change nothing they were sent.
 *
 * The content shown is built by the backend (not by this screen), and the
 * confirmation carries its fingerprint. If the program changed since it was shown
 * (for example edited on another device), the backend refuses the send; this
 * screen then loads the new version and waits for another explicit confirmation.
 * The backend also checks ownership and the connection again when the send arrives.
 */

import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getProgramPreview } from "../../../../../src/api/coaching";
import type { ProgramPreview } from "../../../../../src/api/coaching";
import { listPrograms } from "../../../../../src/api/programs";
import type { ProgramSummary } from "../../../../../src/api/programs";
import { useAuth } from "../../../../../src/auth/AuthContext";
import { OfferProgramView } from "../../../../../src/coaching/OfferProgramView";
import {
  exerciseCount,
  offerStatusLabel,
  summaryText,
} from "../../../../../src/coaching/offerDisplay";
import { coachingStore } from "../../../../../src/coaching/coachingSession";
import { formatConnectedDate, personName } from "../../../../../src/coaching/presentation";
import { programOffersStore } from "../../../../../src/coaching/programOffersSession";
import { useCoaching } from "../../../../../src/coaching/useCoaching";
import { useProgramOffers } from "../../../../../src/coaching/useProgramOffers";
import { roman, romanFont, useRomanFonts } from "../../../../../src/romanTheme";

const MIN_TOUCH = 44;

type Chosen = {
  id: string;
  loading: boolean;
  error: string | null;
  preview: ProgramPreview | null;
};

export default function SendProgramScreen() {
  const { linkId } = useLocalSearchParams<{ linkId: string }>();
  const { user } = useAuth();
  // Keyed by account and athlete: a different one remounts the body, so a chosen
  // program or a result from another athlete cannot carry over.
  return (
    <SendProgram
      key={`${user?.id ?? "signed-out"}:${linkId}`}
      userId={user?.id ?? null}
      linkId={linkId}
    />
  );
}

function SendProgram({ userId, linkId }: { userId: string | null; linkId: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  useRomanFonts();
  const coaching = useCoaching(userId);
  const offers = useProgramOffers(userId);
  const link = coaching.athletes.items.find((item) => item.id === linkId);
  const name = link ? personName(link.person) : "this athlete";
  const ended =
    offers.sent.unavailable || (!link && coaching.athletes.loaded && !coaching.athletes.error);

  const [programs, setPrograms] = useState<ProgramSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const latestList = useRef(0);
  const latestChoice = useRef(0);

  const loadPrograms = useCallback(async (isCancelled: () => boolean = () => false) => {
    const mine = ++latestList.current;
    try {
      const list = await listPrograms();
      if (isCancelled() || mine !== latestList.current) return;
      setPrograms(list);
      setLoadError(null);
    } catch (error) {
      if (isCancelled() || mine !== latestList.current) return;
      setLoadError(error instanceof Error ? error.message : "Could not load your programs");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      coachingStore.bind(userId);
      programOffersStore.bind(userId);
      programOffersStore.bindSent(linkId);
      void coachingStore.load("coach");
      void programOffersStore.refreshSent();
      void loadPrograms(() => cancelled);
      return () => {
        cancelled = true;
        // Anything still loading for the screen being left is ignored.
        latestList.current += 1;
        latestChoice.current += 1;
      };
    }, [userId, linkId, loadPrograms]),
  );

  /** Load what would be sent. A reload replaces the shown version and needs a new confirmation. */
  const choose = async (id: string, message: string | null = null) => {
    setNotice(message);
    const mine = ++latestChoice.current;
    setChosen({ id, loading: true, error: null, preview: null });
    try {
      const preview = await getProgramPreview(linkId, id);
      if (mine !== latestChoice.current) return;
      setChosen({ id, loading: false, error: null, preview });
    } catch (error) {
      if (mine !== latestChoice.current) return;
      if ((error as { status?: unknown } | null)?.status === 404) {
        // Deleted since it was listed, or the connection ended.
        setChosen(null);
        setNotice("This program no longer exists, or the connection has ended.");
        void loadPrograms();
        void programOffersStore.refreshSent();
        return;
      }
      setChosen({
        id,
        loading: false,
        error: error instanceof Error ? error.message : "Could not load this program",
        preview: null,
      });
    }
  };

  const send = async () => {
    if (!chosen?.preview) return;
    setNotice(null);
    const outcome = await programOffersStore.send(linkId, chosen.id, chosen.preview.fingerprint);
    if (outcome.kind === "ignored" || outcome.kind === "stale") return;
    if (outcome.kind === "changed") {
      // Nothing was sent. Show the current version; sending it is a new decision.
      void choose(chosen.id, `${outcome.message} The updated version is shown below.`);
      return;
    }
    if (outcome.kind === "done") {
      setChosen(null);
      setNotice(`Sent to ${name}. They choose whether to add it; nothing changes for them until then.`);
      return;
    }
    setNotice(outcome.message);
    if (outcome.kind === "unavailable") void programOffersStore.refreshSent();
  };

  const padding = { paddingBottom: Math.max(insets.bottom, 16) + 24 };

  if (ended) {
    return (
      <View style={[styles.screen, styles.content, padding]}>
        <Text accessibilityRole="alert" style={styles.empty}>
          This connection has ended, so programs can no longer be sent.
        </Text>
      </View>
    );
  }

  const preview = chosen?.preview?.program ?? null;
  const sending = offers.sending;

  const header = (
    <View style={styles.headerGap}>
      <Text style={styles.intro}>
        Choose one of your programs to send to {name}. They see a copy as it is now and decide
        whether to add it as their own; you cannot edit or open their copy.
      </Text>
      {notice ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.notice}>
          {notice}
        </Text>
      ) : null}
      {chosen ? (
        <View style={styles.headerGap}>
          {chosen.loading ? (
            <ActivityIndicator color={roman.gold} accessibilityLabel="Loading program" />
          ) : chosen.error ? (
            <View style={styles.banner}>
              <Text accessibilityRole="alert" style={styles.error}>
                {chosen.error}
              </Text>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
                onPress={() => void choose(chosen.id)}
              >
                <Text style={styles.secondaryText}>Try again</Text>
              </Pressable>
            </View>
          ) : preview ? (
            <>
              <View style={styles.card}>
                <Text style={styles.label}>Sending to</Text>
                <Text accessibilityRole="header" style={styles.cardTitle}>
                  {name}
                </Text>
              </View>
              <OfferProgramView program={preview} />
              <View style={styles.card}>
                {exerciseCount(preview) === 0 ? (
                  <Text style={styles.error}>
                    This program has no exercises yet, so there is nothing to send.
                  </Text>
                ) : (
                  <Text style={styles.body}>
                    Sending shares the program above, including any notes on it. {name} will see
                    it and can add it or decline. Changing or deleting your original afterwards
                    does not change what they received.
                  </Text>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Send ${preview.name} to ${name}`}
                  accessibilityState={{
                    busy: sending,
                    disabled: sending || exerciseCount(preview) === 0,
                  }}
                  disabled={sending || exerciseCount(preview) === 0}
                  style={({ pressed }) => [
                    styles.primary,
                    pressed && styles.primaryPressed,
                    (sending || exerciseCount(preview) === 0) && styles.busy,
                  ]}
                  onPress={() => void send()}
                >
                  {sending ? (
                    <ActivityIndicator color={roman.background} />
                  ) : (
                    <Text style={styles.primaryText}>Send to {name}</Text>
                  )}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: sending }}
                  disabled={sending}
                  style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
                  onPress={() => {
                    latestChoice.current += 1;
                    setChosen(null);
                  }}
                >
                  <Text style={styles.secondaryText}>Choose another program</Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
      ) : (
        <Text accessibilityRole="header" style={styles.sectionLabel}>
          Your programs
        </Text>
      )}
      {loadError && !chosen ? (
        <View style={styles.banner}>
          <Text accessibilityRole="alert" style={styles.error}>
            {programs === null ? "Could not load your programs." : "Could not refresh."} {loadError}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            onPress={() => void loadPrograms()}
          >
            <Text style={styles.secondaryText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  const sent = offers.sent;
  const footer = (
    <View style={styles.footer}>
      <Text accessibilityRole="header" style={styles.sectionLabel}>
        Sent to {name}
      </Text>
      {sent.error ? (
        <View style={styles.banner}>
          <Text accessibilityRole="alert" style={styles.error}>
            {sent.error}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            onPress={() => void programOffersStore.refreshSent()}
          >
            <Text style={styles.secondaryText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
      {sent.items.length === 0 ? (
        !sent.loaded && sent.loading ? (
          <ActivityIndicator color={roman.gold} accessibilityLabel="Loading sent programs" />
        ) : sent.error && !sent.loaded ? null : (
          <Text style={styles.meta}>Nothing sent yet.</Text>
        )
      ) : (
        sent.items.map((offer) => (
          <View
            key={offer.id}
            style={styles.sentRow}
            accessible
            accessibilityLabel={`${offer.program_name}, ${offerStatusLabel(offer.status)}`}
          >
            <Text style={styles.sentTitle}>{offer.program_name}</Text>
            <Text style={styles.meta}>
              {offerStatusLabel(offer.status)} · {summaryText(offer.template_count, offer.exercise_count)}
              {formatConnectedDate(offer.sent_at) ? ` · ${formatConnectedDate(offer.sent_at)}` : ""}
            </Text>
          </View>
        ))
      )}
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
        onPress={() => router.back()}
      >
        <Text style={styles.secondaryText}>Back to {name}</Text>
      </Pressable>
    </View>
  );

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={[styles.content, padding]}
      // While a program is chosen the list gives way to its preview.
      data={chosen ? [] : (programs ?? [])}
      keyExtractor={(item) => item.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      ListEmptyComponent={
        chosen ? null : programs === null ? (
          loadError ? null : (
            <ActivityIndicator color={roman.gold} accessibilityLabel="Loading your programs" />
          )
        ) : (
          <Text style={styles.empty}>
            You have no programs yet. Create one under Programs, add exercises, then come back.
          </Text>
        )
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={item.is_active ? `${item.name}, your active program` : item.name}
          accessibilityHint="Shows what would be sent"
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          onPress={() => void choose(item.id)}
        >
          <Text style={styles.rowTitle}>{item.name}</Text>
          {item.is_active ? <Text style={styles.meta}>Your active program</Text> : null}
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: roman.background },
  content: { paddingHorizontal: 16, paddingTop: 8 },
  headerGap: { gap: 12, marginBottom: 12 },
  footer: { gap: 12, marginTop: 24 },
  intro: { color: roman.textMuted, fontFamily: romanFont.regular, fontSize: 14, lineHeight: 21 },
  card: {
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  cardTitle: { color: roman.text, fontFamily: romanFont.semibold, fontSize: 17, lineHeight: 24 },
  label: {
    color: roman.textMuted,
    fontFamily: romanFont.medium,
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  sectionLabel: {
    color: roman.textMuted,
    fontFamily: romanFont.semibold,
    fontSize: 12,
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
  row: {
    minHeight: 56,
    justifyContent: "center",
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 2,
  },
  rowTitle: { color: roman.text, fontFamily: romanFont.semibold, fontSize: 16, lineHeight: 22 },
  sentRow: {
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 2,
  },
  sentTitle: { color: roman.text, fontFamily: romanFont.medium, fontSize: 15, lineHeight: 21 },
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
