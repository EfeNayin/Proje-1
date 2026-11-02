/**
 * Research: a small Turkish library of source-based explanations about general adult
 * resistance training, searchable by keyword or a typed sentence.
 *
 * The content is bundled with the app (src/research/library) and searched on the
 * device: nothing typed here is sent anywhere. It is not a question-answering
 * service. A question the library does not cover gets "no matching content", not a
 * guessed topic, and nothing is written for the reader. The live PubMed feed stays
 * available as a separate screen (research/pubmed) and is never queried from here.
 */

import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { light } from "../../../src/lightTheme";
import { LIBRARY_ENTRIES } from "../../../src/research/library/entries";
import { searchLibrary } from "../../../src/research/library/search";
import type { SearchHit } from "../../../src/research/library/search";

const MIN_TOUCH = 44;

export default function ResearchLibraryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [query, setQuery] = useState("");
  // Derived from the query on every render: there is no stored result that could
  // outlive a changed or cleared query.
  const result = useMemo(() => searchLibrary(LIBRARY_ENTRIES, query), [query]);

  const count =
    result.kind === "all"
      ? `${result.hits.length} konu`
      : result.kind === "matches"
        ? `${result.hits.length} konu bulundu`
        : null;

  const header = (
    <View style={styles.headerBlock}>
      <Text style={styles.intro}>
        Direnç antrenmanı üzerine yayımlanmış araştırmalara dayanan kısa Türkçe açıklamalar.
        Her konunun altında İngilizce özgün kaynaklar listelenir. Bunlar kaynaklardan derlenmiş
        açıklamalardır: bir uzman tarafından gözden geçirilmedi, kişiye özel değildir ve
        tavsiye yerine geçmez.
      </Text>

      <View style={styles.searchRow}>
        <Ionicons name="search" size={18} color={light.textSecondary} accessible={false} />
        <TextInput
          style={styles.input}
          accessibilityLabel="Kütüphanede ara"
          placeholder="Bir soru veya anahtar sözcük yazın"
          placeholderTextColor={light.textSecondary}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          selectionColor={light.text}
        />
        {query.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Aramayı temizle"
            hitSlop={8}
            style={({ pressed }) => [styles.clear, pressed && styles.pressed]}
            onPress={() => setQuery("")}
          >
            <Ionicons name="close-circle" size={20} color={light.textSecondary} accessible={false} />
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.privacy}>Arama yalnızca cihazınızdaki bu içerikte yapılır; yazdıklarınız gönderilmez.</Text>

      {count ? (
        <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={styles.count}>
          {count}
        </Text>
      ) : null}

      {result.kind === "no-terms" ? (
        <View style={styles.notice}>
          <Text accessibilityRole="alert" style={styles.noticeText}>
            Aramanız yalnızca yaygın sözcüklerden oluşuyor. Konuyla ilgili bir sözcük ekleyin
            (ör. set, dinlenme, uyku).
          </Text>
        </View>
      ) : null}

      {result.kind === "none" ? (
        <View style={styles.notice}>
          <Text accessibilityRole="alert" style={styles.noticeTitle}>
            Bu soruyla eşleşen içerik yok.
          </Text>
          <Text style={styles.noticeText}>
            Kütüphane yalnızca aşağıdaki konuları kapsar. Yeni yanıt üretmez ve soruya en yakın
            konuyu tahmin etmez.
          </Text>
          {result.unmatchedWords.length > 0 ? (
            <Text style={styles.noticeText}>
              Kütüphanede bulunmayan sözcükler: {result.unmatchedWords.join(", ")}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
            onPress={() => setQuery("")}
          >
            <Text style={styles.actionText}>Aramayı temizle ve tüm konuları göster</Text>
          </Pressable>
        </View>
      ) : null}

      {result.kind === "matches" && result.unmatchedWords.length > 0 ? (
        <Text style={styles.missing}>
          Kütüphanede bulunmayan sözcükler: {result.unmatchedWords.join(", ")}. Sonuçlar yalnızca
          diğer sözcüklere göre.
        </Text>
      ) : null}
    </View>
  );

  const footer = (
    <View style={styles.footerBlock}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="PubMed yayınları (İngilizce)"
        accessibilityHint="Canlı PubMed kayıtlarını açar"
        style={({ pressed }) => [styles.pubmedRow, pressed && styles.pressed]}
        onPress={() => router.push("/research/pubmed")}
      >
        <View style={styles.pubmedText}>
          <Text style={styles.pubmedTitle}>PubMed yayınları (İngilizce)</Text>
          <Text style={styles.meta}>
            PubMed’deki yayın kayıtları, özgün İngilizce özetleriyle. Yukarıdaki arama bu listeyi
            taramaz.
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={light.textSecondary} />
      </Pressable>
    </View>
  );

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 24 }}
      data={result.hits}
      keyExtractor={(hit) => hit.entry.id}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      renderItem={({ item, index }) => (
        <EntryRow
          hit={item}
          first={index === 0}
          onOpen={() => router.push({ pathname: "/research/[id]", params: { id: item.entry.id } })}
        />
      )}
    />
  );
}

function EntryRow({ hit, first, onOpen }: { hit: SearchHit; first: boolean; onOpen: () => void }) {
  const { entry, matchedWords } = hit;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${entry.title} ${entry.answer}`}
      style={({ pressed }) => [styles.row, first && styles.rowFirst, pressed && styles.pressed]}
      onPress={onOpen}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{entry.title}</Text>
        <Text numberOfLines={3} style={styles.snippet}>
          {entry.answer}
        </Text>
        {matchedWords.length > 0 ? (
          <Text style={styles.matched}>Eşleşen sözcükler: {matchedWords.join(", ")}</Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={light.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background },
  pressed: { backgroundColor: light.pressed },

  headerBlock: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  intro: { color: light.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 16 },
  searchRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: light.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  input: { flex: 1, minHeight: 48, color: light.text, fontSize: 16 },
  clear: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: "center", justifyContent: "center", marginRight: -8 },
  privacy: { color: light.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 8 },
  count: { color: light.text, fontSize: 15, fontWeight: "600", marginTop: 16, marginLeft: 4 },
  notice: {
    backgroundColor: light.surface,
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    gap: 8,
  },
  noticeTitle: { color: light.text, fontSize: 16, fontWeight: "600", lineHeight: 22 },
  noticeText: { color: light.textSecondary, fontSize: 14, lineHeight: 20 },
  missing: { color: light.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 8, marginLeft: 4 },
  textButton: { minHeight: MIN_TOUCH, alignSelf: "flex-start", justifyContent: "center" },
  actionText: {
    color: light.text,
    fontSize: 15,
    fontWeight: "600",
    textDecorationLine: "underline",
  },

  // One white row per topic, edge to edge, divided by hairlines.
  row: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: light.surface,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomColor: light.separator,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowFirst: { borderTopColor: light.separator, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 8 },
  rowText: { flex: 1, gap: 4 },
  rowTitle: { color: light.text, fontSize: 17, fontWeight: "600", lineHeight: 23 },
  snippet: { color: light.textSecondary, fontSize: 14, lineHeight: 20 },
  matched: { color: light.textSecondary, fontSize: 12, lineHeight: 17 },
  meta: { color: light.textSecondary, fontSize: 13, lineHeight: 19 },

  footerBlock: { paddingHorizontal: 16, paddingTop: 24 },
  pubmedRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: light.surface,
    borderRadius: 12,
    paddingVertical: 12,
    paddingLeft: 16,
    paddingRight: 12,
  },
  pubmedText: { flex: 1, gap: 2 },
  pubmedTitle: { color: light.text, fontSize: 15, fontWeight: "600" },
});
