"""The example programs Aures ships: plain data, easy to replace.

This file is the only place the example content lives. To replace or add an
example, edit `EXAMPLES` and bump that example's `version` whenever its content
changes (a client that previewed an older version is then told to look again
instead of silently copying something it did not see). `validate_catalogue`
checks every entry, and the tests run it over whatever is here.

What belongs where:

- What the cited sources FOUND is only in `SOURCES[...].finding`, in our own short
  wording of their abstracts. Nothing else on this page claims research support.
- Everything else is Aures's own authoring: the level labels, which exercises, their
  order, the set counts, rep ranges and RIR targets, and the schedule. Each example's
  `authored` text says so, and the preview shows it separately from the findings.

Exercises are named exactly as in the system catalogue and resolved to real
catalogue rows on the server at preview/copy time (see `service.resolve`); ids are
never stored here because they differ per database.
"""

from dataclasses import dataclass
from typing import Literal

Level = Literal["Beginner", "Intermediate", "Advanced"]


@dataclass(frozen=True)
class Move:
    """One exercise in a training day: sets x rep range at a reps-in-reserve target."""

    exercise: str
    sets: int
    reps_min: int
    reps_max: int
    rir: int
    note: str | None = None


@dataclass(frozen=True)
class Day:
    name: str
    moves: tuple[Move, ...]
    note: str | None = None


@dataclass(frozen=True)
class Source:
    title: str
    citation: str
    url: str
    # What the source found, in our own words. Keep it to what its abstract says.
    finding: str


@dataclass(frozen=True)
class Example:
    id: str  # stable slug; never reuse one for different content
    version: int
    level: Level
    name: str
    summary: str
    sessions_per_week: int
    # The suggested order of sessions, repeated as needed. Names match `days`.
    sequence: tuple[str, ...]
    schedule: str  # the same schedule in words, shown as is
    days: tuple[Day, ...]
    sources: tuple[Source, ...]
    authored: tuple[str, ...]


ACSM = Source(
    title=(
        "American College of Sports Medicine Position Stand. Resistance Training "
        "Prescription for Muscle Function, Hypertrophy, and Physical Performance in "
        "Healthy Adults: An Overview of Reviews"
    ),
    citation="Currier et al., Medicine & Science in Sports & Exercise, 2026",
    url="https://pubmed.ncbi.nlm.nih.gov/41843416/",
    finding=(
        "Across 137 systematic reviews, muscle growth was greater with higher weekly "
        "volume (about 10 or more sets per week). Few other prescription details "
        "changed results consistently: training to momentary failure, equipment type "
        "and periodization did not."
    ),
)

SPLIT_VS_FULL_BODY = Source(
    title=(
        "Efficacy of Split Versus Full-Body Resistance Training on Strength and Muscle "
        "Growth: A Systematic Review With Meta-Analysis"
    ),
    citation="Ramos-Campo et al., Journal of Strength and Conditioning Research, 2024",
    url="https://pubmed.ncbi.nlm.nih.gov/38595233/",
    finding=(
        "In 14 studies (392 people), split and full-body routines gave similar strength "
        "and muscle-size changes when weekly volume was equal, so the choice can follow "
        "personal preference."
    ),
)

_COMMON_AUTHORED = (
    "The level label, the exercises and their order, the set counts, rep ranges, RIR "
    "targets and the schedule are Aures's own choices. The sources above do not "
    "prescribe this program.",
    "It is a starting example. Every part is editable after you add it, and warm-up "
    "sets and weights are up to you when you log.",
)

EXAMPLES: tuple[Example, ...] = (
    Example(
        id="beginner-full-body-ab",
        version=1,
        level="Beginner",
        name="Full Body A/B",
        summary="Two whole-body days that alternate, three sessions a week.",
        sessions_per_week=3,
        sequence=("Full Body A", "Full Body B"),
        schedule=(
            "3 sessions per week, alternating A and B: A, B, A one week, then B, A, B "
            "the next. Leave at least a rest day between sessions."
        ),
        days=(
            Day(
                "Full Body A",
                (
                    Move("Goblet Squat", 2, 8, 12, 3),
                    Move("Machine Chest Press", 2, 8, 12, 3),
                    Move("Lat Pulldown", 2, 8, 12, 3),
                    Move("Leg Curl", 2, 10, 15, 2),
                    Move("Lateral Raise", 2, 12, 20, 2),
                    Move("Tricep Pushdown", 2, 10, 15, 2),
                    Move("Cable Crunch", 2, 10, 15, 2),
                ),
            ),
            Day(
                "Full Body B",
                (
                    Move("Leg Press", 2, 10, 15, 3),
                    Move("Romanian Deadlift", 2, 8, 12, 3, "Start light and learn the hinge."),
                    Move("Incline Dumbbell Bench Press", 2, 8, 12, 3),
                    Move("Seated Cable Row", 2, 8, 12, 3),
                    Move("Dumbbell Curl", 2, 10, 15, 2),
                    Move("Calf Raise", 2, 10, 15, 2),
                    Move("Face Pull", 2, 12, 20, 2),
                ),
            ),
        ),
        sources=(SPLIT_VS_FULL_BODY, ACSM),
        authored=(
            "Two sets per exercise is a deliberately gentle starting dose. Because A and "
            "B alternate, each muscle gets only a few sets a week, below the roughly 10 "
            "the overview links to more growth; the Volume tab shows where to add sets "
            "as you adapt.",
            "RIR 3 on the big lifts leaves room to learn technique; 2 on the smaller ones.",
        )
        + _COMMON_AUTHORED,
    ),
    Example(
        id="intermediate-upper-lower",
        version=1,
        level="Intermediate",
        name="Upper/Lower",
        summary="Upper and lower body split across four sessions a week.",
        sessions_per_week=4,
        sequence=("Upper A", "Lower A", "Upper B", "Lower B"),
        schedule=(
            "4 sessions per week in this order: Upper A, Lower A, Upper B, Lower B. For "
            "example Monday, Tuesday, Thursday, Friday."
        ),
        days=(
            Day(
                "Upper A",
                (
                    Move("Barbell Bench Press", 3, 6, 10, 2),
                    Move("Barbell Row", 3, 6, 10, 2),
                    Move("Lat Pulldown", 3, 8, 12, 2),
                    Move("Lateral Raise", 3, 12, 20, 1),
                    Move("Tricep Pushdown", 3, 10, 15, 1),
                    Move("Dumbbell Curl", 3, 10, 15, 1),
                    Move("Face Pull", 3, 12, 20, 1),
                ),
            ),
            Day(
                "Lower A",
                (
                    Move("Barbell Back Squat", 3, 6, 10, 2),
                    Move("Romanian Deadlift", 3, 8, 12, 2),
                    Move("Walking Lunge", 3, 10, 12, 2, "Reps per leg."),
                    Move("Calf Raise", 3, 10, 15, 1),
                    Move("Cable Crunch", 3, 10, 15, 1),
                ),
            ),
            Day(
                "Upper B",
                (
                    Move("Incline Dumbbell Bench Press", 3, 8, 12, 2),
                    Move(
                        "Pull-up", 3, 6, 10, 2,
                        "If six clean reps are not there yet, swap in Lat Pulldown.",
                    ),
                    Move("Seated Cable Row", 3, 8, 12, 2),
                    Move("Seated Dumbbell Shoulder Press", 3, 8, 12, 2),
                    Move("Cable Fly", 3, 12, 15, 1),
                    Move("Cable Lateral Raise", 3, 12, 20, 1),
                    Move("Cable Rope Overhead Triceps Extension", 3, 10, 15, 1),
                    Move("Incline Dumbbell Curl", 3, 10, 15, 1),
                ),
            ),
            Day(
                "Lower B",
                (
                    Move("Hack Squat", 3, 8, 12, 2),
                    Move("Hip Thrust", 3, 8, 12, 2),
                    Move("Leg Curl", 3, 10, 15, 1),
                    Move("Leg Extension", 3, 10, 15, 1),
                    Move("Seated Calf Raise", 3, 10, 15, 1),
                    Move("Hanging Leg Raise", 3, 10, 15, 1),
                ),
            ),
        ),
        sources=(SPLIT_VS_FULL_BODY, ACSM),
        authored=(
            "Three sets per exercise, with every muscle trained on two days a week. The "
            "heavier compound lifts come first (RIR 2) and the smaller exercises sit "
            "closer to failure (RIR 1).",
        )
        + _COMMON_AUTHORED,
    ),
    Example(
        id="advanced-push-pull-legs",
        version=1,
        level="Advanced",
        name="Push/Pull/Legs",
        summary="Push, pull and legs days, run twice for a six-session week.",
        sessions_per_week=6,
        sequence=("Push", "Pull", "Legs", "Push", "Pull", "Legs"),
        schedule=(
            "6 sessions per week: Push, Pull, Legs, then Push, Pull, Legs again. Take one "
            "rest day a week wherever it suits you."
        ),
        days=(
            Day(
                "Push",
                (
                    Move("Barbell Bench Press", 3, 6, 10, 2),
                    Move("Incline Dumbbell Bench Press", 3, 8, 12, 2),
                    Move("Seated Dumbbell Shoulder Press", 3, 8, 12, 2),
                    Move("Cable Lateral Raise", 3, 12, 20, 1),
                    Move("Tricep Pushdown", 3, 10, 15, 1),
                    Move("Cable Rope Overhead Triceps Extension", 3, 10, 15, 1),
                ),
            ),
            Day(
                "Pull",
                (
                    Move(
                        "Pull-up", 3, 6, 10, 2,
                        "If six clean reps are not there yet, swap in Lat Pulldown.",
                    ),
                    Move("Barbell Row", 3, 6, 10, 2),
                    Move("Seated Cable Row", 3, 8, 12, 2),
                    Move("Face Pull", 3, 12, 20, 1),
                    Move("Barbell Curl", 3, 8, 12, 1),
                    Move("Hammer Curl", 3, 10, 15, 1),
                ),
            ),
            Day(
                "Legs",
                (
                    Move("Barbell Back Squat", 3, 6, 10, 2),
                    Move("Romanian Deadlift", 3, 8, 12, 2),
                    Move("Leg Press", 3, 10, 15, 2),
                    Move("Leg Curl", 3, 10, 15, 1),
                    Move("Calf Raise", 3, 10, 15, 1),
                    Move("Hanging Leg Raise", 3, 10, 15, 1),
                ),
            ),
        ),
        sources=(ACSM, SPLIT_VS_FULL_BODY),
        authored=(
            "Three training days, each used twice a week, so every muscle is trained about "
            "twice. The two halves of the week are identical on purpose; edit one of them "
            "if you want the second Push, Pull or Legs day to differ.",
        )
        + _COMMON_AUTHORED,
    ),
)


def by_id(example_id: str) -> Example | None:
    return next((example for example in EXAMPLES if example.id == example_id), None)


def weekly_working_sets(example: Example) -> int:
    """Approximate working sets in a typical week, rounded to a whole number.

    Adds up the sets of the suggested sequence and scales it to the weekly session
    count, so Full Body A/B (3 sessions out of a 2-day rotation) averages its two weeks.
    Warm-up sets are not counted, matching how the rest of the app counts.
    """
    per_day = {day.name: sum(move.sets for move in day.moves) for day in example.days}
    cycle = sum(per_day[name] for name in example.sequence)
    return round(cycle * example.sessions_per_week / len(example.sequence))


def validate_catalogue(examples: tuple[Example, ...] = EXAMPLES) -> list[str]:
    """Problems in the content itself (empty means well-formed). Names are not checked
    against the database here; `service.resolve` does that."""
    problems: list[str] = []
    seen: set[str] = set()
    for example in examples:
        where = example.id
        if example.id in seen:
            problems.append(f"{where}: duplicate id")
        seen.add(example.id)
        if example.version < 1:
            problems.append(f"{where}: version must be at least 1")
        names = [day.name for day in example.days]
        if len(set(names)) != len(names):
            problems.append(f"{where}: duplicate day names")
        if not example.days:
            problems.append(f"{where}: no days")
        for name in example.sequence:
            if name not in names:
                problems.append(f"{where}: sequence names unknown day {name!r}")
        if not example.sequence or example.sessions_per_week < 1:
            problems.append(f"{where}: needs a sequence and sessions_per_week")
        if not example.sources:
            problems.append(f"{where}: needs at least one source")
        for day in example.days:
            if not day.moves:
                problems.append(f"{where}/{day.name}: no exercises")
            in_day = [move.exercise for move in day.moves]
            if len(set(in_day)) != len(in_day):
                problems.append(f"{where}/{day.name}: an exercise appears twice")
            for move in day.moves:
                if not 1 <= move.sets <= 20:
                    problems.append(f"{where}/{day.name}/{move.exercise}: sets out of range")
                if not 1 <= move.reps_min <= move.reps_max <= 100:
                    problems.append(f"{where}/{day.name}/{move.exercise}: bad rep range")
                if not 0 <= move.rir <= 10:
                    problems.append(f"{where}/{day.name}/{move.exercise}: RIR out of range")
    return problems
