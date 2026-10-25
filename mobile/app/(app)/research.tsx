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
 * so this screen draws no title of its own. Light theme, system font.
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
import { light } from "../../src/lightTheme";
import { createPublicationFeed } from "../../src/research/publicationFeed";
import { pubmedLink } from "../../src/research/sourceLink";

const MIN_TOUCH = 44;

async function openSource(url: string): Promise<void> {
  try {
    await WebBrowser.openBrowserAsync(url);
  } catch {
    Linking.openURL(url).catch(() => undefined);
  }
}

/** Journal and year exactly as PubMed gives them; a missing part is left out, never guessed. */
function sourceLine(publication: Publication): string | null {
  const parts = [publication.journal, publication.year != null ? String(publication.year) : null];
  const present = parts.filter((part): part is string => !!part);
  return present.length > 0 ? present.join(" · ") : null;
}

function PublicationRow({ publication, first }: { publication: Publication; first: boolean }) {
  const [open, setOpen] = useState(false);
  const link = pubmedLink(publication);
  const source = sourceLine(publication);

  return (
    <View style={[styles.row, first && styles.rowFirst]}>
      <View style={styles.inner}>
        <Text style={styles.title}>{publication.title}</Text>

        {source ? <Text style={styles.source}>{source}</Text> : null}

        {publication.publication_types.length > 0 ? (
          <View
            accessible
            accessibilityLabel={`Publication type: ${publication.publication_types.join(", ")}`}
            style={styles.types}
          >
            {publication.publication_types.map((type) => (
              <View key={type} style={styles.type}>
                <Text style={styles.typeText}>{type}</Text>
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
              style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
              onPress={() => setOpen((value) => !value)}
            >
              <Text style={styles.actionText}>{open ? "Hide abstract" : "Show abstract"}</Text>
              <Ionicons
                name={open ? "chevron-up" : "chevron-down"}
                size={16}
                color={light.text}
                accessible={false}
              />
            </Pressable>
            {open ? (
              <View style={styles.abstract}>
                {publication.abstract.map((section, index) => (
                  <Text key={index} style={styles.abstractText} selectable>
                    {section.label ? (
                      <Text style={styles.abstractLabel}>{section.label}: </Text>
                    ) : null}
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

        <View style={styles.footer}>
          <Text style={styles.pmid}>PMID {publication.pmid}</Text>
          {link ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="View on PubMed"
              accessibilityHint={`Opens PMID ${publication.pmid} in your browser`}
              style={({ pressed }) => [styles.link, pressed && styles.pressed]}
              onPress={() => void openSource(link)}
            >
              <Text style={styles.actionText}>View on PubMed</Text>
              <Ionicons name="open-outline" size={16} color={light.text} accessible={false} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

export default function ResearchScreen() {
  const insets = useSafeAreaInsets();
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
    <View style={styles.headerBlock}>
      <Text style={styles.intro}>
        Publication records from PubMed on resistance training and muscle hypertrophy, newest
        first. These are the authors&apos; abstracts, shown in their original English — the full
        papers were not reviewed, and nothing here is tailored to you.
      </Text>
      {error?.kind === "refresh" ? (
        <View style={styles.banner}>
          <Text accessibilityRole="alert" style={styles.errorText}>
            {items.length > 0
              ? `Could not refresh. ${error.message} Showing what was loaded before.`
              : `Could not refresh. ${error.message}`}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
            onPress={() => void feed.refresh()}
          >
            <Text style={styles.actionText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  const footer = (
    <View style={styles.listFooter}>
      {error?.kind === "more" ? (
        <>
          <Text accessibilityRole="alert" style={styles.errorText}>
            Could not load more publications. {error.message}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={() => void feed.loadMore(true)}
          >
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </>
      ) : loadingMore ? (
        <ActivityIndicator color={light.textSecondary} accessibilityLabel="Loading more publications" />
      ) : hasMore && !loading ? (
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
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
        <Text style={styles.centeredText}>{error.message}</Text>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={() => void feed.refresh()}
        >
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    ) : (
      <View style={styles.centered}>
        <ActivityIndicator color={light.textSecondary} accessibilityLabel="Loading publications" />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 24 }}
      data={items}
      keyExtractor={(item) => item.pmid}
      renderItem={({ item, index }) => <PublicationRow publication={item} first={index === 0} />}
      ListHeaderComponent={header}
      // A failed refresh is not an empty result: only say "no publications"
      // when PubMed answered and the list really is empty.
      ListEmptyComponent={
        error ? null : (
          <Text style={styles.centeredText}>PubMed returned no matching publications.</Text>
        )
      }
      ListFooterComponent={footer}
      onEndReached={() => void feed.loadMore()}
      onEndReachedThreshold={0.4}
      refreshControl={
        <RefreshControl
          refreshing={loading}
          onRefresh={() => void feed.refresh()}
          tintColor={light.textSecondary}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
    backgroundColor: light.background,
  },
  pressed: { backgroundColor: light.pressed },

  headerBlock: { paddingHorizontal: 16, paddingTop: 8 },
  intro: { color: light.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 16 },
  banner: {
    backgroundColor: light.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    gap: 4,
  },

  // One white row per publication, edge to edge, divided by hairlines rather
  // than boxed into cards.
  row: {
    backgroundColor: light.surface,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomColor: light.separator,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowFirst: { borderTopColor: light.separator, borderTopWidth: StyleSheet.hairlineWidth },
  // Keeps abstract lines readable on wide screens.
  inner: { width: "100%", maxWidth: 680, alignSelf: "center" },
  title: { color: light.text, fontSize: 17, fontWeight: "600", lineHeight: 24 },
  source: { color: light.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 6 },
  types: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  type: {
    backgroundColor: light.background,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  typeText: { color: light.textSecondary, fontSize: 12, lineHeight: 17 },

  toggle: {
    minHeight: MIN_TOUCH,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    marginTop: 6,
    borderRadius: 8,
  },
  // Underlined so a control reads as one without relying on colour.
  actionText: {
    color: light.text,
    fontSize: 15,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  abstract: { gap: 12, paddingTop: 4, paddingBottom: 8 },
  abstractText: { color: light.text, fontSize: 16, lineHeight: 25 },
  abstractLabel: { fontWeight: "600" },
  originalNote: { color: light.textSecondary, fontSize: 13, lineHeight: 18 },
  abstractUnavailable: {
    color: light.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 12,
  },

  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: 12,
    marginTop: 4,
  },
  pmid: { color: light.textSecondary, fontSize: 13 },
  link: {
    minHeight: MIN_TOUCH,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 8,
  },

  listFooter: { alignItems: "center", paddingVertical: 16, paddingHorizontal: 16, gap: 12 },
  errorTitle: {
    color: light.danger,
    fontSize: 17,
    fontWeight: "600",
    lineHeight: 22,
    textAlign: "center",
  },
  errorText: { color: light.danger, fontSize: 14, lineHeight: 20 },
  centeredText: {
    color: light.textSecondary,
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  endText: { color: light.textSecondary, fontSize: 13 },
  textButton: { minHeight: MIN_TOUCH, alignSelf: "flex-start", justifyContent: "center" },
  button: {
    minHeight: 52,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    borderRadius: 14,
    backgroundColor: light.primary,
  },
  buttonPressed: { backgroundColor: light.primaryPressed },
  buttonText: { color: light.onPrimary, fontSize: 16, fontWeight: "600" },
});
