/**
 * Active workout: the screen the user actually holds between sets.
 *
 * Sets are grouped by exercise. Every mutation posts to the API and replaces
 * local state with the response, so the totals and set numbering on screen
 * are always the server's, never a local guess that could drift.
 */

import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as programsApi from "../../../src/api/programs";
import { ApiError } from "../../../src/api/client";
import type {
  ProgramDetail,
} from "../../../src/api/programs";
import * as workoutsApi from "../../../src/api/workouts";
import type { LoggedSet, WorkoutDetail } from "../../../src/api/workouts";
import { useAuth } from "../../../src/auth/AuthContext";
import { roman, romanFont } from "../../../src/romanTheme";
import {
  formatWeight,
  formatWeightValue,
  parseWeightInput,
  type WeightUnit,
} from "../../../src/units/weight";
import { clearActiveWorkout } from "../../../src/workout/activeWorkout";
import {
  DEFAULT_REST_SECONDS,
  formatRest,
  getRestSeconds,
  REST_PRESETS,
  setRestSeconds,
} from "../../../src/workout/restPreference";
import { buildTemplateExercisesFromWorkout } from "../../../src/workout/templateFromWorkout";
import { getStartingPlan } from "../../../src/workout/startingPlan";
import { formatRecordedRir, parseRirInput } from "../../../src/workout/rir";
import { PreviousExercise } from "../../../src/workout/PreviousExercise";
import { getSetSaveRequest, prepareSetSaveRequest, sendSetSaveRequest, type SetSaveRequest } from "../../../src/workout/setSaveRequest";
import {
  clearTemplateSaveRequest,
  getTemplateSaveRequest,
  prepareTemplateSaveRequest,
  sendTemplateSaveRequest,
} from "../../../src/workout/templateSaveRequest";
import type { TemplateSaveRequest } from "../../../src/workout/templateSaveRequest";
import { usePickedExercise } from "../../../src/workout/usePickedExercise";

type ExerciseBlock = {
  exerciseId: string;
  name: string;
  sets: LoggedSet[];
};

/** Groups sets by exercise, preserving the order they were first logged in. */
function groupByExercise(
  sets: LoggedSet[],
  extraIds: { id: string; name: string }[],
): ExerciseBlock[] {
  const blocks = new Map<string, ExerciseBlock>();

  for (const set of sets) {
    const block = blocks.get(set.exercise_id) ?? {
      exerciseId: set.exercise_id,
      name: set.exercise_name,
      sets: [],
    };
    block.sets.push(set);
    blocks.set(set.exercise_id, block);
  }

  // Exercises picked but not yet logged have no sets on the server, so they
  // only exist in local state until the first set lands.
  for (const extra of extraIds) {
    if (!blocks.has(extra.id)) {
      blocks.set(extra.id, { exerciseId: extra.id, name: extra.name, sets: [] });
    }
  }

  return [...blocks.values()];
}

/**
 * Seconds since a timestamp, ticking every second.
 *
 * Derived from the timestamp rather than incremented: backgrounding the app
 * pauses JS timers, and a counter would silently lose those seconds.
 */
function useElapsedSeconds(since: number | null): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (since === null) return;

    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - since) / 1000)));
    tick();
    const handle = setInterval(tick, 1000);
    return () => clearInterval(handle);
  }, [since]);

  return elapsed;
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  // Hours only appear for a session left running overnight, which is itself a
  // useful hint that it needs finishing.
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatSessionDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function SessionDuration({ startedAt }: { startedAt: string }) {
  const elapsed = useElapsedSeconds(new Date(startedAt).getTime());

  return (
    <View style={styles.summaryItem}>
      <Ionicons name="time-outline" size={16} color={roman.gold} />
      <Text style={styles.summaryValue}>{formatDuration(elapsed)}</Text>
      <Text style={styles.summaryLabel}>duration</Text>
    </View>
  );
}

/** Real, fixed duration of a finished session — not a ticking counter. */
function FinishedDuration({ startedAt, endedAt }: { startedAt: string; endedAt: string }) {
  const seconds = Math.max(
    0,
    Math.floor((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000),
  );

  return (
    <View style={styles.summaryItem}>
      <Ionicons name="timer-outline" size={16} color={roman.gold} />
      <Text style={styles.summaryValue}>{formatDuration(seconds)}</Text>
      <Text style={styles.summaryLabel}>duration</Text>
    </View>
  );
}

/**
 * Rest countdown.
 *
 * Started by hand rather than automatically after each set: people talk,
 * change plates, or superset, and a clock that starts itself is usually
 * already wrong by the time they look at it.
 *
 * The length is a saved preference chosen from presets, so it is picked once
 * and not retyped every set.
 */
function RestTimer({
  seconds,
  onChangeSeconds,
}: {
  seconds: number;
  onChangeSeconds: (value: number) => void;
}) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const elapsed = useElapsedSeconds(startedAt);

  const running = startedAt !== null;
  const remaining = running ? Math.max(0, seconds - elapsed) : seconds;
  const finished = running && remaining === 0;

  const chooseDuration = () => {
    Alert.alert("Rest between sets", undefined, [
      ...REST_PRESETS.map((preset) => ({
        text: formatRest(preset),
        onPress: () => {
          onChangeSeconds(preset);
          setStartedAt(null);
        },
      })),
      { text: "Cancel", style: "cancel" as const },
    ]);
  };

  return (
    <View style={styles.rest}>
      <View style={styles.restInfo}>
        <Text style={styles.restTitle}>Rest timer</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Rest target ${formatRest(seconds)}. Change`}
          style={styles.restDuration}
          onPress={chooseDuration}
          hitSlop={6}
        >
          <Text style={styles.restTarget}>Target {formatRest(seconds)}</Text>
          <Ionicons name="chevron-down" size={14} color={roman.textMuted} />
        </Pressable>
      </View>

      <View style={styles.restCountdownBox}>
        <Text style={[styles.restCountdown, finished && styles.restDone]}>
          {formatRest(remaining)}
        </Text>
        {/* Finished is spelled out, not only coloured. */}
        {finished ? <Text style={styles.restOver}>Rest over</Text> : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={running ? "Stop rest timer" : "Start rest timer"}
        style={[styles.restButton, running && styles.restButtonActive]}
        onPress={() => setStartedAt(running ? null : Date.now())}
      >
        <Ionicons
          name={running ? "stop" : "play"}
          size={18}
          color={running ? roman.text : roman.background}
        />
      </Pressable>
    </View>
  );
}

/**
 * The workout's name, edited in place.
 *
 * Saved on blur rather than per keystroke: a request per character would be
 * wasteful, and there is no meaningful moment to autosave mid-word.
 *
 * Stays mounted while a set save is running (`editable` goes false) so a draft
 * is not thrown away by the swap.
 */
function TitleField({
  value,
  onSave,
  editable,
}: {
  value: string | null;
  onSave: (title: string | null) => void;
  editable: boolean;
}) {
  const [draft, setDraft] = useState(value ?? "");

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === (value ?? "")) return;
    onSave(trimmed === "" ? null : trimmed);
  };

  return (
    <View style={styles.titleWrap}>
      <TextInput
        accessibilityLabel="Workout name"
        style={styles.titleInput}
        value={draft}
        onChangeText={setDraft}
        onBlur={commit}
        onSubmitEditing={commit}
        editable={editable}
        placeholder="Name this workout"
        placeholderTextColor={roman.placeholder}
        selectionColor={roman.gold}
        returnKeyType="done"
        maxLength={200}
      />
      {/* The pencil is what says the name can be edited. */}
      {editable ? <Ionicons name="create-outline" size={16} color={roman.textMuted} /> : null}
    </View>
  );
}

/** Recorded effort is optional and never prefilled from a planned target. */
function RirField({ value, onChangeText, disabled }: {
  value: string;
  onChangeText: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <View style={styles.entryField}>
      <Text style={styles.fieldLabel}>RIR (optional)</Text>
      <TextInput
        accessibilityLabel="Recorded RIR, optional, 0 to 10"
        style={styles.fieldInput}
        value={value}
        onChangeText={onChangeText}
        editable={!disabled}
        keyboardType="number-pad"
        placeholder="—"
        placeholderTextColor={roman.placeholder}
        selectionColor={roman.gold}
      />
    </View>
  );
}

/** One logged set, corrected in place or deleted with a long press. */
function SetRow({
  set,
  unit,
  onSave,
  onDelete,
}: {
  set: LoggedSet;
  unit: WeightUnit;
  onSave: (setId: number, weightKg: number, reps: number, rir: number | null) => Promise<void>;
  onDelete: (setId: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [saving, setSaving] = useState(false);
  const [rir, setRir] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveInFlight = useRef(false);

  const startEditing = () => {
    setWeight(formatWeightValue(Number(set.weight_kg), unit));
    setReps(String(set.reps));
    setRir(set.rir === null ? "" : String(set.rir));
    setSaveError(null);
    setEditing(true);
  };

  const save = async () => {
    if (saveInFlight.current) return;
    // Editing reps/RIR must not round-trip an untouched, rounded display value.
    const parsedWeightKg = weight === formatWeightValue(Number(set.weight_kg), unit)
      ? Number(set.weight_kg) : parseWeightInput(weight, unit);
    const parsedReps = Number(reps);

    if (weight.trim() === "" || parsedWeightKg === null || !Number.isFinite(parsedWeightKg) || parsedWeightKg < 0) {
      setSaveError("Enter a valid weight of 0 or more.");
      return;
    }
    if (!Number.isInteger(parsedReps) || parsedReps <= 0) {
      setSaveError("Enter a whole number of reps greater than 0.");
      return;
    }

    let parsedRir: number | null;
    try {
      parsedRir = parseRirInput(rir);
    } catch (err) {
      setSaveError((err as Error).message);
      return;
    }
    saveInFlight.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(set.id, parsedWeightKg, parsedReps, parsedRir);
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not update the set");
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <View style={styles.setRowEditing}>
        {/* Spelled out as well as tinted, so the editing row is not marked by colour alone. */}
        <View style={styles.editingHeader}>
          <Ionicons name="create-outline" size={15} color={roman.gold} />
          <Text style={styles.editingLabel}>
            Editing set {set.is_warmup ? "(warm-up)" : set.set_number}
          </Text>
        </View>

        <View style={styles.entryRow}>
          <View style={styles.entryField}>
            <Text style={styles.fieldLabel}>Weight ({unit})</Text>
            <TextInput
              accessibilityLabel={`Weight in ${unit}`}
              style={styles.fieldInput}
              value={weight}
              onChangeText={setWeight}
              editable={!saving}
              keyboardType="decimal-pad"
              selectionColor={roman.gold}
              autoFocus
              selectTextOnFocus
            />
          </View>
          <View style={styles.entryField}>
            <Text style={styles.fieldLabel}>Reps</Text>
            <TextInput
              accessibilityLabel="Reps"
              style={styles.fieldInput}
              value={reps}
              onChangeText={setReps}
              editable={!saving}
              keyboardType="number-pad"
              selectionColor={roman.gold}
              selectTextOnFocus
              onSubmitEditing={() => void save()}
            />
          </View>
          <RirField value={rir} onChangeText={setRir} disabled={saving} />
        </View>

        {/* Delete lives here, not only behind a long-press: holding for half a
            second is easy to under-do, and a short press just opens this
            editor, leaving no visible way out. */}
        <View style={styles.editActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete set"
            onPress={() =>
              Alert.alert("Delete set?", undefined, [
                { text: "Cancel", style: "cancel" },
                { text: "Delete", style: "destructive", onPress: () => onDelete(set.id) },
              ])
            }
            style={styles.editAction}
            disabled={saving}
          >
            <Ionicons name="trash-outline" size={18} color={roman.danger} />
            <Text style={[styles.editActionText, styles.editActionDanger]}>Delete</Text>
          </Pressable>
          <View style={styles.editActionsRight}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel editing"
              onPress={() => setEditing(false)}
              style={styles.editAction}
              disabled={saving}
            >
              <Ionicons name="close" size={20} color={roman.textMuted} />
              <Text style={styles.editActionText}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save set"
              onPress={() => void save()}
              style={[styles.editAction, styles.editActionPrimary]}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator size="small" color={roman.background} />
              ) : (
                <Ionicons name="checkmark" size={20} color={roman.background} />
              )}
              <Text style={[styles.editActionText, styles.editActionPrimaryText]}>Save</Text>
            </Pressable>
          </View>
        </View>
        {saveError ? (
          <Text accessibilityRole="alert" style={styles.error}>{saveError}</Text>
        ) : null}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Set ${set.is_warmup ? "warm-up" : set.set_number}, ${formatWeight(Number(set.weight_kg), unit)} for ${set.reps} reps. Tap to edit`}
      accessibilityHint="Long press to delete"
      style={styles.setRow}
      onPress={startEditing}
      onLongPress={() =>
        Alert.alert("Delete set?", undefined, [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: () => onDelete(set.id) },
        ])
      }
    >
      <View style={[styles.setBadge, set.is_warmup && styles.warmupBadge]}>
        <Text style={[styles.setNumber, set.is_warmup && styles.warmupLabel]}>
          {set.is_warmup ? "W" : set.set_number}
        </Text>
      </View>
      <Text style={styles.setWeight}>{formatWeight(Number(set.weight_kg), unit)}</Text>
      <Text style={styles.setReps}>× {set.reps}</Text>
      <Text style={styles.setRir}>{formatRecordedRir(set.rir)}</Text>
    </Pressable>
  );
}

/** A logged set in a finished, read-only session — no tap-to-edit, no delete. */
function ReadOnlySetRow({ set, unit }: { set: LoggedSet; unit: WeightUnit }) {
  return (
    <View style={styles.setRow}>
      <View style={[styles.setBadge, set.is_warmup && styles.warmupBadge]}>
        <Text style={[styles.setNumber, set.is_warmup && styles.warmupLabel]}>
          {set.is_warmup ? "W" : set.set_number}
        </Text>
      </View>
      <Text style={styles.setWeight}>{formatWeight(Number(set.weight_kg), unit)}</Text>
      <Text style={styles.setReps}>× {set.reps}</Text>
      <Text style={styles.setRir}>{formatRecordedRir(set.rir)}</Text>
    </View>
  );
}

function SetForm({
  unit,
  onSubmit,
  busy,
  blocked = false,
  lastSet,
}: {
  unit: WeightUnit;
  onSubmit: (weightKg: number, reps: number, isWarmup: boolean, rir: number | null) => Promise<void>;
  busy: boolean;
  blocked?: boolean;
  lastSet: LoggedSet | undefined;
}) {
  // Prefilled from the previous set: on a working set you usually repeat the
  // weight, and retyping it every time is the main friction in logging.
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [isWarmup, setIsWarmup] = useState(false);
  const [rir, setRir] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submitInFlight = useRef(false);
  const disabled = busy || submitting || blocked;

  const weightHint = lastSet ? formatWeightValue(Number(lastSet.weight_kg), unit) : "0";
  const repsHint = lastSet ? String(lastSet.reps) : "8";

  const submit = async () => {
    if (busy || blocked || submitInFlight.current) return;
    // Reuse the recorded value, not the rounded hint displayed in kg/lb.
    const parsedWeightKg = weight === ""
      ? (lastSet ? Number(lastSet.weight_kg) : 0)
      : (weight.trim() === "" ? null : parseWeightInput(weight, unit));
    const parsedReps = Number(reps === "" ? repsHint : reps);

    if (parsedWeightKg === null || !Number.isFinite(parsedWeightKg) || parsedWeightKg < 0) {
      setSubmitError("Enter a valid weight of 0 or more.");
      return;
    }
    if (!Number.isInteger(parsedReps) || parsedReps <= 0) {
      setSubmitError("Enter a whole number of reps greater than 0.");
      return;
    }

    let parsedRir: number | null;
    try {
      parsedRir = parseRirInput(rir);
    } catch (err) {
      setSubmitError((err as Error).message);
      return;
    }
    submitInFlight.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(parsedWeightKg, parsedReps, isWarmup, parsedRir);
      setWeight("");
      setReps("");
      setRir("");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not save the set");
    } finally {
      submitInFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.entryPanel}>
      <View style={styles.entryRow}>
        <View style={styles.entryField}>
          <Text style={styles.fieldLabel}>Weight ({unit})</Text>
          <TextInput
            accessibilityLabel={`Weight in ${unit}`}
            style={styles.fieldInput}
            value={weight}
            onChangeText={setWeight}
            editable={!disabled}
            placeholder={weightHint}
            placeholderTextColor={roman.placeholder}
            selectionColor={roman.gold}
            keyboardType="decimal-pad"
            returnKeyType="next"
          />
        </View>

        <View style={styles.entryField}>
          <Text style={styles.fieldLabel}>Reps</Text>
          <TextInput
            accessibilityLabel="Reps"
            style={styles.fieldInput}
            value={reps}
            onChangeText={setReps}
            editable={!disabled}
            placeholder={repsHint}
            placeholderTextColor={roman.placeholder}
            selectionColor={roman.gold}
            keyboardType="number-pad"
            returnKeyType="done"
            onSubmitEditing={() => void submit()}
          />
        </View>

        <RirField value={rir} onChangeText={setRir} disabled={disabled} />
      </View>

      <View style={styles.entryActions}>
        {/* A box and the words, so the on/off state is not carried by colour alone. */}
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel="Warm-up set"
          accessibilityState={{ checked: isWarmup, disabled }}
          style={[styles.warmupToggle, isWarmup && styles.warmupActive]}
          onPress={() => setIsWarmup((value) => !value)}
          disabled={disabled}
        >
          <Ionicons
            name={isWarmup ? "checkbox" : "square-outline"}
            size={22}
            color={isWarmup ? roman.gold : roman.textMuted}
          />
          <Text style={[styles.warmupText, isWarmup && styles.warmupTextActive]}>Warm-up set</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Log set"
          style={styles.addSet}
          onPress={() => void submit()}
          disabled={disabled}
        >
          {busy || submitting ? (
            <ActivityIndicator color={roman.background} size="small" />
          ) : (
            <Ionicons name="add" size={20} color={roman.background} />
          )}
          <Text style={styles.addSetText}>Log set</Text>
        </Pressable>
      </View>
      {submitError ? (
        <Text accessibilityRole="alert" style={styles.error}>{submitError}</Text>
      ) : null}
    </View>
  );
}

/**
 * "Finish and save as template" sub-flow: name it, pick a program, done.
 *
 * Loads full program details (not just the summary list) up front, small
 * as that list is expected to be, so day_order for the new template — it
 * goes at the end of whichever program is picked — is available the
 * moment a program is selected rather than needing another round trip.
 */
function SaveAsTemplateModal({
  workout,
  onClose,
  onSaved,
}: {
  workout: WorkoutDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(workout.title ?? "");
  const [programs, setPrograms] = useState<ProgramDetail[]>([]);
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [loadingPrograms, setLoadingPrograms] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameInputRef = useRef<TextInput>(null);
  const saveInFlight = useRef(false);
  const [pendingSave, setPendingSave] = useState<TemplateSaveRequest | null>(null);
  const [saveRequestLoaded, setSaveRequestLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getTemplateSaveRequest(workout.id)
      .then((pending) => {
        if (!cancelled) {
          setPendingSave(pending);
          setSaveRequestLoaded(true);
          if (pending) {
            setName(pending.input.name);
            setSelectedProgramId(pending.programId);
          }
        }
        return programsApi.listPrograms().then((summaries) => ({ pending, summaries }));
      })
      .then(async ({ pending, summaries }) => ({
        pending, details: await Promise.all(summaries.map((p) => programsApi.getProgram(p.id))),
      }))
      .then(({ pending, details }) => {
        if (cancelled) return;
        setPrograms(details);
        setSelectedProgramId(pending?.programId ??
          details.find((p) => p.is_active)?.id ?? details[0]?.id ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load programs");
      })
      .finally(() => {
        if (!cancelled) setLoadingPrograms(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workout.id]);

  const handleSave = async () => {
    if (saveInFlight.current || !saveRequestLoaded) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name the template first.");
      return;
    }
    const program = programs.find((p) => p.id === selectedProgramId);
    if (!program && !pendingSave) return;

    saveInFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      const request = await prepareTemplateSaveRequest(workout.id, pendingSave ?? {
        programId: program!.id,
        input: {
          name: trimmed,
          day_order: program!.templates.length,
          exercises: buildTemplateExercisesFromWorkout(workout),
        },
      });
      setPendingSave(request);
      await sendTemplateSaveRequest(workout.id, request);

      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) setPendingSave(null);
      setError(err instanceof Error ? err.message : "Could not save the template");
      setSaving(false);
    } finally {
      saveInFlight.current = false;
    }
  };

  const close = () => {
    if (!saveInFlight.current) onClose();
  };

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={close}
      // autoFocus on the TextInput below is not reliable here: on Android in
      // particular, a TextInput can request focus before this Modal's native
      // window actually exists, so the keyboard opens but keystrokes still
      // go to whatever was focused underneath — it looks like typing is
      // silently ignored. Focusing from onShow, once the window is real,
      // fixes it on both platforms.
      onShow={() => nameInputRef.current?.focus()}
    >
      {/* flex: 1 (not just wrapping the sheet) is what lets "padding" behavior
          shrink the space available to the flex-end backdrop below, instead
          of just padding an already content-sized box — that's what actually
          pushes the sheet up above the keyboard rather than letting the
          keyboard cover it. */}
      <KeyboardAvoidingView
        style={styles.sheetAvoider}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={styles.sheetBackdrop} onPress={close}>
          {/* A Pressable with its own onPress, even a no-op, is what keeps a
              tap inside the sheet from also being read as a tap on the
              backdrop behind it. */}
          <Pressable style={styles.sheet} onPress={() => {}}>
            {/* maxHeight on `sheet` plus flexShrink here is what makes this
                actually scroll instead of just growing off the top of the
                screen: a program list long enough to exceed maxHeight forces
                the ScrollView to shrink to the remaining space, and content
                past that becomes scrollable rather than clipped or hidden
                behind the keyboard. */}
            <ScrollView
              style={styles.sheetScroll}
              contentContainerStyle={styles.sheetScrollContent}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.sheetTitle}>Save as template</Text>
              {pendingSave ? (
                <Text style={styles.sheetLabel}>
                  A previous save is ready to resume. Continue with the original name and program.
                </Text>
              ) : null}

              <TextInput
                ref={nameInputRef}
                style={styles.sheetInput}
                value={name}
                onChangeText={setName}
                placeholder="Template name"
                editable={!saving && !pendingSave && saveRequestLoaded}
                placeholderTextColor={roman.textMuted}
              />

              {error ? <Text style={styles.error}>{error}</Text> : null}

              {loadingPrograms ? (
                <ActivityIndicator color={roman.gold} style={styles.sheetLoading} />
              ) : programs.length === 0 && pendingSave ? (
                <Text style={styles.sheetLabel}>Continue to check your previous save.</Text>
              ) : programs.length === 0 ? (
                <View>
                  <Text style={styles.sheetEmpty}>You don&apos;t have a program yet.</Text>
                  <Pressable
                    style={styles.sheetCreateProgram}
                    onPress={() => {
                      onClose();
                      router.push("/programs");
                    }}
                  >
                    <Text style={styles.sheetCreateProgramText}>Create a program</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  <Text style={styles.sheetLabel}>Program</Text>
                  {programs.map((program) => (
                    <Pressable
                      key={program.id}
                      style={styles.sheetRow}
                      onPress={() => setSelectedProgramId(program.id)}
                      disabled={saving || !!pendingSave || !saveRequestLoaded}
                    >
                      <Text style={styles.sheetRowText}>{program.name}</Text>
                      {selectedProgramId === program.id ? (
                        <Ionicons name="checkmark" size={18} color={roman.gold} />
                      ) : null}
                    </Pressable>
                  ))}
                </>
              )}
            </ScrollView>

            {/* Outside the ScrollView, not the last thing scrolled to: these
                stay visible and reachable no matter how long the program
                list is or whether the keyboard is open. */}
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalButton, styles.modalButtonSecondary]}
                onPress={close}
                disabled={saving}
              >
                <Text style={styles.modalButtonSecondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, saving && styles.modalButtonDisabled]}
                onPress={() => void handleSave()}
                disabled={saving || !saveRequestLoaded ||
                  (!pendingSave && (loadingPrograms || programs.length === 0))}
              >
                {saving ? (
                  <ActivityIndicator color={roman.background} />
                ) : (
                  <Text style={styles.modalButtonText}>{pendingSave ? "Continue save" : "Save"}</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function ActiveWorkoutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const unit: WeightUnit = user?.weight_unit ?? "kg";

  const [workout, setWorkout] = useState<WorkoutDetail | null>(null);
  const [pending, setPending] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyExercise, setBusyExercise] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restSeconds, setRestSecondsState] = useState(DEFAULT_REST_SECONDS);
  const { targets, description: planDescription } = useMemo(() => getStartingPlan(workout), [workout]);
  const [saveAsTemplateVisible, setSaveAsTemplateVisible] = useState(false);
  // A past session opens read-only by default (see isFinished/readOnly
  // below); this is the escape hatch that lets it become editable again.
  const [editing, setEditing] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const finishInFlight = useRef(false);
  const [pendingSetRequest, setPendingSetRequest] = useState<SetSaveRequest | null>(null);
  const pendingSetRef = useRef<SetSaveRequest | null>(null);
  const setSaveInFlight = useRef(false);
  const [setFormVersions, setSetFormVersions] = useState<Record<string, number>>({});
  const [loadAttempt, setLoadAttempt] = useState(0);
  const userId = user?.id;
  const viewGeneration = useRef(0);

  useEffect(() => {
    const generation = ++viewGeneration.current;
    return () => { viewGeneration.current = generation + 1; };
  }, [id, userId]);

  useEffect(() => {
    let cancelled = false;
    void getRestSeconds().then((value) => {
      if (!cancelled) setRestSecondsState(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChangeRest = useCallback((value: number) => {
    setRestSecondsState(value);
    void setRestSeconds(value);
  }, []);

  const { openPicker } = usePickedExercise((exercise) => {
    setPending((current) =>
      current.some((item) => item.id === exercise.id) ? current : [...current, exercise],
    );
  });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      workoutsApi.getWorkout(id),
      userId ? getSetSaveRequest(userId, id) : Promise.reject(new Error("Sign in to load this workout.")),
    ])
      .then(([data, savedRequest]) => {
        if (!cancelled) {
          setSaveInFlight.current = false;
          finishInFlight.current = false;
          setFinishing(false);
          setBusyExercise(null);
          pendingSetRef.current = savedRequest;
          setPendingSetRequest(savedRequest);
          setWorkout(data);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load workout");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, userId, loadAttempt]);

  // Include saved plan exercises even before their first set is logged.
  // Recorded exercises keep logging order; remaining targets keep plan order.
  const blocks = useMemo(() => {
    if (!workout) return [];
    const targetExtras = targets.map((t) => ({ id: t.exercise_id, name: t.exercise_name }));
    const unsent = pendingSetRequest ? [{ id: pendingSetRequest.input.exercise_id, name: pendingSetRequest.exerciseName }] : [];
    return groupByExercise(workout.sets, [...targetExtras, ...pending, ...unsent]);
  }, [workout, pending, targets, pendingSetRequest]);

  const handleSaveTitle = useCallback(
    async (title: string | null) => {
      if (setSaveInFlight.current || pendingSetRef.current) return;
      try {
        setWorkout(await workoutsApi.updateWorkout(id, { title }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save the name");
      }
    },
    [id],
  );

  const handleSetSave = useCallback(
    async (proposed?: { exerciseId: string; exerciseName: string; weight: number; reps: number; isWarmup: boolean; rir: number | null }) => {
      if (!userId || setSaveInFlight.current || finishInFlight.current || finishing) throw new Error("Please wait for the current save.");
      if (proposed && pendingSetRef.current) throw new Error("Resolve the pending set first.");
      setSaveInFlight.current = true;
      const generation = viewGeneration.current;
      setBusyExercise(proposed?.exerciseId ?? pendingSetRef.current?.input.exercise_id ?? null);
      setError(null);
      try {
        const request = proposed ? await prepareSetSaveRequest(userId, id, proposed.exerciseName, {
          exercise_id: proposed.exerciseId, weight_kg: proposed.weight, reps: proposed.reps,
          is_warmup: proposed.isWarmup, rir: proposed.rir,
        }) : pendingSetRef.current;
        if (!request) throw new Error("No pending set to retry.");
        if (generation !== viewGeneration.current) return;
        pendingSetRef.current = request;
        setPendingSetRequest(request);
        const updated = await sendSetSaveRequest(userId, id, request);
        if (generation !== viewGeneration.current) return;
        setWorkout(updated);
        pendingSetRef.current = null;
        setPendingSetRequest(null);
        // Also clear the original form after a successful retry from the banner.
        // A direct save lets SetForm clear itself and retain its warm-up toggle.
        if (!proposed) {
          setSetFormVersions(versions => ({
            ...versions, [request.input.exercise_id]: (versions[request.input.exercise_id] ?? 0) + 1,
          }));
        }
      } catch (err) {
        if (generation !== viewGeneration.current) throw err;
        // A validation rejection may have cleared the receipt. Storage errors
        // must instead keep logging blocked until the saved intent can be read.
        try {
          const saved = await getSetSaveRequest(userId, id);
          if (generation !== viewGeneration.current) return;
          pendingSetRef.current = saved;
          setPendingSetRequest(saved);
        } catch {
          if (generation !== viewGeneration.current) return;
          setWorkout(null);
        }
        setError(err instanceof Error ? err.message : "Could not save the set");
        throw err;
      } finally {
        if (generation === viewGeneration.current) {
          setSaveInFlight.current = false;
          setBusyExercise(null);
        }
      }
    },
    [id, userId, finishing],
  );

  const handleEditSet = useCallback(
    async (setId: number, weight: number, reps: number, rir: number | null) => {
      if (setSaveInFlight.current || pendingSetRef.current) throw new Error("Resolve the pending set first.");
      setError(null);
      try {
        setWorkout(await workoutsApi.updateSet(id, setId, { weight_kg: weight, reps, rir }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not update the set");
        throw err;
      }
    },
    [id],
  );

  const handleDeleteSet = useCallback(
    async (setId: number) => {
      if (setSaveInFlight.current || pendingSetRef.current) return;
      try {
        setWorkout(await workoutsApi.deleteSet(id, setId));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not delete the set");
      }
    },
    [id],
  );

  const handleFinish = useCallback(async () => {
    if (finishInFlight.current || setSaveInFlight.current || pendingSetRef.current) return;
    // Guards against a double-tap firing this twice while the request is in
    // flight — finish is idempotent server-side, but there is no reason to
    // rely on that when a disabled button is just as easy.
    finishInFlight.current = true;
    setFinishing(true);
    setError(null);
    // Write to the server first: if it fails, the device keeps its active
    // workout pointer and the session is not lost, just not marked done yet.
    try {
      await workoutsApi.finishWorkout(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not finish the workout");
      finishInFlight.current = false;
      setFinishing(false);
      return;
    }
    // Server completion is authoritative; local cleanup must not trap us here.
    await clearActiveWorkout().catch(() => undefined);
    await clearTemplateSaveRequest(id).catch(() => undefined);
    router.dismissAll();
    router.replace("/");
  }, [id, router]);

  const confirmFinish = () => {
    const empty = (workout?.sets.length ?? 0) === 0;
    Alert.alert(
      "Finish workout?",
      empty
        ? "This workout has no sets. It will stay in your history as an empty session."
        : undefined,
      [
        { text: "Keep going", style: "cancel" },
        { text: "Finish", style: "default", onPress: () => void handleFinish() },
        { text: "Finish and save as template", onPress: () => setSaveAsTemplateVisible(true) },
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={roman.gold} />
      </View>
    );
  }

  if (!workout) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text accessibilityRole="alert" style={styles.error}>{error ?? "Workout not found"}</Text>
        <Pressable
          accessibilityRole="button"
          style={styles.centeredAction}
          onPress={() => { setLoading(true); setError(null); setLoadAttempt(value => value + 1); }}
        >
          <Text style={styles.finishText}>Try again</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.centeredAction}
          onPress={() => router.back()}
        >
          <Text style={styles.backText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  // A finished session opens read-only unless the user explicitly asks to
  // edit it. An in-progress one is always editable — isFinished is false, so
  // readOnly is false regardless of the (unused, in that case) editing flag.
  const isFinished = workout.finished_at !== null;
  const readOnly = isFinished && !editing;
  const setSaveBlocked = pendingSetRequest !== null || busyExercise !== null;

  return (
    <>
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* The screen draws its own top bar (back, name, finish) below, so the
            native header is off: both together would show the name twice. */}
        <Stack.Screen options={{ headerShown: false }} />

        <View style={[styles.topBar, { paddingTop: insets.top }]}>
          <View style={styles.topBarRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              style={styles.topBarBack}
              onPress={() => router.back()}
            >
              <Ionicons name="chevron-back" size={24} color={roman.text} />
            </Pressable>

            <View style={styles.topBarTitle}>
              {readOnly ? (
                <Text accessibilityRole="header" numberOfLines={2} style={styles.titleReadOnly}>
                  {workout.title ?? "Workout"}
                </Text>
              ) : (
                <TitleField
                  key={workout.title ?? ""}
                  value={workout.title}
                  editable={!setSaveBlocked}
                  onSave={(title) => void handleSaveTitle(title)}
                />
              )}
            </View>

            {readOnly ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit workout"
                style={styles.topBarGhost}
                onPress={() => setEditing(true)}
              >
                <Text style={styles.topBarGhostText}>Edit</Text>
              </Pressable>
            ) : isFinished ? (
              // Editing an already-finished workout: exit just leaves edit
              // mode, it must not call finish again.
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Done editing"
                style={styles.topBarGhost}
                onPress={() => setEditing(false)}
              >
                <Text style={styles.topBarGhostText}>Done</Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Finish workout"
                accessibilityState={{ busy: finishing, disabled: finishing || setSaveBlocked }}
                style={[styles.finishButton, (finishing || setSaveBlocked) && styles.finishButtonDisabled]}
                onPress={confirmFinish}
                disabled={finishing || setSaveBlocked}
              >
                {finishing ? (
                  <ActivityIndicator size="small" color={roman.background} />
                ) : (
                  <Text style={styles.finishText}>Finish</Text>
                )}
              </Pressable>
            )}
          </View>
        </View>

        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) + 32 }]}
          keyboardShouldPersistTaps="handled"
        >
          {readOnly ? <Text style={styles.sessionDate}>{formatSessionDate(workout.performed_at)}</Text> : null}
          {planDescription ? <Text style={styles.sessionDate}>{planDescription}</Text> : null}

          <View style={styles.summary}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{workout.total_sets}</Text>
              <Text style={styles.summaryLabel}>working sets</Text>
            </View>
            <View style={styles.summaryDivider} />
            {isFinished && workout.finished_at ? (
              workout.finished_automatically === false ? (
                <FinishedDuration startedAt={workout.performed_at} endedAt={workout.finished_at} />
              ) : (
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>—</Text>
                  <Text style={styles.summaryLabel}>
                    {workout.finished_automatically ? "auto-closed" : "duration unavailable"}
                  </Text>
                </View>
              )
            ) : (
              <SessionDuration startedAt={workout.performed_at} />
            )}
          </View>

          {readOnly ? null : <RestTimer seconds={restSeconds} onChangeSeconds={handleChangeRest} />}

          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          {pendingSetRequest ? (
            <View style={styles.planComparison}>
              <Text style={styles.blockTitle}>Set awaiting confirmation</Text>
              <Text style={styles.planDetail}>
                {pendingSetRequest.exerciseName}: {formatWeight(pendingSetRequest.input.weight_kg, unit)} × {pendingSetRequest.input.reps}
                {formatRecordedRir(pendingSetRequest.input.rir ?? null)}
                {pendingSetRequest.input.is_warmup ? " · Warm-up" : " · Working set"}
              </Text>
              <Text style={styles.planDetail}>
                This set may already be saved. Retry to confirm it before adding another set or finishing.
              </Text>
              <Pressable disabled={busyExercise !== null}
                onPress={() => { void handleSetSave().catch(() => undefined); }} style={styles.addExercise}>
                <Text style={styles.addExerciseText}>{busyExercise !== null ? "Confirming…" : "Retry pending set"}</Text>
              </Pressable>
            </View>
          ) : null}

          {blocks.map((block) => {
            return (
              <View key={block.exerciseId} style={styles.block}>
                <Text style={styles.blockTitle}>{block.name}</Text>

                <PreviousExercise
                  key={`${workout.id}:${workout.performed_at}:${block.exerciseId}`}
                  workoutId={workout.id} exerciseId={block.exerciseId} exerciseName={block.name} unit={unit}
                  currentSets={block.sets}
                />

                {readOnly || setSaveBlocked
                  ? block.sets.map((set) => <ReadOnlySetRow key={set.id} set={set} unit={unit} />)
                  : block.sets.map((set) => (
                      <SetRow
                        key={set.id}
                        set={set}
                        unit={unit}
                        onSave={handleEditSet}
                        onDelete={(setId) => void handleDeleteSet(setId)}
                      />
                    ))}

                {readOnly ? null : (
                  <SetForm
                    key={setFormVersions[block.exerciseId] ?? 0}
                    unit={unit}
                    busy={busyExercise !== null || finishing}
                    blocked={pendingSetRequest !== null}
                    lastSet={block.sets[block.sets.length - 1]}
                    onSubmit={(weightKg, reps, isWarmup, rir) =>
                      handleSetSave({ exerciseId: block.exerciseId, exerciseName: block.name, weight: weightKg, reps, isWarmup, rir })
                    }
                  />
                )}
              </View>
            );
          })}

          {readOnly ? null : (
            <Pressable accessibilityRole="button" style={styles.addExercise} onPress={openPicker}>
              <Ionicons name="add" size={20} color={roman.gold} />
              <Text style={styles.addExerciseText}>Add exercise</Text>
            </Pressable>
          )}

          {readOnly ? null : blocks.length === 0 ? (
            <Text style={styles.hint}>Add an exercise to start logging sets.</Text>
          ) : (
            <Text style={styles.hint}>Tap a set to correct or delete it.</Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {saveAsTemplateVisible && <SaveAsTemplateModal
        workout={workout}
        onClose={() => setSaveAsTemplateVisible(false)}
        onSaved={() => {
          setSaveAsTemplateVisible(false);
          void handleFinish();
        }}
      />}
    </>
  );
}

const MIN_TOUCH = 44;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: roman.background },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: roman.background,
    padding: 24,
  },
  centeredAction: { minHeight: MIN_TOUCH, justifyContent: "center", paddingHorizontal: 16 },
  content: { paddingHorizontal: 14, paddingTop: 12 },

  topBar: {
    backgroundColor: roman.background,
    borderBottomColor: roman.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
  },
  topBarRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 4 },
  topBarBack: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    alignItems: "center",
    justifyContent: "center",
  },
  topBarTitle: { flex: 1, minWidth: 0, alignItems: "center", justifyContent: "center" },
  topBarGhost: {
    minWidth: MIN_TOUCH,
    minHeight: MIN_TOUCH,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  topBarGhostText: { color: roman.goldLight, fontFamily: romanFont.semibold, fontSize: 15 },
  finishButton: {
    minWidth: 76,
    minHeight: MIN_TOUCH,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: roman.gold,
    borderRadius: 10,
    paddingHorizontal: 16,
  },
  finishButtonDisabled: { opacity: 0.5 },
  finishText: {
    color: roman.background,
    fontFamily: romanFont.semibold,
    fontSize: 13,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  backText: { color: roman.textMuted, fontFamily: romanFont.medium, fontSize: 15 },

  titleWrap: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "100%" },
  titleInput: {
    flexShrink: 1,
    minHeight: MIN_TOUCH,
    color: roman.text,
    fontFamily: romanFont.title,
    fontSize: 18,
    letterSpacing: 0.5,
    textAlign: "center",
    paddingVertical: 8,
  },
  titleReadOnly: {
    color: roman.text,
    fontFamily: romanFont.title,
    fontSize: 18,
    letterSpacing: 0.5,
    textAlign: "center",
  },
  sessionDate: {
    color: roman.textMuted,
    fontFamily: romanFont.regular,
    fontSize: 13,
    marginBottom: 8,
  },

  summary: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  summaryItem: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  summaryDivider: { width: 1, alignSelf: "stretch", minHeight: 16, backgroundColor: roman.border },
  summaryValue: {
    color: roman.text,
    fontFamily: romanFont.semibold,
    fontSize: 16,
    fontVariant: ["tabular-nums"],
  },
  summaryLabel: { color: roman.textMuted, fontFamily: romanFont.regular, fontSize: 12, flexShrink: 1 },

  rest: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    backgroundColor: roman.surface,
    borderColor: roman.gold,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  restInfo: { flexShrink: 1 },
  restTitle: {
    color: roman.gold,
    fontFamily: romanFont.semibold,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  restDuration: {
    minHeight: MIN_TOUCH,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  restTarget: { color: roman.textMuted, fontFamily: romanFont.medium, fontSize: 13 },
  restCountdownBox: { alignItems: "center" },
  restCountdown: {
    color: roman.text,
    fontFamily: romanFont.semibold,
    fontSize: 28,
    fontVariant: ["tabular-nums"],
  },
  restDone: { color: roman.goldLight },
  restOver: { color: roman.goldLight, fontFamily: romanFont.medium, fontSize: 11 },
  restButton: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: 10,
    backgroundColor: roman.gold,
    alignItems: "center",
    justifyContent: "center",
  },
  restButtonActive: { backgroundColor: roman.surfaceRaised, borderColor: roman.border, borderWidth: 1 },
  error: { color: roman.danger, fontFamily: romanFont.medium, fontSize: 13, marginTop: 8, marginBottom: 8 },

  block: {
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  blockTitle: { color: roman.text, fontFamily: romanFont.semibold, fontSize: 17, marginBottom: 2 },
  planComparison: {
    backgroundColor: roman.surface,
    borderColor: roman.gold,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    gap: 4,
  },
  planDetail: { color: roman.textMuted, fontFamily: romanFont.regular, fontSize: 13, lineHeight: 19 },

  setRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
    borderBottomColor: roman.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  setBadge: {
    width: 30,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  warmupBadge: { borderColor: roman.border, borderWidth: 1 },
  setNumber: { color: roman.textMuted, fontFamily: romanFont.semibold, fontSize: 14 },
  warmupLabel: { color: roman.goldLight },
  setWeight: {
    width: 92,
    textAlign: "right",
    color: roman.text,
    fontFamily: romanFont.semibold,
    fontSize: 16,
    fontVariant: ["tabular-nums"],
  },
  setReps: {
    width: 56,
    color: roman.text,
    fontFamily: romanFont.semibold,
    fontSize: 16,
    fontVariant: ["tabular-nums"],
  },
  setRir: {
    flex: 1,
    color: roman.textMuted,
    fontFamily: romanFont.regular,
    fontSize: 14,
    fontVariant: ["tabular-nums"],
  },

  // The set being corrected: boxed and tinted, and named in words by the label.
  setRowEditing: {
    backgroundColor: roman.goldTint,
    borderColor: roman.gold,
    borderWidth: 1,
    borderLeftWidth: 3,
    borderRadius: 10,
    padding: 12,
    marginVertical: 6,
  },
  editingHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  editingLabel: {
    color: roman.goldLight,
    fontFamily: romanFont.semibold,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  editActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 10,
  },
  editActionsRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  editAction: {
    minHeight: MIN_TOUCH,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  editActionPrimary: { backgroundColor: roman.gold },
  editActionText: { color: roman.textMuted, fontFamily: romanFont.semibold, fontSize: 13 },
  editActionDanger: { color: roman.danger },
  editActionPrimaryText: { color: roman.background },

  entryPanel: {
    backgroundColor: roman.background,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
  },
  entryRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  entryField: { flex: 1, minWidth: 0 },
  fieldLabel: {
    color: roman.textMuted,
    fontFamily: romanFont.medium,
    fontSize: 11,
    marginBottom: 4,
  },
  fieldInput: {
    minHeight: 48,
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 10,
    color: roman.text,
    fontFamily: romanFont.semibold,
    fontSize: 18,
    fontVariant: ["tabular-nums"],
    textAlign: "center",
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  entryActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 10,
  },
  warmupToggle: {
    minHeight: MIN_TOUCH,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingRight: 8,
  },
  warmupActive: {},
  warmupText: { color: roman.textMuted, fontFamily: romanFont.medium, fontSize: 13 },
  warmupTextActive: { color: roman.goldLight },
  addSet: {
    minHeight: MIN_TOUCH,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: roman.gold,
    borderRadius: 10,
    paddingHorizontal: 18,
  },
  addSetText: {
    color: roman.background,
    fontFamily: romanFont.semibold,
    fontSize: 13,
    letterSpacing: 1,
    textTransform: "uppercase",
  },

  addExercise: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderColor: roman.gold,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  addExerciseText: {
    color: roman.goldLight,
    fontFamily: romanFont.semibold,
    fontSize: 14,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  hint: {
    color: roman.textMuted,
    fontFamily: romanFont.regular,
    fontSize: 13,
    textAlign: "center",
    marginTop: 14,
  },

  sheetAvoider: { flex: 1 },
  sheetBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.6)",
  },
  sheet: {
    maxHeight: "80%",
    backgroundColor: roman.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopColor: roman.gold,
    borderTopWidth: 1,
    paddingTop: 24,
  },
  sheetScroll: { flexShrink: 1 },
  sheetScrollContent: { paddingHorizontal: 24, paddingBottom: 8 },
  sheetTitle: { color: roman.text, fontFamily: romanFont.title, fontSize: 20, marginBottom: 16 },
  sheetInput: {
    minHeight: 48,
    backgroundColor: roman.background,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 10,
    color: roman.text,
    fontFamily: romanFont.regular,
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 16,
  },
  sheetLabel: {
    color: roman.textMuted,
    fontFamily: romanFont.semibold,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  sheetRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 10,
    borderBottomColor: roman.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetRowText: { flex: 1, color: roman.text, fontFamily: romanFont.medium, fontSize: 16 },
  sheetEmpty: { color: roman.textMuted, fontFamily: romanFont.regular, marginBottom: 8 },
  sheetLoading: { marginVertical: 16 },
  sheetCreateProgram: {
    minHeight: MIN_TOUCH,
    justifyContent: "center",
    backgroundColor: roman.background,
    borderColor: roman.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    alignItems: "center",
  },
  sheetCreateProgramText: { color: roman.goldLight, fontFamily: romanFont.semibold, fontSize: 14 },

  modalActions: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 32,
  },
  modalButton: {
    flex: 1,
    minHeight: 52,
    justifyContent: "center",
    backgroundColor: roman.gold,
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
  },
  modalButtonSecondary: {
    backgroundColor: roman.surface,
    borderColor: roman.border,
    borderWidth: 1,
  },
  modalButtonDisabled: { opacity: 0.7 },
  modalButtonText: { color: roman.background, fontFamily: romanFont.semibold, fontSize: 15 },
  modalButtonSecondaryText: { color: roman.goldLight, fontFamily: romanFont.semibold, fontSize: 15 },
});
