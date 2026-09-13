"""Expand exercise catalogue with more per-muscle options

Revision ID: 946401aa1328
Revises: f21c7d905e38
Create Date: 2026-09-13 19:37:33.895421

Adım 22 (PROJE_1_CODEX_INCELEME.md): the seed catalogue (20 baseline +
5 from c6a42e8b91df = 25 exercises) leaves most muscles with exactly one
primary-work option — abs, biceps, calves, forearms, front_delts,
lower_back, obliques, rear_delts, side_delts, traps and triceps each had
only a single exercise that counts toward their weekly volume. A user
without that one exercise's equipment, or who just wants variety, has no
other way to train that muscle directly and have it show up in the
weekly-volume analysis. This adds a second (sometimes third) primary
option for every one of those muscles, plus a few widely-used movements
(Hip Thrust, Bulgarian Split Squat, Push-Up, Dip) that were missing
outright, while keeping the same editorial conventions as the baseline
seed and c6a42e8b91df: fixed UUIDs (so a rollback can never collide with
a user's own custom exercise), effectiveness as a 1-5 judgement call
rather than a measurement, and role='secondary' rows excluded from
direct-set counting exactly like the existing catalogue.
"""

import sqlalchemy as sa

from alembic import op

revision: str = "946401aa1328"
down_revision: str | None = "f21c7d905e38"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

# Fixed identities: rollback must never match a user's own exercise by name.
# Each entry: (id, name, name_tr, equipment, is_compound, muscles)
# muscles: tuple of (muscle_group.name, role, effectiveness)
EXERCISES: tuple[tuple[str, str, str, str, bool, tuple[tuple[str, str, int], ...]], ...] = (
    (
        "134e6937-828e-41e4-aa94-002eb8b5ff93",
        "Hip Thrust",
        "Hip Thrust",
        "barbell",
        True,
        (("glutes", "primary", 5), ("hamstrings", "secondary", 2)),
    ),
    (
        "dd6c39c5-755a-4741-a285-187ca5fa65c3",
        "Bulgarian Split Squat",
        "Bulgar Squat",
        "dumbbell",
        True,
        (("quads", "primary", 4), ("glutes", "secondary", 3)),
    ),
    (
        "4b3ca5d9-0584-43fd-b7ca-07067e270364",
        "Walking Lunge",
        "Yürüyerek Lunge",
        "dumbbell",
        True,
        (("quads", "primary", 4), ("glutes", "secondary", 3)),
    ),
    (
        "ebac0bcb-f4fc-4094-a2b2-9c6ed5936f7c",
        "Seated Cable Row",
        "Oturarak Kablo Çekişi",
        "cable",
        True,
        (
            ("upper_back", "primary", 5),
            ("lats", "secondary", 3),
            ("biceps", "secondary", 2),
        ),
    ),
    (
        "4c9e9ce6-9f87-4e29-b02b-93c4fcb24945",
        "T-Bar Row",
        "T-Bar Row",
        "barbell",
        True,
        (
            ("lats", "primary", 4),
            ("upper_back", "secondary", 3),
            ("biceps", "secondary", 2),
        ),
    ),
    (
        "57e79039-dd72-4d2a-b6de-200829d7dcce",
        "Push-Up",
        "Şınav",
        "bodyweight",
        True,
        (
            ("chest", "primary", 4),
            ("triceps", "secondary", 3),
            ("front_delts", "secondary", 2),
        ),
    ),
    (
        "3f7f29c4-7acb-471d-9c4b-90429dcde2b9",
        "Dip",
        "Dips",
        "bodyweight",
        True,
        (("triceps", "primary", 5), ("chest", "secondary", 3)),
    ),
    (
        "c5172f63-d05a-42df-ad5e-8e5ea80eb429",
        "Close-Grip Bench Press",
        "Dar Tutuş Bench Press",
        "barbell",
        True,
        (("triceps", "primary", 4), ("chest", "secondary", 3)),
    ),
    (
        "4c4fbafb-3691-46bf-aa08-e9aa5c05b063",
        "Overhead Tricep Extension",
        "Başüstü Triceps Ekstansiyonu",
        "dumbbell",
        False,
        (("triceps", "primary", 5),),
    ),
    (
        "82a978ac-fe38-4dd3-9d5f-9a11f2977aa8",
        "Barbell Curl",
        "Barbell Curl",
        "barbell",
        False,
        (("biceps", "primary", 5), ("forearms", "secondary", 2)),
    ),
    (
        "d14675b8-f5db-4e20-bf6a-9fe5f9c6a188",
        "Hammer Curl",
        "Hammer Curl",
        "dumbbell",
        False,
        (("biceps", "primary", 4), ("forearms", "secondary", 3)),
    ),
    (
        "fba229b1-cb60-40dc-a34b-13fc32b64cbc",
        "Farmer's Carry",
        "Çiftçi Yürüyüşü",
        "dumbbell",
        True,
        (("forearms", "primary", 4), ("traps", "secondary", 3)),
    ),
    (
        "cf083ee9-21d2-4b26-a583-61e54344116a",
        "Face Pull",
        "Face Pull",
        "cable",
        False,
        (
            ("rear_delts", "primary", 5),
            ("side_delts", "secondary", 3),
            ("upper_back", "secondary", 2),
        ),
    ),
    (
        "895eb838-f036-4f59-b870-6f411eb308ca",
        "Arnold Press",
        "Arnold Press",
        "dumbbell",
        True,
        (
            ("front_delts", "primary", 5),
            ("side_delts", "secondary", 3),
            ("triceps", "secondary", 2),
        ),
    ),
    (
        "624d2091-cd27-4fec-95e3-1e6ec30b9986",
        "Cable Lateral Raise",
        "Kablo Yan Kaldırış",
        "cable",
        False,
        (("side_delts", "primary", 4),),
    ),
    (
        "c12109d5-1bea-43ff-9228-f07fde73c790",
        "Seated Calf Raise",
        "Oturarak Calf Raise",
        "machine",
        False,
        (("calves", "primary", 4),),
    ),
    (
        "ca5164e4-e56c-4ba3-bbd8-8946ead7d8d9",
        "Hanging Leg Raise",
        "Asılı Bacak Kaldırış",
        "bodyweight",
        False,
        (("abs", "primary", 5),),
    ),
    (
        "ec2b0893-ebc9-4a97-bc4f-e48feb35e258",
        "Cable Crunch",
        "Kablo Crunch",
        "cable",
        False,
        (("abs", "primary", 4),),
    ),
    (
        "0fdd835c-d06c-4080-936f-f6192851fb60",
        "Russian Twist",
        "Russian Twist",
        "bodyweight",
        False,
        (("obliques", "primary", 4),),
    ),
    (
        "97c3052f-07de-46e3-a003-3a5b058e7598",
        "Back Extension",
        "Sırt Ekstansiyonu",
        "bodyweight",
        False,
        (("lower_back", "primary", 4), ("glutes", "secondary", 2)),
    ),
    (
        "5ab6cf4f-01c2-4989-9f45-315be1d68774",
        "Barbell Shrug",
        "Barbell Omuz Silkme",
        "barbell",
        False,
        (("traps", "primary", 5),),
    ),
)


def upgrade() -> None:
    connection = op.get_bind()
    for exercise_id, name, name_tr, equipment, is_compound, muscles in EXERCISES:
        connection.execute(
            sa.text("""
                INSERT INTO exercises (id, name, name_tr, equipment, is_compound, created_by)
                VALUES (CAST(:id AS uuid), :name, :name_tr, :equipment, :is_compound, NULL)
            """),
            {
                "id": exercise_id,
                "name": name,
                "name_tr": name_tr,
                "equipment": equipment,
                "is_compound": is_compound,
            },
        )
        for muscle, role, effectiveness in muscles:
            # Scalar subquery fails on a missing muscle instead of silently
            # losing its link.
            connection.execute(
                sa.text("""
                    INSERT INTO exercise_muscle_groups
                        (exercise_id, muscle_group_id, role, effectiveness)
                    VALUES (CAST(:id AS uuid),
                            (SELECT id FROM muscle_groups WHERE name = :muscle),
                            :role, :effectiveness)
                """),
                {
                    "id": exercise_id,
                    "muscle": muscle,
                    "role": role,
                    "effectiveness": effectiveness,
                },
            )


def downgrade() -> None:
    # One atomic statement. Existing RESTRICT FKs refuse rollback if a workout
    # set or program template uses any added exercise; user history is never deleted.
    exercises = sa.table("exercises", sa.column("id", sa.Uuid()))
    op.get_bind().execute(
        exercises.delete().where(exercises.c.id.in_([row[0] for row in EXERCISES]))
    )
