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
import { light } from "../../../src/lightTheme";
import { createProgramMutations } from "../../../src/programs/programActions";

const MIN_TOUCH = 44;

/** The program's name, edited in place. Saved on blur or "done", matching the workout title field. */
function NameField({
  value,
  onSave,
}: {
  value: string;
  onSave: (name: string) => void;
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
        style={styles.nameInput}
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
        selectionColor={light.text}
      />
      <Ionicons name="pencil" size={16} color={light.textSecondary} style={styles.nameIcon} />
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
          <Ionicons name="chevron-back" size={26} color={light.text} />
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
              <ActivityIndicator size="small" color={light.danger} />
            ) : (
              <Ionicons name="trash-outline" size={22} color={light.danger} />
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
                style={styles.errorText}
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
                  <ActivityIndicator color={light.text} size="small" />
                ) : (
                  <Text style={styles.retryText}>Try again</Text>
                )}
              </Pressable>
            </View>
          ) : (
            <ActivityIndicator color={light.textSecondary} />
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
          <View style={styles.activeRow}>
            <View style={styles.activeDot} />
            <Text style={styles.activeText}>Active program</Text>
          </View>
        ) : null}

        <NameField
          key={program.name}
          value={program.name}
          onSave={(name) => void handleSaveName(name)}
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
              <ActivityIndicator color={light.onPrimary} size="small" />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={18} color={light.onPrimary} />
                <Text style={styles.activateButtonText}>
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
              style={styles.errorText}
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
                <ActivityIndicator color={light.text} size="small" />
              ) : (
                <Text style={styles.retryText}>Try again</Text>
              )}
            </Pressable>
          </View>
        ) : null}

        {error ? (
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[styles.errorText, styles.actionError]}
          >
            {error}
          </Text>
        ) : null}

        <View style={styles.sectionRow}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            Templates
          </Text>
          <Text style={styles.sectionCount}>
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
              style={({ pressed }) => [
                styles.templateRow,
                index === 0 && styles.templateFirst,
                index === count - 1 && styles.templateLast,
                index < count - 1 && styles.templateDivider,
                pressed && styles.templateRowPressed,
              ]}
              onPress={() => router.push(`/program/template/${template.id}`)}
            >
              <View style={styles.orderBadge}>
                <Text style={styles.orderText}>{index + 1}</Text>
              </View>
              <View style={styles.templateMain}>
                <Text numberOfLines={2} style={styles.templateName}>{template.name}</Text>
                <Text style={styles.templateMeta}>{meta}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={light.textSecondary} />
            </Pressable>
          );
        })}

        {count === 0 ? (
          <Text style={styles.empty}>No templates yet. Add a training day below.</Text>
        ) : null}

        <View style={styles.formCard}>
          <Text style={styles.formLabel}>New template</Text>
          <TextInput
            style={styles.input}
            accessibilityLabel="New template name"
            value={newTemplateName}
            onChangeText={setNewTemplateName}
            placeholder="e.g. Push A"
            placeholderTextColor={light.textSecondary}
            selectionColor={light.text}
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
              <ActivityIndicator color={light.onPrimary} size="small" />
            ) : (
              <>
                <Ionicons name="add" size={18} color={light.onPrimary} />
                <Text style={styles.addButtonText}>Add template</Text>
              </>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: light.background },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  content: { paddingHorizontal: 16 },
  stateBlock: { alignItems: "center", rowGap: 8 },
  busy: { opacity: 0.6 },

  topBar: { backgroundColor: light.background, paddingHorizontal: 8 },
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

  activeRow: { flexDirection: "row", alignItems: "center", columnGap: 6, marginTop: 8 },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: light.positive },
  activeText: { color: light.positive, fontSize: 13, fontWeight: "600" },

  nameRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    columnGap: 8,
    marginTop: 4,
    marginBottom: 16,
  },
  nameInput: {
    flex: 1,
    minHeight: MIN_TOUCH,
    color: light.text,
    fontSize: 28,
    fontWeight: "700",
    paddingVertical: 8,
    paddingHorizontal: 0,
  },
  nameIcon: { marginTop: 18 },

  activateButton: {
    minHeight: 52,
    flexDirection: "row",
    columnGap: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: light.primary,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 16,
  },
  activateButtonPressed: { backgroundColor: light.primaryPressed },
  activateButtonText: { color: light.onPrimary, fontSize: 16, fontWeight: "600", flexShrink: 1, textAlign: "center" },

  banner: {
    backgroundColor: light.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    rowGap: 4,
  },
  errorText: { color: light.danger, fontSize: 14, fontWeight: "500", lineHeight: 20 },
  actionError: { marginBottom: 16 },
  retryButton: {
    minHeight: MIN_TOUCH,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingRight: 12,
  },
  retryText: { color: light.text, fontSize: 15, fontWeight: "600" },

  sectionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    justifyContent: "space-between",
    columnGap: 12,
    marginBottom: 8,
    marginHorizontal: 4,
  },
  sectionTitle: { color: light.textSecondary, fontSize: 13, fontWeight: "600" },
  sectionCount: { color: light.textSecondary, fontSize: 13 },

  // Templates form one grouped surface: the first row rounds the top, the last the bottom.
  templateRow: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 12,
    backgroundColor: light.surface,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 14,
  },
  templateFirst: { borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  templateLast: { borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
  templateDivider: { borderBottomColor: light.separator, borderBottomWidth: StyleSheet.hairlineWidth },
  templateRowPressed: { backgroundColor: light.pressed },
  orderBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: light.background,
    alignItems: "center",
    justifyContent: "center",
  },
  orderText: { color: light.textSecondary, fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] },
  templateMain: { flex: 1, minWidth: 0, rowGap: 2 },
  templateName: { color: light.text, fontSize: 17, fontWeight: "600" },
  templateMeta: { color: light.textSecondary, fontSize: 13 },
  empty: { color: light.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 12, marginHorizontal: 4 },

  formCard: {
    backgroundColor: light.surface,
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
  },
  formLabel: { color: light.text, fontSize: 17, fontWeight: "600", marginBottom: 12 },
  input: {
    minHeight: 48,
    backgroundColor: light.background,
    borderRadius: 10,
    color: light.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  addButton: {
    minHeight: 52,
    flexDirection: "row",
    columnGap: 8,
    marginTop: 12,
    backgroundColor: light.primary,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  addButtonPressed: { backgroundColor: light.primaryPressed },
  addButtonText: { color: light.onPrimary, fontSize: 17, fontWeight: "600" },
});
