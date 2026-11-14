/**
 * One library topic: the short answer, the explanation (each paragraph tied to the
 * sources it rests on), who the studies were done in, their limits, and the original
 * English publications with links to the publisher and to PubMed.
 */

import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { light } from "../../../src/lightTheme";
import { LIBRARY_ENTRIES } from "../../../src/research/library/entries";
import {
  citationLine,
  formatCheckedOn,
  originalLanguageNote,
  sourceKindLabel,
} from "../../../src/research/library/format";
import { doiUrl, pubmedUrl } from "../../../src/research/library/links";
import { LIBRARY_SOURCES } from "../../../src/research/library/sources";
import type { LibrarySource } from "../../../src/research/library/types";
import { openLibrarySource } from "../../../src/research/openExternal";

const MIN_TOUCH = 44;

export default function ResearchEntryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const padding = { paddingBottom: Math.max(insets.bottom, 16) + 24 };
  const entry = LIBRARY_ENTRIES.find((item) => item.id === id);

  if (!entry) {
    return (
      <View style={[styles.screen, styles.missing, padding]}>
        <Text accessibilityRole="alert" style={styles.missingText}>
          Bu konu kütüphanede bulunamadı.
        </Text>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          // A link straight to a topic has no library underneath it; fall back to the list.
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/research"))}
        >
          <Text style={styles.buttonText}>Konulara dön</Text>
        </Pressable>
      </View>
    );
  }

  const sources = entry.sourceIds
    .map((sourceId) => LIBRARY_SOURCES.find((source) => source.id === sourceId))
    .filter((source): source is LibrarySource => source !== undefined);
  const number = (sourceId: string) => entry.sourceIds.indexOf(sourceId) + 1;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, padding]}>
      <Text accessibilityRole="header" style={styles.title}>
        {entry.title}
      </Text>
      <Text style={styles.label}>Kaynaklara dayalı Türkçe açıklama · kişisel tavsiye değildir</Text>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.cardTitle}>
          Kısa yanıt
        </Text>
        <Text style={styles.body}>{entry.answer}</Text>
      </View>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.cardTitle}>
          Açıklama
        </Text>
        {entry.explanation.map((part, index) => (
          <View key={index} style={styles.paragraph}>
            <Text style={styles.body}>{part.text}</Text>
            <Text style={styles.cites}>Kaynak: {part.sourceIds.map((sourceId) => `[${number(sourceId)}]`).join(" ")}</Text>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.cardTitle}>
          Kapsam ve bağlam
        </Text>
        <Text style={styles.body}>{entry.context}</Text>
      </View>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.cardTitle}>
          Sınırlamalar
        </Text>
        {entry.limitations.map((limitation, index) => (
          <View key={index} style={styles.bulletRow}>
            <Text style={styles.bullet}>•</Text>
            <Text style={[styles.body, styles.bulletText]}>{limitation}</Text>
          </View>
        ))}
      </View>

      <Text accessibilityRole="header" style={styles.sectionLabel}>
        Kaynaklar ({originalLanguageNote.toLowerCase()})
      </Text>
      <Text style={styles.meta}>
        Kaynak kayıtları {formatCheckedOn(entry.sourcesCheckedOn)} tarihinde PubMed’de kontrol edildi.
        Açıklamalar bu kaynakların özetlerinden derlenmiştir; tam metinler incelenmemiştir.
      </Text>
      {sources.map((source) => (
        <SourceBlock key={source.id} source={source} number={number(source.id)} />
      ))}
    </ScrollView>
  );
}

function SourceBlock({ source, number }: { source: LibrarySource; number: number }) {
  const publisher = doiUrl(source.doi);
  const pubmed = pubmedUrl(source.pmid);
  return (
    <View style={styles.source}>
      <Text style={styles.sourceTitle}>
        [{number}] {source.title}
      </Text>
      <Text style={styles.meta}>{citationLine(source)}</Text>
      <Text style={styles.meta}>
        {sourceKindLabel(source.kind)} · {originalLanguageNote} · PMID {source.pmid}
      </Text>
      <View style={styles.links}>
        {publisher ? (
          <SourceLink label="Yayıncı sayfası (DOI)" hint="Özgün yayını tarayıcıda açar" url={publisher} />
        ) : null}
        {pubmed ? (
          <SourceLink label="PubMed kaydı" hint={`PMID ${source.pmid} kaydını tarayıcıda açar`} url={pubmed} />
        ) : null}
      </View>
    </View>
  );
}

function SourceLink({ label, hint, url }: { label: string; hint: string; url: string }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityHint={hint}
      style={({ pressed }) => [styles.link, pressed && styles.pressed]}
      onPress={() => void openLibrarySource(url)}
    >
      <Text style={styles.actionText}>{label}</Text>
      <Ionicons name="open-outline" size={16} color={light.text} accessible={false} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background },
  content: { paddingHorizontal: 16, paddingTop: 8 },
  pressed: { backgroundColor: light.pressed },
  title: { color: light.text, fontSize: 22, fontWeight: "700", lineHeight: 29 },
  label: { color: light.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 6, marginBottom: 16 },
  card: {
    backgroundColor: light.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    gap: 10,
  },
  cardTitle: { color: light.text, fontSize: 17, fontWeight: "600", lineHeight: 22 },
  body: { color: light.text, fontSize: 16, lineHeight: 24 },
  paragraph: { gap: 4 },
  cites: { color: light.textSecondary, fontSize: 13, lineHeight: 18 },
  bulletRow: { flexDirection: "row", gap: 8 },
  bullet: { color: light.text, fontSize: 16, lineHeight: 24 },
  bulletText: { flex: 1 },
  sectionLabel: { color: light.textSecondary, fontSize: 13, fontWeight: "600", marginTop: 12, marginLeft: 4 },
  meta: { color: light.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 2, marginHorizontal: 4 },
  source: {
    backgroundColor: light.surface,
    borderRadius: 12,
    padding: 16,
    marginTop: 10,
    gap: 2,
  },
  sourceTitle: { color: light.text, fontSize: 15, fontWeight: "600", lineHeight: 21 },
  links: { flexDirection: "row", flexWrap: "wrap", columnGap: 20 },
  link: {
    minHeight: MIN_TOUCH,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 8,
  },
  // Underlined so a control reads as one without relying on colour.
  actionText: {
    color: light.text,
    fontSize: 15,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  missing: { alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  missingText: { color: light.text, fontSize: 16, lineHeight: 22, textAlign: "center" },
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
