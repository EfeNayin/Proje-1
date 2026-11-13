/**
 * Preview of one example program, opened from "Example programs" on Start Workout.
 *
 * Looking is free: nothing is created until "Add to my programs". That button asks the
 * server for an independent, editable, INACTIVE copy (so the active program is left
 * alone) and opens it in the existing program screen, where activating, editing and
 * starting from a template already live.
 *
 * What the sources found and what Aures chose are shown in separate sections on
 * purpose; the example is an Aures example informed by the sources, not their
 * prescription. The copy request is made safe to repeat by src/programs/exampleCopy.ts.
 */

import { Ionicons } from "@expo/vector-icons";
import { randomUUID } from "expo-crypto";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as exampleApi from "../../../src/api/examplePrograms";
import type { ExampleDetail } from "../../../src/api/examplePrograms";
import { useAuth } from "../../../src/auth/AuthContext";
import { light } from "../../../src/lightTheme";
import { createExampleCopier } from "../../../src/programs/exampleCopy";
import {
  cardMeta,
  dayTotals,
  isSourceUrl,
  targetAccessibilityLabel,
  targetLabel,
  weeklySetsLabel,
} from "../../../src/programs/exampleDisplay";

const MIN_TOUCH = 44;

async function openSource(url: string): Promise<void> {
  if (!isSourceUrl(url)) return;
  try {
    await WebBrowser.openBrowserAsync(url);
  } catch {
    Linking.openURL(url).catch(() => undefined);
  }
}

export default function ExampleProgramScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const [example, setExample] = useState<ExampleDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // What "the signed-in account" means to an answer that arrives later.
  const userIdRef = useRef<string | undefined>(user?.id);
  useEffect(() => {
    userIdRef.current = user?.id;
  }, [user?.id]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const [copier] = useState(() =>
    createExampleCopier({
      store: {
        get: (storageKey) => SecureStore.getItemAsync(storageKey),
        set: (storageKey, value) => SecureStore.setItemAsync(storageKey, value),
        remove: (storageKey) => SecureStore.deleteItemAsync(storageKey),
      },
      newRequestId: randomUUID,
      copy: exampleApi.copyExampleProgram,
      isCurrent: (userId) => userIdRef.current === userId,
    }),
  );

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    exampleApi
      .getExampleProgram(id)
      .then((detail) => {
        if (cancelled) return;
        setExample(detail);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const status = (err as { status?: number } | null)?.status;
        setLoadError(
          status === 404
            ? "This example program is not available any more."
            : "Could not load this example program.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  const handleAdd = async () => {
    if (!example || !user?.id) return;
    setAddError(null);
    const userId = user.id;
    const outcome = await copier(userId, { example_id: example.id, version: example.version }, () =>
      setAdding(true),
    );
    if (outcome.kind === "ignored" || outcome.kind === "abandoned") return;
    if (!mounted.current) return;
    setAdding(false);
    if (outcome.kind === "copied") {
      // Replace, so Back from the program lands on Start Workout rather than on this preview.
      router.replace(`/program/${outcome.programId}`);
    } else if (outcome.kind === "stale") {
      setAddError(outcome.message);
      setExample(null);
      setAttempt((value) => value + 1);
    } else {
      setAddError(outcome.message);
    }
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: example?.level ? `${example.level} example` : "Example program" }} />
      {example ? (
        <>
          <ScrollView contentContainerStyle={styles.content}>
            <Text accessibilityRole="header" style={styles.title}>
              {example.name}
            </Text>
            <Text style={styles.meta}>{cardMeta(example)}</Text>
            <Text style={styles.lead}>
              An Aures example, informed by published research. It is a starting point you can edit
              freely.
            </Text>

            <Section title="Suggested schedule">
              <Text style={styles.body}>{example.schedule}</Text>
              <Text style={styles.small}>
                {weeklySetsLabel(example)} (warm-up sets not counted). Weights are yours to enter when
                you log.
              </Text>
            </Section>

            {example.days.map((day) => (
              <View key={day.name} style={styles.section}>
                <Text accessibilityRole="header" style={styles.sectionTitle}>
                  {day.name}
                </Text>
                <Text style={styles.small}>{dayTotals(day)}</Text>
                <View style={styles.card}>
                  {day.exercises.map((exercise, index) => (
                    <View
                      key={`${exercise.exercise_order}-${exercise.exercise_name}`}
                      accessible
                      accessibilityLabel={targetAccessibilityLabel(exercise)}
                      style={[styles.exerciseRow, index < day.exercises.length - 1 && styles.divider]}
                    >
                      <Text style={styles.order}>{index + 1}</Text>
                      <View style={styles.exerciseText}>
                        <Text style={styles.exerciseName}>{exercise.exercise_name}</Text>
                        <Text style={styles.target}>{targetLabel(exercise)}</Text>
                        {exercise.notes ? <Text style={styles.note}>{exercise.notes}</Text> : null}
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ))}

            <Section title="What the sources found">
              <Text style={styles.small}>
                General findings from published research, in our words. They do not prescribe this
                program.
              </Text>
              {example.sources.map((source) => (
                <View key={source.url} style={styles.card}>
                  <View style={styles.sourceBody}>
                    <Text style={styles.sourceTitle}>{source.title}</Text>
                    <Text style={styles.sourceCitation}>{source.citation}</Text>
                    <Text style={styles.body}>{source.finding}</Text>
                    {isSourceUrl(source.url) ? (
                      <Pressable
                        accessibilityRole="link"
                        accessibilityLabel={`Open on PubMed: ${source.citation}`}
                        style={({ pressed }) => [styles.link, pressed && styles.linkPressed]}
                        onPress={() => void openSource(source.url)}
                      >
                        <Text style={styles.linkText}>Open on PubMed</Text>
                        <Ionicons name="open-outline" size={16} color={light.text} />
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ))}
            </Section>

            <Section title="What Aures chose">
              {example.authored.map((line) => (
                <Text key={line} style={[styles.body, styles.authoredLine]}>
                  {line}
                </Text>
              ))}
            </Section>
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) + 4 }]}>
            {addError ? (
              <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.errorText}>
                {addError}
              </Text>
            ) : null}
            <Text style={styles.footerNote}>
              Adds your own editable copy. It starts inactive, so your active program does not change.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add to my programs"
              accessibilityState={{ busy: adding, disabled: adding || !user?.id }}
              disabled={adding || !user?.id}
              style={({ pressed }) => [
                styles.primary,
                pressed && styles.primaryPressed,
                (adding || !user?.id) && styles.primaryBusy,
              ]}
              onPress={() => void handleAdd()}
            >
              {adding ? (
                <ActivityIndicator color={light.onPrimary} />
              ) : (
                <Text style={styles.primaryText}>Add to my programs</Text>
              )}
            </Pressable>
          </View>
        </>
      ) : loadError ? (
        <View style={styles.centered}>
          <Text accessibilityRole="alert" style={styles.errorText}>
            {loadError}
          </Text>
          {addError ? <Text style={styles.errorText}>{addError}</Text> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try loading the example again"
            style={styles.retry}
            onPress={() => {
              setLoadError(null);
              setAttempt((value) => value + 1);
            }}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.centered}>
          <ActivityIndicator color={light.textSecondary} accessibilityLabel="Loading example program" />
          {addError ? <Text style={styles.errorText}>{addError}</Text> : null}
        </View>
      )}
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background },
  content: { padding: 16, paddingBottom: 24 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 24 },
  title: { color: light.text, fontSize: 26, fontWeight: "700" },
  meta: { color: light.text, fontSize: 16, fontWeight: "600", marginTop: 4 },
  lead: { color: light.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 8 },
  section: { marginTop: 24, rowGap: 6 },
  sectionTitle: { color: light.text, fontSize: 18, fontWeight: "700" },
  body: { color: light.text, fontSize: 15, lineHeight: 21 },
  small: { color: light.textSecondary, fontSize: 13, lineHeight: 18 },
  card: { backgroundColor: light.surface, borderRadius: 12, marginTop: 4 },
  divider: { borderBottomColor: light.separator, borderBottomWidth: StyleSheet.hairlineWidth },
  exerciseRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "flex-start",
    columnGap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  order: { width: 20, color: light.textSecondary, fontSize: 15, fontWeight: "600", paddingTop: 1 },
  exerciseText: { flex: 1, minWidth: 0, rowGap: 2 },
  exerciseName: { color: light.text, fontSize: 16, fontWeight: "600" },
  target: { color: light.textSecondary, fontSize: 14 },
  note: { color: light.textSecondary, fontSize: 13, fontStyle: "italic" },
  sourceBody: { padding: 16, rowGap: 6 },
  sourceTitle: { color: light.text, fontSize: 15, fontWeight: "600", lineHeight: 20 },
  sourceCitation: { color: light.textSecondary, fontSize: 13 },
  authoredLine: { marginTop: 2 },
  link: {
    minHeight: MIN_TOUCH,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    columnGap: 6,
    paddingRight: 12,
  },
  linkPressed: { opacity: 0.6 },
  linkText: { color: light.text, fontSize: 15, fontWeight: "600", textDecorationLine: "underline" },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    rowGap: 8,
    backgroundColor: light.background,
    borderTopColor: light.separator,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerNote: { color: light.textSecondary, fontSize: 13, lineHeight: 18 },
  primary: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: light.primary,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  primaryPressed: { backgroundColor: light.primaryPressed },
  primaryBusy: { opacity: 0.6 },
  primaryText: { color: light.onPrimary, fontSize: 17, fontWeight: "600" },
  errorText: { color: light.danger, fontSize: 14, fontWeight: "500", lineHeight: 20, textAlign: "center" },
  retry: {
    minHeight: MIN_TOUCH,
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: light.surface,
  },
  retryText: { color: light.text, fontSize: 15, fontWeight: "600" },
});
