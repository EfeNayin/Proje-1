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

import * as programsApi from "../../../src/api/programs";
import type {
  ProgramDetail,
  TemplateExerciseInput,
  TemplateExerciseTarget,
} from "../../../src/api/programs";
import * as workoutsApi from "../../../src/api/workouts";
import type { LoggedSet, WorkoutDetail } from "../../../src/api/workouts";
import { colors, radius, spacing } from "../../../src/theme";
import { clearActiveWorkout } from "../../../src/workout/activeWorkout";
import {
  DEFAULT_REST_SECONDS,
  formatRest,
  getRestSeconds,
  REST_PRESETS,
  setRestSeconds,
} from "../../../src/workout/restPreference";
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

/** "4×6-8 @RIR2" — the template's goal for one exercise, not what was logged. */
function formatTarget(target: TemplateExerciseTarget): string {
  const { target_reps_min: min, target_reps_max: max } = target;
  let reps: string;
  if (min !== null && max !== null) reps = min === max ? String(min) : `${min}-${max}`;
  else if (min !== null) reps = `${min}+`;
  else if (max !== null) reps = `≤${max}`;
  else reps = "?";

  const rir = target.target_rir !== null ? ` @RIR${target.target_rir}` : "";
  return `${target.target_sets}×${reps}${rir}`;
}

/**
 * Turns what was actually logged into template targets — a plan, not a
 * record of this specific session. Warmups are excluded (target_sets counts
 * working sets only), target_rir is always null (nothing logged implies an
 * effort target; the user sets that later in the template editor), and
 * exercise order follows the order sets were first logged in, same as the
 * on-screen blocks.
 */
function buildTemplateExercisesFromWorkout(workout: WorkoutDetail): TemplateExerciseInput[] {
  const order: string[] = [];
  const repsByExercise = new Map<string, number[]>();

  for (const set of workout.sets) {
    if (set.is_warmup) continue;
    if (!repsByExercise.has(set.exercise_id)) {
      repsByExercise.set(set.exercise_id, []);
      order.push(set.exercise_id);
    }
    repsByExercise.get(set.exercise_id)?.push(set.reps);
  }

  return order.map((exerciseId) => {
    const reps = repsByExercise.get(exerciseId) ?? [];
    return {
      exercise_id: exerciseId,
      target_sets: reps.length,
      target_reps_min: Math.min(...reps),
      target_reps_max: Math.max(...reps),
      target_rir: null,
    };
  });
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
    <View>
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
    <View>
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
      <Pressable style={styles.restDuration} onPress={chooseDuration} hitSlop={6}>
        <Ionicons name="time-outline" size={16} color={colors.textMuted} />
        <Text style={styles.restLabel}>Rest</Text>
        <Text style={styles.restValue}>{formatRest(seconds)}</Text>
        <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
      </Pressable>

      <Text style={[styles.restCountdown, finished && styles.restDone]}>
        {formatRest(remaining)}
      </Text>

      <Pressable
        style={[styles.restButton, running && styles.restButtonActive]}
        onPress={() => setStartedAt(running ? null : Date.now())}
      >
        <Ionicons
          name={running ? "stop" : "play"}
          size={16}
          color={running ? colors.text : colors.accentText}
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
 */
function TitleField({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (title: string | null) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");

  // Keep in step when the server sends a different title back.
  useEffect(() => setDraft(value ?? ""), [value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === (value ?? "")) return;
    onSave(trimmed === "" ? null : trimmed);
  };

  return (
    <TextInput
      style={styles.titleInput}
      value={draft}
      onChangeText={setDraft}
      onBlur={commit}
      onSubmitEditing={commit}
      placeholder="Name this workout"
      placeholderTextColor={colors.textMuted}
      returnKeyType="done"
      maxLength={200}
    />
  );
}

/**
 * One logged set. Tap to correct it, long-press to delete.
 *
 * Editing in place rather than in a modal: fixing a mistyped rep count is a
 * two-second job and should not involve a screen transition.
 */
function SetRow({
  set,
  onSave,
  onDelete,
}: {
  set: LoggedSet;
  onSave: (setId: number, weight: number, reps: number) => Promise<void>;
  onDelete: (setId: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [saving, setSaving] = useState(false);

  const startEditing = () => {
    setWeight(String(Number(set.weight_kg)));
    setReps(String(set.reps));
    setEditing(true);
  };

  const save = async () => {
    const parsedWeight = Number(weight.replace(",", "."));
    const parsedReps = Number(reps);

    if (!Number.isFinite(parsedWeight) || parsedWeight < 0) return;
    if (!Number.isInteger(parsedReps) || parsedReps <= 0) return;

    setSaving(true);
    try {
      await onSave(set.id, parsedWeight, parsedReps);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <View style={styles.setRowEditing}>
        <Text style={[styles.setNumber, set.is_warmup && styles.warmupLabel]}>
          {set.is_warmup ? "W" : set.set_number}
        </Text>

        <TextInput
          style={styles.editInput}
          value={weight}
          onChangeText={setWeight}
          keyboardType="decimal-pad"
          autoFocus
          selectTextOnFocus
        />
        <Text style={styles.editUnit}>kg ×</Text>
        <TextInput
          style={styles.editInput}
          value={reps}
          onChangeText={setReps}
          keyboardType="number-pad"
          selectTextOnFocus
          onSubmitEditing={() => void save()}
        />

        {/* Delete lives here, not only behind a long-press: holding for half a
            second is easy to under-do, and a short press just opens this
            editor, leaving no visible way out. */}
        <Pressable
          onPress={() =>
            Alert.alert("Delete set?", undefined, [
              { text: "Cancel", style: "cancel" },
              { text: "Delete", style: "destructive", onPress: () => onDelete(set.id) },
            ])
          }
          hitSlop={8}
          style={styles.editAction}
        >
          <Ionicons name="trash-outline" size={19} color={colors.danger} />
        </Pressable>
        <Pressable onPress={() => setEditing(false)} hitSlop={8} style={styles.editAction}>
          <Ionicons name="close" size={20} color={colors.textMuted} />
        </Pressable>
        <Pressable onPress={() => void save()} hitSlop={8} style={styles.editAction} disabled={saving}>
          {saving ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Ionicons name="checkmark" size={20} color={colors.accent} />
          )}
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable
      style={styles.setRow}
      onPress={startEditing}
      onLongPress={() =>
        Alert.alert("Delete set?", undefined, [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: () => onDelete(set.id) },
        ])
      }
    >
      <Text style={[styles.setNumber, set.is_warmup && styles.warmupLabel]}>
        {set.is_warmup ? "W" : set.set_number}
      </Text>
      <Text style={styles.setDetail}>
        {Number(set.weight_kg)} kg × {set.reps}
      </Text>
    </Pressable>
  );
}

/** A logged set in a finished, read-only session — no tap-to-edit, no delete. */
function ReadOnlySetRow({ set }: { set: LoggedSet }) {
  return (
    <View style={styles.setRow}>
      <Text style={[styles.setNumber, set.is_warmup && styles.warmupLabel]}>
        {set.is_warmup ? "W" : set.set_number}
      </Text>
      <Text style={styles.setDetail}>
        {Number(set.weight_kg)} kg × {set.reps}
      </Text>
    </View>
  );
}

function SetForm({
  onSubmit,
  busy,
  lastSet,
}: {
  onSubmit: (weight: number, reps: number, isWarmup: boolean) => void;
  busy: boolean;
  lastSet: LoggedSet | undefined;
}) {
  // Prefilled from the previous set: on a working set you usually repeat the
  // weight, and retyping it every time is the main friction in logging.
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [isWarmup, setIsWarmup] = useState(false);

  const weightHint = lastSet ? String(Number(lastSet.weight_kg)) : "0";
  const repsHint = lastSet ? String(lastSet.reps) : "8";

  const submit = () => {
    const parsedWeight = Number(weight === "" ? weightHint : weight.replace(",", "."));
    const parsedReps = Number(reps === "" ? repsHint : reps);

    if (!Number.isFinite(parsedWeight) || parsedWeight < 0) return;
    if (!Number.isInteger(parsedReps) || parsedReps <= 0) return;

    onSubmit(parsedWeight, parsedReps, isWarmup);
    setWeight("");
    setReps("");
  };

  return (
    <View style={styles.form}>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>kg</Text>
        <TextInput
          style={styles.fieldInput}
          value={weight}
          onChangeText={setWeight}
          placeholder={weightHint}
          placeholderTextColor={colors.textMuted}
          keyboardType="decimal-pad"
          returnKeyType="next"
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>reps</Text>
        <TextInput
          style={styles.fieldInput}
          value={reps}
          onChangeText={setReps}
          placeholder={repsHint}
          placeholderTextColor={colors.textMuted}
          keyboardType="number-pad"
          returnKeyType="done"
          onSubmitEditing={submit}
        />
      </View>

      <Pressable
        style={[styles.warmupToggle, isWarmup && styles.warmupActive]}
        onPress={() => setIsWarmup((value) => !value)}
      >
        <Text style={[styles.warmupText, isWarmup && styles.warmupTextActive]}>W</Text>
      </Pressable>

      <Pressable style={styles.addSet} onPress={submit} disabled={busy}>
        {busy ? (
          <ActivityIndicator color={colors.accentText} size="small" />
        ) : (
          <Ionicons name="add" size={22} color={colors.accentText} />
        )}
      </Pressable>
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
  visible,
  workout,
  onClose,
  onSaved,
}: {
  visible: boolean;
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

  useEffect(() => {
    if (!visible) return;
    setName(workout.title ?? "");
    setError(null);

    let cancelled = false;
    setLoadingPrograms(true);
    programsApi
      .listPrograms()
      .then((summaries) => Promise.all(summaries.map((p) => programsApi.getProgram(p.id))))
      .then((details) => {
        if (cancelled) return;
        setPrograms(details);
        setSelectedProgramId(details.find((p) => p.is_active)?.id ?? details[0]?.id ?? null);
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
  }, [visible, workout.title]);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name the template first.");
      return;
    }
    const program = programs.find((p) => p.id === selectedProgramId);
    if (!program) return;

    setSaving(true);
    setError(null);
    try {
      const template = await programsApi.createTemplate(program.id, {
        name: trimmed,
        day_order: program.templates.length,
      });

      const exercises = buildTemplateExercisesFromWorkout(workout);
      if (exercises.length > 0) {
        await programsApi.setTemplateExercises(template.id, exercises);
      }

      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the template");
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
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
        <Pressable style={styles.sheetBackdrop} onPress={onClose}>
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

              <TextInput
                ref={nameInputRef}
                style={styles.sheetInput}
                value={name}
                onChangeText={setName}
                placeholder="Template name"
                placeholderTextColor={colors.textMuted}
              />

              {error ? <Text style={styles.error}>{error}</Text> : null}

              {loadingPrograms ? (
                <ActivityIndicator color={colors.accent} style={styles.sheetLoading} />
              ) : programs.length === 0 ? (
                <View>
                  <Text style={styles.sheetEmpty}>You don't have a program yet.</Text>
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
                    >
                      <Text style={styles.sheetRowText}>{program.name}</Text>
                      {selectedProgramId === program.id ? (
                        <Ionicons name="checkmark" size={18} color={colors.accent} />
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
                onPress={onClose}
                disabled={saving}
              >
                <Text style={styles.modalButtonSecondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, saving && styles.modalButtonDisabled]}
                onPress={() => void handleSave()}
                disabled={saving || loadingPrograms || programs.length === 0}
              >
                {saving ? (
                  <ActivityIndicator color={colors.accentText} />
                ) : (
                  <Text style={styles.modalButtonText}>Save</Text>
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
  const { id } = useLocalSearchParams<{ id: string }>();

  const [workout, setWorkout] = useState<WorkoutDetail | null>(null);
  const [pending, setPending] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyExercise, setBusyExercise] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restSeconds, setRestSecondsState] = useState(DEFAULT_REST_SECONDS);
  const [targets, setTargets] = useState<TemplateExerciseTarget[]>([]);
  const [saveAsTemplateVisible, setSaveAsTemplateVisible] = useState(false);
  // A past session opens read-only by default (see isFinished/readOnly
  // below); this is the escape hatch that lets it become editable again.
  const [editing, setEditing] = useState(false);
  const [finishing, setFinishing] = useState(false);

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
    workoutsApi
      .getWorkout(id)
      .then((data) => {
        if (!cancelled) setWorkout(data);
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
  }, [id]);

  // Fetched separately rather than embedded in the workout response: targets
  // belong to the template, not the session, and a resumed workout re-fetches
  // them fresh instead of depending on whatever POST /templates/{id}/start
  // returned when the session began.
  useEffect(() => {
    const templateId = workout?.template_id;
    if (!templateId) {
      setTargets([]);
      return;
    }
    let cancelled = false;
    programsApi
      .getTemplate(templateId)
      .then((data) => {
        if (!cancelled) setTargets(data.exercises);
      })
      .catch(() => {
        // No goals shown is a smaller problem than blocking logging over it.
      });
    return () => {
      cancelled = true;
    };
  }, [workout?.template_id]);

  // Template exercises come first (in template order) so a session started
  // from a plan shows the whole plan immediately, not just what's logged so
  // far — this is what makes an empty, just-started session show anything
  // at all instead of a blank screen.
  const blocks = useMemo(() => {
    if (!workout) return [];
    const targetExtras = targets.map((t) => ({ id: t.exercise_id, name: t.exercise_name }));
    return groupByExercise(workout.sets, [...targetExtras, ...pending]);
  }, [workout, pending, targets]);

  const handleSaveTitle = useCallback(
    async (title: string | null) => {
      try {
        setWorkout(await workoutsApi.updateWorkout(id, { title }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save the name");
      }
    },
    [id],
  );

  const handleAddSet = useCallback(
    async (exerciseId: string, weight: number, reps: number, isWarmup: boolean) => {
      setBusyExercise(exerciseId);
      setError(null);
      try {
        const updated = await workoutsApi.addSet(id, {
          exercise_id: exerciseId,
          weight_kg: weight,
          reps,
          is_warmup: isWarmup,
        });
        setWorkout(updated);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save the set");
      } finally {
        setBusyExercise(null);
      }
    },
    [id],
  );

  const handleEditSet = useCallback(
    async (setId: number, weight: number, reps: number) => {
      setError(null);
      try {
        setWorkout(await workoutsApi.updateSet(id, setId, { weight_kg: weight, reps }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not update the set");
        throw err;
      }
    },
    [id],
  );

  const handleDeleteSet = useCallback(
    async (setId: number) => {
      try {
        setWorkout(await workoutsApi.deleteSet(id, setId));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not delete the set");
      }
    },
    [id],
  );

  const handleFinish = useCallback(async () => {
    // Guards against a double-tap firing this twice while the request is in
    // flight — finish is idempotent server-side, but there is no reason to
    // rely on that when a disabled button is just as easy.
    setFinishing(true);
    // Write to the server first: if it fails, the device keeps its active
    // workout pointer and the session is not lost, just not marked done yet.
    try {
      await workoutsApi.finishWorkout(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not finish the workout");
      setFinishing(false);
      return;
    }
    await clearActiveWorkout();
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
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!workout) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error ?? "Workout not found"}</Text>
      </View>
    );
  }

  // A finished session opens read-only unless the user explicitly asks to
  // edit it. An in-progress one is always editable — isFinished is false, so
  // readOnly is false regardless of the (unused, in that case) editing flag.
  const isFinished = workout.finished_at !== null;
  const readOnly = isFinished && !editing;

  return (
    <>
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={90}
      >
        <Stack.Screen
          options={{
            title: workout.title ?? "Workout",
            headerRight: () => {
              if (readOnly) {
                return (
                  <Pressable onPress={() => setEditing(true)} hitSlop={8}>
                    <Text style={styles.finish}>Edit</Text>
                  </Pressable>
                );
              }
              if (isFinished) {
                // Editing an already-finished workout: exit just leaves edit
                // mode, it must not call finish again.
                return (
                  <Pressable onPress={() => setEditing(false)} hitSlop={8}>
                    <Text style={styles.finish}>Done</Text>
                  </Pressable>
                );
              }
              return (
                <Pressable onPress={confirmFinish} disabled={finishing} hitSlop={8}>
                  {finishing ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <Text style={styles.finish}>Finish</Text>
                  )}
                </Pressable>
              );
            },
          }}
        />

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {readOnly ? (
            <Text style={styles.titleReadOnly}>{workout.title ?? "Workout"}</Text>
          ) : (
            <TitleField value={workout.title} onSave={(title) => void handleSaveTitle(title)} />
          )}

          {readOnly ? <Text style={styles.sessionDate}>{formatSessionDate(workout.performed_at)}</Text> : null}

          <View style={styles.summary}>
            <View>
              <Text style={styles.summaryValue}>{workout.total_sets}</Text>
              <Text style={styles.summaryLabel}>working sets</Text>
            </View>
            {isFinished && workout.finished_at ? (
              workout.finished_automatically === false ? (
                <FinishedDuration startedAt={workout.performed_at} endedAt={workout.finished_at} />
              ) : (
                <View>
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

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {blocks.map((block) => {
            const target = targets.find((t) => t.exercise_id === block.exerciseId);
            return (
              <View key={block.exerciseId} style={styles.block}>
                <Text style={styles.blockTitle}>{block.name}</Text>
                {target ? (
                  <Text style={styles.blockTarget}>Target: {formatTarget(target)}</Text>
                ) : null}

                {readOnly
                  ? block.sets.map((set) => <ReadOnlySetRow key={set.id} set={set} />)
                  : block.sets.map((set) => (
                      <SetRow
                        key={set.id}
                        set={set}
                        onSave={handleEditSet}
                        onDelete={(setId) => void handleDeleteSet(setId)}
                      />
                    ))}

                {readOnly ? null : (
                  <SetForm
                    busy={busyExercise === block.exerciseId}
                    lastSet={block.sets[block.sets.length - 1]}
                    onSubmit={(weight, reps, isWarmup) =>
                      void handleAddSet(block.exerciseId, weight, reps, isWarmup)
                    }
                  />
                )}
              </View>
            );
          })}

          {readOnly ? null : (
            <Pressable style={styles.addExercise} onPress={openPicker}>
              <Ionicons name="add" size={20} color={colors.accent} />
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

      <SaveAsTemplateModal
        visible={saveAsTemplateVisible}
        workout={workout}
        onClose={() => setSaveAsTemplateVisible(false)}
        onSaved={() => {
          setSaveAsTemplateVisible(false);
          void handleFinish();
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  content: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  finish: { color: colors.accent, fontSize: 16, fontWeight: "700" },

  titleInput: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  titleReadOnly: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    paddingVertical: spacing.sm,
  },
  sessionDate: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.sm },

  summary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  summaryValue: { color: colors.text, fontSize: 20, fontWeight: "700" },
  summaryLabel: { color: colors.textMuted, fontSize: 12 },
  rest: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  restDuration: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  restLabel: { color: colors.textMuted, fontSize: 14 },
  restValue: { color: colors.text, fontSize: 14, fontWeight: "600" },
  restCountdown: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  restDone: { color: colors.accent },
  restButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  restButtonActive: { backgroundColor: colors.border },
  error: { color: colors.danger, marginBottom: spacing.md },

  block: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  blockTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
  blockTarget: { color: colors.textMuted, fontSize: 12, marginBottom: spacing.sm },

  setRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  setRowEditing: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  setNumber: { color: colors.textMuted, width: 28, fontSize: 14, fontWeight: "600" },
  warmupLabel: { color: colors.textMuted, opacity: 0.7 },
  setDetail: { color: colors.text, fontSize: 15 },
  editInput: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minWidth: 62,
    textAlign: "center",
  },
  editUnit: { color: colors.textMuted, fontSize: 13 },
  editAction: { paddingHorizontal: spacing.xs },

  form: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, marginTop: spacing.md },
  field: { flex: 1 },
  fieldLabel: { color: colors.textMuted, fontSize: 11, marginBottom: 2 },
  fieldInput: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  warmupToggle: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    borderColor: colors.border,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  warmupActive: { backgroundColor: colors.border },
  warmupText: { color: colors.textMuted, fontWeight: "700" },
  warmupTextActive: { color: colors.text },
  addSet: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },

  addExercise: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    borderColor: colors.border,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  addExerciseText: { color: colors.accent, fontSize: 16, fontWeight: "600" },
  hint: { color: colors.textMuted, fontSize: 13, textAlign: "center", marginTop: spacing.md },

  sheetAvoider: { flex: 1 },
  sheetBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  sheet: {
    maxHeight: "80%",
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    paddingTop: spacing.lg,
  },
  sheetScroll: { flexShrink: 1 },
  sheetScrollContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: spacing.md },
  sheetInput: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  sheetLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetRowText: { color: colors.text, fontSize: 16 },
  sheetEmpty: { color: colors.textMuted, marginBottom: spacing.sm },
  sheetLoading: { marginVertical: spacing.md },
  sheetCreateProgram: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.sm,
    alignItems: "center",
  },
  sheetCreateProgramText: { color: colors.accent, fontSize: 14, fontWeight: "600" },

  modalActions: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  modalButton: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
  },
  modalButtonSecondary: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  modalButtonDisabled: { opacity: 0.7 },
  modalButtonText: { color: colors.accentText, fontSize: 16, fontWeight: "700" },
  modalButtonSecondaryText: { color: colors.accent, fontSize: 16, fontWeight: "700" },
});
