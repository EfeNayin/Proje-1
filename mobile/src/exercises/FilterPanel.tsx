/**
 * A filter's choices as a plain list: one "All ..." choice and the options,
 * exactly one of them checked. Choosing applies it; Close leaves it as it was.
 *
 * It is drawn inside the browser, in place of the results, rather than as a
 * modal of its own: the exercise picker is already presented in a native modal,
 * and a list in the same screen behaves the same on every platform.
 *
 * The panel only reports a value. It does not know what the values mean, so a
 * different way of choosing a muscle (an anatomical model) can replace the list
 * without the browser changing.
 */

import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { light } from "../lightTheme";

const MIN_TOUCH = 44;

type Option = { value: string; label: string; group?: string };

export function FilterPanel({
  title,
  allLabel,
  options,
  value,
  status = "ready",
  loadingLabel,
  errorText,
  retryLabel,
  onRetry,
  onSelect,
  onClose,
}: {
  title: string;
  allLabel: string;
  options: Option[];
  value: string | null;
  /** "loading" and "error" are for options that come from the server. */
  status?: "ready" | "loading" | "error";
  loadingLabel?: string;
  errorText?: string;
  retryLabel?: string;
  onRetry?: () => void;
  onSelect: (value: string | null) => void;
  onClose: () => void;
}) {
  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Close ${title}`}
          style={styles.close}
          onPress={onClose}
        >
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </View>

      <ScrollView
        accessibilityRole="radiogroup"
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <Choice label={allLabel} checked={value === null} onPress={() => onSelect(null)} />
        </View>

        {status === "loading" ? (
          <ActivityIndicator
            color={light.textSecondary}
            accessibilityLabel={loadingLabel}
            style={styles.status}
          />
        ) : status === "error" ? (
          <View style={styles.status}>
            <Text accessibilityRole="alert" style={styles.errorText}>
              {errorText}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={retryLabel}
              style={styles.retry}
              onPress={onRetry}
            >
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          sections(options).map((section) => (
            <View key={section.group ?? "all"}>
              {section.group ? (
                <Text accessibilityRole="header" style={styles.group}>
                  {section.group}
                </Text>
              ) : null}
              <View style={[styles.card, !section.group && styles.cardSpaced]}>
                {section.options.map((option, index) => (
                  <Choice
                    key={option.value}
                    label={option.label}
                    checked={value === option.value}
                    divider={index > 0}
                    onPress={() => onSelect(option.value)}
                  />
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

/** Consecutive options with the same group heading, in the order given. */
function sections(options: Option[]): { group?: string; options: Option[] }[] {
  const result: { group?: string; options: Option[] }[] = [];
  for (const option of options) {
    const current = result[result.length - 1];
    if (current && current.group === option.group) current.options.push(option);
    else result.push({ group: option.group, options: [option] });
  }
  return result;
}

function Choice({
  label,
  checked,
  divider = false,
  onPress,
}: {
  label: string;
  checked: boolean;
  divider?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      style={({ pressed }) => [styles.choice, divider && styles.choiceDivider, pressed && styles.pressed]}
      onPress={onPress}
    >
      <Text style={[styles.choiceText, checked && styles.choiceTextChecked]}>{label}</Text>
      {/* The state is announced by the radio role; the mark is for sighted users. */}
      {checked ? (
        <Text accessible={false} style={styles.check}>
          ✓
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  title: { color: light.text, fontSize: 18, fontWeight: "700" },
  close: { minHeight: MIN_TOUCH, minWidth: MIN_TOUCH, justifyContent: "center", alignItems: "flex-end" },
  closeText: { color: light.text, fontSize: 15, fontWeight: "600" },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  card: { backgroundColor: light.surface, borderRadius: 12, overflow: "hidden" },
  cardSpaced: { marginTop: 16 },
  group: { color: light.textSecondary, fontSize: 13, fontWeight: "600", marginTop: 16, marginBottom: 6, marginLeft: 4 },
  choice: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  choiceDivider: { borderTopColor: light.separator, borderTopWidth: StyleSheet.hairlineWidth },
  choiceText: { flexShrink: 1, color: light.text, fontSize: 16 },
  choiceTextChecked: { fontWeight: "700" },
  check: { color: light.text, fontSize: 16, fontWeight: "700" },
  pressed: { backgroundColor: light.pressed },
  status: { alignItems: "center", gap: 8, paddingVertical: 24 },
  errorText: { color: light.danger, fontSize: 14, textAlign: "center" },
  retry: {
    minHeight: MIN_TOUCH,
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: light.surface,
  },
  retryText: { color: light.text, fontSize: 15, fontWeight: "600" },
});
