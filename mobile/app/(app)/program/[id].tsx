/**
 * Program detail: rename, activate/delete, and manage its templates.
 *
 * Templates are the "days" of the program (Push A, Pull A...). Adding one
 * only asks for a name; targets are set afterward in the template editor,
 * where the exercise picker is available.
 *
 * The native header is hidden (see the Stack options in (app)/_layout): the
 * screen draws one bar with a back arrow and delete, and the program's name is
 * the editable title below it, so the name is never shown twice.
 */

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as programsApi from "../../../src/api/programs";
import type { ProgramDetail } from "../../../src/api/programs";
import { createProgramMutations } from "../../../src/programs/programActions";
import { roman, useRomanFonts } from "../../../src/romanTheme";

const MIN_TOUCH = 44;

type Fonts = ReturnType<typeof useRomanFonts>;

/** The program's name, edited in place. Saved on blur or "done", matching the workout title field. */
function NameField({
  value,
  onSave,
  font,
}: {
  value: string;
  onSave: (name: string) => void;
  font: Fonts;
}) {
  const [draft, setDraft] = useState(value);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      // A name can't be blank: put the saved one back rather than keep an
      // empty field that silently saves nothing.
      setDraft(value);
      return;
    }
    if (trimmed === value) return;
    onSave(trimmed);
  };

  return (
    <View style={styles.nameRow}>
      <TextInput
        style={[styles.nameInput, font.title]}
        accessibilityLabel="Program name"
        value={draft}
        onChangeText={setDraft}
        onBlur={commit}
        onSubmitEditing={commit}
        returnKeyType="done"
        // Multiline so a long name wraps instead of being cut off; "done" still
        // ends editing rather than inserting a line break.
        multiline
        submitBehavior="blurAndSubmit"
        maxLength={200}
        selectionColor={roman.gold}
      />
      <Ionicons name="pencil" size={16} color={roman.textMuted} style={styles.nameIcon} />
    </View>
  );
}

function TopBar({
  topInset,
  onDelete,
  deleting,
}: {
  topInset: number;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const router = useRouter();
  return (
    <View style={[styles.topBar, { paddingTop: topInset }]}>
      <View style={styles.topBarRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={4}
          style={styles.iconButton}
          onPress={() => router.back()}
        >
          <Ionicons name="chevron-back" size={26} color={roman.text} />
        </Pressable>
        {onDelete ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete program"
            accessibilityState={{ busy: !!deleting, disabled: !!deleting }}
            disabled={deleting}
            hitSlop={4}
            style={styles.iconButton}
            onPress={onDelete}
          >
            {deleting ? (
              <ActivityIndicator size="small" color={roman.danger} />
            ) : (
              <Ionicons name="trash-outline" size={22} color={roman.danger} />
            )}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export default function ProgramScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const font = useRomanFonts();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [loaded, setProgram] = useState<ProgramDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [addingTemplate, setAddingTemplate] = useState(false);
  const [activating, setActivating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const latestLoad = useRef(0);

  // Never show a program that belongs to another route param.
  const program = loaded && loaded.id === id ? loaded : null;

  const mutations = useMemo(() => createProgramMutations(programsApi, id), [id]);

  // A failed refresh keeps the program already on screen and only reports the
  // problem; only the newest request may apply its result.
  const load = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      const mine = ++latestLoad.current;
      try {
        const next = await programsApi.getProgram(id);
        if (isCancelled() || mine !== latestLoad.current) return;
        setProgram(next);
        setLoadError(null);
      } catch (err) {
        if (isCancelled() || mine !== latestLoad.current) return;
        setLoadError(err instanceof Error ? err.message : "Could not load program");
      }
    },
    [id],
  );

  // Re-run on every focus, not just on mount: returning from the template
  // editor after a save is how this screen learns the exercise counts
  // changed — that refresh IS the save's success confirmation. Silent when the
  // program is already on screen, so the form and scroll position survive it.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void load(() => cancelled);
      return () => {
        cancelled = true;
      };
    }, [load]),
  );

  const retry = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const handleSaveName = async (name: string) => {
    setError(null);
    const outcome = await mutations.rename(name);
    if (outcome.kind === "done") setProgram(outcome.value);
    else if (outcome.kind === "failed" || outcome.kind === "invalid") setError(outcome.message);
  };

  const handleActivate = async () => {
    setError(null);
    const outcome = await mutations.activate(() => setActivating(true));
    if (outcome.kind === "ignored") return;
    setActivating(false);
    if (outcome.kind === "done") setProgram(outcome.value);
    else if (outcome.kind === "failed") setError(outcome.message);
  };

  const runDelete = async () => {
    setError(null);
    const outcome = await mutations.remove(() => setDeleting(true));
    if (outcome.kind === "ignored") return;
    // Released on success too: if leaving fails for any reason the screen must
    // not stay locked.
    setDeleting(false);
    if (outcome.kind === "done") router.back();
    else if (outcome.kind === "failed") setError(outcome.message);
  };

  const handleDelete = () => {
    if (deleting) return;
    Alert.alert("Delete program?", "Its templates will be deleted too.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void runDelete() },
    ]);
  };

  const handleAddTemplate = async () => {
    if (!program) return;
    setError(null);
    const outcome = await mutations.addTemplate(newTemplateName, program.templates.length, () =>
      setAddingTemplate(true),
    );
    if (outcome.kind === "ignored") return;
    setAddingTemplate(false);
    if (outcome.kind === "invalid" || outcome.kind === "failed") {
      // The typed name stays, so retrying is one tap.
      setError(outcome.message);
      return;
    }
    setNewTemplateName("");
    await load();
  };

  if (!program) {
    return (
      <View style={styles.screen}>
        <TopBar topInset={insets.top} />
        <View style={styles.centered}>
          {loadError ? (
            <View style={styles.stateBlock}>
              <Text
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={[styles.errorText, font.medium]}
              >
                {loadError}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Try loading the program again"
                disabled={refreshing}
                style={styles.retryButton}
                onPress={() => void retry()}
              >
                {refreshing ? (
                  <ActivityIndicator color={roman.goldLight} size="small" />
                ) : (
                  <Text style={[styles.retryText, font.semibold]}>Try again</Text>
                )}
              </Pressable>
            </View>
          ) : (
            <ActivityIndicator color={roman.gold} />
          )}
        </View>
      </View>
    );
  }

  const count = program.templates.length;

  return (
    <View style={styles.screen}>
      <TopBar topInset={insets.top} onDelete={handleDelete} deleting={deleting} />

      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        // iOS: lifts the content above the keyboard and scrolls the focused
        // field into view, including the "new template" field at the very
        // bottom. Android resizes the window itself.
        automaticallyAdjustKeyboardInsets
      >
        {program.is_active ? (
          <View style={styles.activePill}>
            <View style={styles.activeDot} />
            <Text style={[styles.activePillText, font.semibold]}>Active program</Text>
          </View>
        ) : null}

        <NameField
          key={program.name}
          value={program.name}
          onSave={(name) => void handleSaveName(name)}
          font={font}
        />

        {!program.is_active ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Make this the active program"
            accessibilityState={{ busy: activating, disabled: activating }}
            disabled={activating}
            style={({ pressed }) => [
              styles.activateButton,
              pressed && styles.activateButtonPressed,
              activating && styles.busy,
            ]}
            onPress={() => void handleActivate()}
          >
            {activating ? (
              <ActivityIndicator color={roman.gold} size="small" />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={18} color={roman.gold} />
                <Text style={[styles.activateButtonText, font.semibold]}>
                  Make this the active program
                </Text>
              </>
            )}
          </Pressable>
        ) : null}

        {loadError ? (
          <View style={styles.banner}>
            <Text
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              style={[styles.errorText, font.medium]}
            >
              {`Could not refresh: ${loadError}`}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Try loading the program again"
              disabled={refreshing}
              style={styles.retryButton}
              onPress={() => void retry()}
            >
              {refreshing ? (
                <ActivityIndicator color={roman.goldLight} size="small" />
              ) : (
                <Text style={[styles.retryText, font.semibold]}>Try again</Text>
              )}
            </Pressable>
          </View>
        ) : null}

        {error ? (
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[styles.errorText, styles.actionError, font.medium]}
          >
            {error}
          </Text>
        ) : null}

        <View style={styles.sectionRow}>
          <Text accessibilityRole="header" style={[styles.sectionTitle, font.semibold]}>
            Templates
          </Text>
          <Text style={[styles.sectionCount, font.regular]}>
            {count} template{count === 1 ? "" : "s"}
          </Text>
        </View>

        {program.templates.map((template, index) => {
          const exercises = template.exercises.length;
          const meta = `${exercises} exercise${exercises === 1 ? "" : "s"}`;
          return (
            <Pressable
              key={template.id}
              accessibilityRole="button"
              accessibilityLabel={`${template.name}, ${meta}`}
              accessibilityHint="Opens the template"
              style={({ pressed }) => [styles.templateCard, pressed && styles.templateCardPressed]}
              onPress={() => router.push(`/program/template/${template.id}`)}
            >
              <View style={styles.orderBadge}>
                <Text style={[styles.orderText, font.title]}>{index + 1}</Text>
              </View>
              <View style={styles.templateMain}>
                <Text style={[styles.templateName, font.semibold]}>{template.name}</Text>
                <Text style={[styles.templateMeta, font.regular]}>{meta}</Text>
              </View>
              <View style={styles.chevron}>
                <Ionicons name="chevron-forward" size={20} color={roman.textMuted} />
              </View>
            </Pressable>
          );
        })}

        {count === 0 ? (
          <Text style={[styles.empty, font.regular]}>No templates yet. Add a training day below.</Text>
        ) : null}

        <View style={styles.formCard}>
          <View style={styles.formHeading}>
            <Ionicons name="add-circle-outline" size={18} color={roman.gold} />
            <Text style={[styles.formLabel, font.semibold]}>New template</Text>
          </View>
          <TextInput
            style={[styles.input, font.regular]}
            accessibilityLabel="New template name"
            value={newTemplateName}
            onChangeText={setNewTemplateName}
            placeholder="e.g. Push A"
            placeholderTextColor={roman.placeholder}
            selectionColor={roman.gold}
            returnKeyType="done"
            maxLength={200}
            onSubmitEditing={() => void handleAddTemplate()}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add template"
            accessibilityState={{ busy: addingTemplate, disabled: addingTemplate }}
            disabled={addingTemplate}
            style={({ pressed }) => [
              styles.addButton,
              pressed && styles.addButtonPressed,
              addingTemplate && styles.busy,
            ]}
            onPress={() => void handleAddTemplate()}
          >
            {addingTemplate ? (
              <ActivityIndicator color={roman.background} size="small" />
            ) : (
              <>
                <Ionicons name="add" size={18} color={roman.background} />
                <Text style={[styles.addButtonText, font.semibold]}>Add template</Text>
              </>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: roman.background },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  content: { paddingHorizontal: 16 },
  stateBlock: { alignItems: "center", rowGap: 8 },
  busy: { opacity: 0.6 },

  topBar: { backgroundColor: roman.background, paddingHorizontal: 8 },
  topBarRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconButton: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    alignItems: "center",
    justifyContent: "center",
  },

  activePill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    columnGap: 6,
    backgroundColor: roman.goldTint,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 8,
  },
  activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: roman.gold },
  activePillText: {
    color: roman.gold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
  },

  nameRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    columnGap: 8,
    marginTop: 8,
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: roman.border,
  },
  nameInput: {
    flex: 1,
    minHeight: MIN_TOUCH,
    color: roman.text,
    fontSize: 26,
    fontWeight: "600",
    paddingVertical: 8,
    paddingHorizontal: 0,
  },
  nameIcon: { marginTop: 18 },

  activateButton: {
    minHeight: 48,
    flexDirection: "row",
    columnGap: 8,
    alignItems: "center",
    justifyContent: "center",
    borderColor: roman.gold,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 16,
  },
  activateButtonPressed: { backgroundColor: roman.goldTint },
  activateButtonText: { color: roman.gold, fontSize: 14, flexShrink: 1, textAlign: "center" },

  banner: {
    backgroundColor: roman.surface,
    borderColor: roman.danger,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    rowGap: 4,
  },
  errorText: { color: roman.danger, fontSize: 14, lineHeight: 20 },
  actionError: { marginBottom: 16 },
  retryButton: {
    minHeight: MIN_TOUCH,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingRight: 12,
  },
  retryText: { color: roman.goldLight, fontSize: 14 },

  sectionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    justifyContent: "space-between",
    columnGap: 12,
    marginBottom: 12,
  },
  sectionTitle: {
    color: roman.textMuted,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  sectionCount: { color: roman.textMuted, fontSize: 13 },

  templateCard: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 12,
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingLeft: 12,
    paddingRight: 4,
    marginBottom: 12,
  },
  templateCardPressed: { backgroundColor: roman.surfaceRaised },
  orderBadge: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: roman.background,
    borderColor: roman.border,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  orderText: { color: roman.gold, fontSize: 16, fontWeight: "600" },
  templateMain: { flex: 1, rowGap: 2 },
  templateName: { color: roman.text, fontSize: 16, lineHeight: 22 },
  templateMeta: { color: roman.textMuted, fontSize: 13 },
  chevron: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: { color: roman.textMuted, fontSize: 14, lineHeight: 20, marginBottom: 12 },

  formCard: {
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
  },
  formHeading: { flexDirection: "row", alignItems: "center", columnGap: 8, marginBottom: 12 },
  formLabel: {
    flexShrink: 1,
    color: roman.textMuted,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  input: {
    minHeight: 52,
    backgroundColor: roman.background,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    color: roman.text,
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  addButton: {
    minHeight: 52,
    flexDirection: "row",
    columnGap: 8,
    marginTop: 12,
    backgroundColor: roman.gold,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  addButtonPressed: { backgroundColor: roman.goldPressed },
  addButtonText: {
    color: roman.background,
    fontSize: 14,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
});
