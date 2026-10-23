/**
 * Research: real publication records from PubMed, fetched by our backend.
 *
 * What is shown is what PubMed holds for each record — title, journal, year,
 * publication type and the abstract the authors wrote. Nothing here is
 * generated, summarised, scored or translated, and it is not advice: the
 * papers themselves were not reviewed and nothing is tailored to the reader.
 * When PubMed cannot be reached the screen says so; it never fills the gap.
 *
 * The title and back arrow come from the native header (see app/(app)/_layout),
 * so this screen draws no title of its own.
 */

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as researchApi from "../../src/api/research";
import type { Publication } from "../../src/api/research";
import { createPublicationFeed } from "../../src/research/publicationFeed";
import { pubmedLink } from "../../src/research/sourceLink";
import { roman, romanFont, useRomanFonts } from "../../src/romanTheme";

const MIN_TOUCH = 44;

async function openSource(url: string): Promise<void> {
  try {
    await WebBrowser.openBrowserAsync(url);
  } catch {
    Linking.openURL(url).catch(() => undefined);
  }
}

function PublicationCard({ publication }: { publication: Publication }) {
  const [open, setOpen] = useState(false);
  const link = pubmedLink(publication);

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{publication.title}</Text>

      {publication.year != null || publication.journal ? (
        <View style={styles.sourceRow}>
          {publication.year != null ? <Text style={styles.year}>{publication.year}</Text> : null}
          {publication.journal ? <Text style={styles.journal}>{publication.journal}</Text> : null}
        </View>
      ) : null}

      {publication.publication_types.length > 0 ? (
        <View style={styles.tags}>
          {publication.publication_types.map((type) => (
            <View key={type} style={styles.tag}>
              <Text style={styles.tagText}>{type}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {publication.abstract ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={open ? "Hide abstract" : "Show abstract"}
            accessibilityState={{ expanded: open }}
            style={({ pressed }) => [styles.abstractToggle, pressed && styles.pressed]}
            onPress={() => setOpen((value) => !value)}
          >
            <Text style={styles.abstractToggleText}>{open ? "Hide abstract" : "Show abstract"}</Text>
            <Ionicons
              name={open ? "chevron-up" : "chevron-down"}
              size={16}
              color={roman.gold}
              accessible={false}
            />
          </Pressable>
          {open ? (
            <View style={styles.abstract}>
              {publication.abstract.map((section, index) => (
                <Text key={index} style={styles.abstractText} selectable>
                  {section.label ? <Text style={styles.abstractLabel}>{section.label}: </Text> : null}
                  {section.text}
                </Text>
              ))}
              <Text style={styles.originalNote}>Original English text from PubMed.</Text>
            </View>
          ) : null}
        </>
      ) : (
        // PubMed simply has no abstract for some records; that is not an error.
        <Text style={styles.abstractUnavailable}>PubMed has no abstract for this record.</Text>
      )}

      <View style={styles.cardFooter}>
        <Text style={styles.pmid}>PMID {publication.pmid}</Text>
        {link ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="View on PubMed"
            accessibilityHint={`Opens PMID ${publication.pmid} in your browser`}
            style={({ pressed }) => [styles.sourceLink, pressed && styles.pressed]}
            onPress={() => void openSource(link)}
          >
            <Text style={styles.sourceLinkText}>View on PubMed</Text>
            <Ionicons name="open-outline" size={15} color={roman.gold} accessible={false} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export default function ResearchScreen() {
  const insets = useSafeAreaInsets();
  // Registers the bundled fonts; the styles below name them directly and fall
  // back to the system font until (or unless) they load.
  useRomanFonts();
  const [feed] = useState(() => createPublicationFeed(researchApi.fetchPublications));
  const { items, loaded, loading, loadingMore, hasMore, error } = useSyncExternalStore(
    feed.subscribe,
    feed.getSnapshot,
  );

  // Load the first page on arrival. Leaving the screen invalidates anything
  // still in flight, so a late answer can never land on a screen the user has
  // left; coming back keeps the list already loaded.
  useFocusEffect(
    useCallback(() => {
      void feed.ensureLoaded();
      return () => feed.cancel();
    }, [feed]),
  );

  const header = (
    <View>
      <Text style={styles.intro}>
        Publication records from PubMed on resistance training and muscle hypertrophy, newest
        first. These are the authors&apos; abstracts, shown in their original English — the full
        papers were not reviewed, and nothing here is tailored to you.
      </Text>
      {error?.kind === "refresh" && items.length > 0 ? (
        <View style={styles.banner}>
          <Text accessibilityRole="alert" style={styles.bannerText}>
            Could not refresh. {error.message} Showing what was loaded before.
          </Text>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.bannerButton, pressed && styles.pressed]}
            onPress={() => void feed.refresh()}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  const footer = (
    <View style={styles.footer}>
      {error?.kind === "more" ? (
        <>
          <Text accessibilityRole="alert" style={styles.errorText}>
            Could not load more publications. {error.message}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
            onPress={() => void feed.loadMore(true)}
          >
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </>
      ) : loadingMore ? (
        <ActivityIndicator color={roman.gold} accessibilityLabel="Loading more publications" />
      ) : hasMore && !loading ? (
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          onPress={() => void feed.loadMore()}
        >
          <Text style={styles.buttonText}>Load more</Text>
        </Pressable>
      ) : items.length > 0 && !loading && !error ? (
        <Text style={styles.endText}>No more publications</Text>
      ) : null}
    </View>
  );

  // First load, or it failed: no list to show yet.
  if (items.length === 0 && (loading || !loaded)) {
    return error ? (
      <View style={styles.centered}>
        <Text accessibilityRole="alert" style={styles.errorTitle}>
          Could not load publications.
        </Text>
        <Text style={styles.mutedCenter}>{error.message}</Text>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          onPress={() => void feed.refresh()}
        >
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    ) : (
      <View style={styles.centered}>
        <ActivityIndicator color={roman.gold} accessibilityLabel="Loading publications" />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
      data={items}
      keyExtractor={(item) => item.pmid}
      renderItem={({ item }) => <PublicationCard publication={item} />}
      ListHeaderComponent={header}
      ListEmptyComponent={
        <Text style={styles.mutedCenter}>PubMed returned no matching publications.</Text>
      }
      ListFooterComponent={footer}
      onEndReached={() => void feed.loadMore()}
      onEndReachedThreshold={0.4}
      refreshControl={
        <RefreshControl
          refreshing={loading}
          onRefresh={() => void feed.refresh()}
          tintColor={roman.gold}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: roman.background },
  content: { paddingHorizontal: 16, paddingTop: 8 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
    backgroundColor: roman.background,
  },
  pressed: { backgroundColor: roman.surfaceRaised },

  intro: {
    color: roman.textMuted,
    fontFamily: romanFont.regular,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 16,
  },
  banner: {
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    gap: 4,
  },
  bannerText: { color: roman.danger, fontFamily: romanFont.regular, fontSize: 13, lineHeight: 19 },
  bannerButton: {
    minHeight: MIN_TOUCH,
    alignSelf: "flex-start",
    justifyContent: "center",
    borderRadius: 8,
  },
  retryText: { color: roman.goldLight, fontFamily: romanFont.semibold, fontSize: 14 },

  card: {
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    // Gold edge marks each record, as on Training's session cards.
    borderLeftColor: roman.gold,
    borderLeftWidth: 3,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: {
    color: roman.text,
    fontFamily: romanFont.semibold,
    fontSize: 16,
    lineHeight: 24,
  },
  // Year and journal sit under a hairline so they read as the source, not as
  // part of the title.
  sourceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: 10,
    rowGap: 2,
    marginTop: 12,
    paddingTop: 10,
    borderTopColor: roman.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  year: { color: roman.goldLight, fontFamily: romanFont.semibold, fontSize: 13 },
  journal: {
    flexShrink: 1,
    color: roman.textMuted,
    fontFamily: romanFont.regular,
    fontSize: 13,
    lineHeight: 19,
  },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },
  tag: {
    backgroundColor: roman.goldTint,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagText: { color: roman.goldLight, fontFamily: romanFont.medium, fontSize: 12, lineHeight: 17 },

  abstractToggle: {
    minHeight: MIN_TOUCH,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    marginTop: 4,
    borderRadius: 8,
  },
  abstractToggleText: { color: roman.goldLight, fontFamily: romanFont.semibold, fontSize: 14 },
  abstract: { gap: 12, paddingBottom: 8 },
  abstractText: {
    color: roman.text,
    fontFamily: romanFont.regular,
    fontSize: 15,
    lineHeight: 24,
  },
  abstractLabel: { fontFamily: romanFont.semibold },
  originalNote: { color: roman.textMuted, fontFamily: romanFont.regular, fontSize: 12, lineHeight: 17 },
  abstractUnavailable: {
    color: roman.textMuted,
    fontFamily: romanFont.regular,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 12,
  },

  cardFooter: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: 12,
    marginTop: 4,
  },
  pmid: { color: roman.textMuted, fontFamily: romanFont.regular, fontSize: 12 },
  sourceLink: {
    minHeight: MIN_TOUCH,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 8,
  },
  sourceLinkText: { color: roman.goldLight, fontFamily: romanFont.semibold, fontSize: 14 },

  footer: { alignItems: "center", paddingVertical: 16, gap: 12 },
  errorTitle: {
    color: roman.danger,
    fontFamily: romanFont.semibold,
    fontSize: 16,
    textAlign: "center",
  },
  errorText: {
    color: roman.danger,
    fontFamily: romanFont.regular,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  mutedCenter: {
    color: roman.textMuted,
    fontFamily: romanFont.regular,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  endText: { color: roman.textMuted, fontFamily: romanFont.regular, fontSize: 13 },
  button: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 24,
    borderRadius: 12,
    backgroundColor: roman.surface,
    borderColor: roman.gold,
    borderWidth: 1,
  },
  buttonText: { color: roman.goldLight, fontFamily: romanFont.semibold, fontSize: 14 },
});
