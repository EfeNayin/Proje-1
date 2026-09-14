"""Add 50 more exercises sourced from a public exercise database

Revision ID: 254456be6d79
Revises: 946401aa1328
Create Date: 2026-09-14 13:58:32.578346

Adım 24 (PROJE_1_CODEX_INCELEME.md): the user asked for the catalogue to
keep growing and pointed at fitnessprogramer.com/exercises/ as a source of
real exercise names/equipment/muscle groupings to pull from, noting there is
no copyright concern in generic exercise names and classifications. This
migration adds 50 more exercises compiled from that site (its "primary
muscle" category pages for chest, back, shoulders, biceps, triceps,
forearm, abs, hip, calf, trapezius and erector spinae were fetched
directly), filling in muscles that were still comparatively thin after
946401aa1328 and adding equipment variety (machine and cable options in
particular, which were underrepresented). The site does not publish
effectiveness ratings or this project's specific muscle_groups taxonomy, so
primary/secondary role and the 1-5 effectiveness judgement are still this
project's own editorial call, exactly as for every prior catalogue
migration.

Per the user's explicit instruction this round ("haraketlerin hepsi
ingilizce olacak" — the exercises will all be English), every new row's
name_tr is set equal to its English name rather than translated, unlike
c6a42e8b91df and 946401aa1328 which gave real Turkish translations. This is
a display-only choice, not a search regression: name_tr still backs the
Turkish-accent-insensitive search index (idx_exercises_name_tr) the same
way it does for every other row, it simply is not a *different* string here.
"""

import sqlalchemy as sa

from alembic import op

revision: str = "254456be6d79"
down_revision: str | None = "946401aa1328"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

# Fixed identities: rollback must never match a user's own exercise by name.
# Each entry: (id, name, name_tr, equipment, is_compound, muscles). name_tr
# repeats name on every row — see the module docstring for why.
# muscles: tuple of (muscle_group.name, role, effectiveness)
EXERCISES: tuple[tuple[str, str, str, str, bool, tuple[tuple[str, str, int], ...]], ...] = (
    (
        "f1058568-f69f-4c29-ad8d-890b71c43a2e",
        "Decline Barbell Bench Press",
        "Decline Barbell Bench Press",
        "barbell",
        True,
        (
            ("chest", "primary", 5),
            ("triceps", "secondary", 3),
        ),
    ),
    (
        "6ad60e97-d437-4fec-a6f9-13897459ceec",
        "Incline Dumbbell Bench Press",
        "Incline Dumbbell Bench Press",
        "dumbbell",
        True,
        (
            ("chest", "primary", 5),
            ("front_delts", "secondary", 3),
            ("triceps", "secondary", 2),
        ),
    ),
    (
        "84a8250e-35ff-4aba-aa1a-7cbc7b1873a5",
        "Pec Deck Fly",
        "Pec Deck Fly",
        "machine",
        False,
        (("chest", "primary", 5),),
    ),
    (
        "cbf680dd-53e5-4147-a5de-46c13c956865",
        "Low Cable Crossover",
        "Low Cable Crossover",
        "cable",
        False,
        (("chest", "primary", 4),),
    ),
    (
        "fe324a32-0dd8-417f-a804-dcf95a7ee8e0",
        "Machine Chest Press",
        "Machine Chest Press",
        "machine",
        True,
        (
            ("chest", "primary", 5),
            ("triceps", "secondary", 3),
            ("front_delts", "secondary", 2),
        ),
    ),
    (
        "50fb3355-5fe6-4724-8104-b84044575acc",
        "Chest-Supported Dumbbell Row",
        "Chest-Supported Dumbbell Row",
        "dumbbell",
        True,
        (
            ("upper_back", "primary", 5),
            ("lats", "secondary", 3),
            ("biceps", "secondary", 2),
        ),
    ),
    (
        "243d1bde-a0ff-4925-b9ba-c5ff3d3e4de0",
        "Machine Row",
        "Machine Row",
        "machine",
        True,
        (
            ("upper_back", "primary", 5),
            ("lats", "secondary", 3),
            ("biceps", "secondary", 2),
        ),
    ),
    (
        "cac1e9d4-e402-4a6d-9640-9f73fc734e2c",
        "Pendlay Row",
        "Pendlay Row",
        "barbell",
        True,
        (
            ("upper_back", "primary", 5),
            ("lats", "secondary", 3),
            ("biceps", "secondary", 2),
        ),
    ),
    (
        "11e8176e-f976-49ef-931e-6c9ae734d721",
        "Inverted Row",
        "Inverted Row",
        "bodyweight",
        True,
        (
            ("upper_back", "primary", 4),
            ("lats", "secondary", 3),
            ("biceps", "secondary", 2),
        ),
    ),
    (
        "04d57b3a-188e-4613-b3a0-24e9d6205654",
        "Straight-Arm Pulldown",
        "Straight-Arm Pulldown",
        "cable",
        False,
        (("lats", "primary", 5),),
    ),
    (
        "790a5355-b6d4-41c3-a97e-c9596e3bd991",
        "Close-Grip Lat Pulldown",
        "Close-Grip Lat Pulldown",
        "cable",
        True,
        (
            ("lats", "primary", 5),
            ("biceps", "secondary", 3),
        ),
    ),
    (
        "f4ed1045-d293-4579-b91f-824d1b0351cb",
        "Seated Good Morning",
        "Seated Good Morning",
        "barbell",
        True,
        (
            ("lower_back", "primary", 4),
            ("hamstrings", "secondary", 3),
        ),
    ),
    (
        "b7ced250-9642-4f6d-921a-2d1e8fe64329",
        "Superman",
        "Superman",
        "bodyweight",
        False,
        (("lower_back", "primary", 3),),
    ),
    (
        "38ca07fe-a558-495c-8de8-c7e0b7174373",
        "Seated Dumbbell Shoulder Press",
        "Seated Dumbbell Shoulder Press",
        "dumbbell",
        True,
        (
            ("front_delts", "primary", 5),
            ("triceps", "secondary", 3),
            ("side_delts", "secondary", 2),
        ),
    ),
    (
        "d322ea60-d0d7-48de-ae49-9a3e809406a6",
        "Smith Machine Shoulder Press",
        "Smith Machine Shoulder Press",
        "machine",
        True,
        (
            ("front_delts", "primary", 5),
            ("triceps", "secondary", 3),
        ),
    ),
    (
        "c66a4dda-5d9c-4e62-b727-7ef5a01bad06",
        "Landmine Press",
        "Landmine Press",
        "barbell",
        True,
        (
            ("front_delts", "primary", 4),
            ("chest", "secondary", 2),
            ("triceps", "secondary", 2),
        ),
    ),
    (
        "3593a42e-891d-4b03-b14a-64811afb44cf",
        "Machine Lateral Raise",
        "Machine Lateral Raise",
        "machine",
        False,
        (("side_delts", "primary", 4),),
    ),
    (
        "6e839bdd-ff8b-4af8-85e5-7b713fa457da",
        "Upright Row",
        "Upright Row",
        "barbell",
        False,
        (
            ("side_delts", "primary", 4),
            ("traps", "secondary", 3),
            ("biceps", "secondary", 1),
        ),
    ),
    (
        "a14ada19-12c8-44ea-b68b-8041120b4170",
        "Dumbbell Y-Raise",
        "Dumbbell Y-Raise",
        "dumbbell",
        False,
        (
            ("side_delts", "primary", 4),
            ("rear_delts", "secondary", 2),
            ("traps", "secondary", 2),
        ),
    ),
    (
        "991dba43-918d-4c85-be4c-8e90baee07aa",
        "Reverse Pec Deck Fly",
        "Reverse Pec Deck Fly",
        "machine",
        False,
        (
            ("rear_delts", "primary", 5),
            ("upper_back", "secondary", 2),
        ),
    ),
    (
        "f9255560-b5d4-4acb-a00e-0036998bb3c8",
        "Cable Reverse Fly",
        "Cable Reverse Fly",
        "cable",
        False,
        (
            ("rear_delts", "primary", 4),
            ("side_delts", "secondary", 2),
        ),
    ),
    (
        "d4d6eff2-e8d3-4c65-8ebc-585fa282eb62",
        "Dumbbell Preacher Curl",
        "Dumbbell Preacher Curl",
        "dumbbell",
        False,
        (
            ("biceps", "primary", 5),
            ("forearms", "secondary", 2),
        ),
    ),
    (
        "17e4622b-0abd-4f22-8d08-732991f3a9d0",
        "Concentration Curl",
        "Concentration Curl",
        "dumbbell",
        False,
        (("biceps", "primary", 5),),
    ),
    (
        "b89b7a76-cfe8-4696-9687-05c77dbc7280",
        "Cable Curl",
        "Cable Curl",
        "cable",
        False,
        (
            ("biceps", "primary", 4),
            ("forearms", "secondary", 2),
        ),
    ),
    (
        "dae76d1d-6ca1-421a-a761-bf79fe9cc5b0",
        "Incline Dumbbell Curl",
        "Incline Dumbbell Curl",
        "dumbbell",
        False,
        (("biceps", "primary", 5),),
    ),
    (
        "bcf8d9de-0908-40ca-99d2-3adc94a6b5e4",
        "Barbell Skull Crusher",
        "Barbell Skull Crusher",
        "barbell",
        False,
        (("triceps", "primary", 5),),
    ),
    (
        "28a679d3-6ce9-48c8-96c2-744df72b254c",
        "Cable Rope Overhead Triceps Extension",
        "Cable Rope Overhead Triceps Extension",
        "cable",
        False,
        (("triceps", "primary", 5),),
    ),
    (
        "751937ff-fc95-4600-8cdc-aba4c776def4",
        "Barbell Reverse Curl",
        "Barbell Reverse Curl",
        "barbell",
        False,
        (
            ("forearms", "primary", 4),
            ("biceps", "secondary", 2),
        ),
    ),
    (
        "dd492411-7cff-4408-8f43-3b1517b8188e",
        "Dumbbell Reverse Wrist Curl",
        "Dumbbell Reverse Wrist Curl",
        "dumbbell",
        False,
        (("forearms", "primary", 4),),
    ),
    (
        "b9d16f8f-6f20-4b70-a3fd-097300c8b70d",
        "Barbell Wrist Curl",
        "Barbell Wrist Curl",
        "barbell",
        False,
        (("forearms", "primary", 4),),
    ),
    (
        "7f44b8d1-c432-42e6-ac5a-e84e5a6087df",
        "Rack Pull",
        "Rack Pull",
        "barbell",
        True,
        (
            ("traps", "primary", 4),
            ("upper_back", "secondary", 3),
            ("hamstrings", "secondary", 2),
            ("lower_back", "secondary", 2),
        ),
    ),
    (
        "c183c8e9-6719-40f7-9fc0-3054fe4ac148",
        "Snatch-Grip High Pull",
        "Snatch-Grip High Pull",
        "barbell",
        True,
        (
            ("traps", "primary", 4),
            ("rear_delts", "secondary", 2),
            ("upper_back", "secondary", 2),
        ),
    ),
    (
        "0f392fe3-aea8-402d-b883-5314d7d5ed5a",
        "Hack Squat",
        "Hack Squat",
        "machine",
        True,
        (
            ("quads", "primary", 5),
            ("glutes", "secondary", 2),
        ),
    ),
    (
        "7f45cbc1-3bb7-4ca6-90b4-102b896c4106",
        "Goblet Squat",
        "Goblet Squat",
        "dumbbell",
        True,
        (
            ("quads", "primary", 4),
            ("glutes", "secondary", 3),
        ),
    ),
    (
        "66534cce-8e49-4deb-8932-b71a53c11cf2",
        "Smith Machine Squat",
        "Smith Machine Squat",
        "machine",
        True,
        (
            ("quads", "primary", 5),
            ("glutes", "secondary", 3),
        ),
    ),
    (
        "800ed0a1-a346-4b0b-805a-ef80538cf942",
        "Nordic Hamstring Curl",
        "Nordic Hamstring Curl",
        "bodyweight",
        False,
        (("hamstrings", "primary", 5),),
    ),
    (
        "8eadd165-759c-4244-be04-a297c37bef72",
        "Single-Leg Romanian Deadlift",
        "Single-Leg Romanian Deadlift",
        "dumbbell",
        True,
        (
            ("hamstrings", "primary", 4),
            ("glutes", "secondary", 3),
        ),
    ),
    (
        "ed169b8f-9dbc-4e79-9fa3-d233d01fc362",
        "Good Morning",
        "Good Morning",
        "barbell",
        True,
        (
            ("hamstrings", "primary", 4),
            ("lower_back", "secondary", 3),
            ("glutes", "secondary", 2),
        ),
    ),
    (
        "15455bd8-1a1b-4409-a73d-8ebde43b54f6",
        "Cable Pull-Through",
        "Cable Pull-Through",
        "cable",
        True,
        (
            ("glutes", "primary", 4),
            ("hamstrings", "secondary", 3),
        ),
    ),
    (
        "fd90dbb4-87eb-4c5a-b1e3-ce7846aefbcd",
        "Sumo Deadlift",
        "Sumo Deadlift",
        "barbell",
        True,
        (
            ("glutes", "primary", 5),
            ("quads", "secondary", 3),
            ("hamstrings", "secondary", 3),
        ),
    ),
    (
        "86dbc284-9cfc-4544-8ce8-41e6f2030b27",
        "Cable Kickback",
        "Cable Kickback",
        "cable",
        False,
        (("glutes", "primary", 4),),
    ),
    (
        "2b49deed-cd47-43ef-9847-df19bf863619",
        "Leg Press Calf Raise",
        "Leg Press Calf Raise",
        "machine",
        False,
        (("calves", "primary", 4),),
    ),
    (
        "06051513-7d63-4caa-9550-5596c7698938",
        "Donkey Calf Raise",
        "Donkey Calf Raise",
        "bodyweight",
        False,
        (("calves", "primary", 4),),
    ),
    (
        "8c687e8c-aecb-4613-beee-f8f4077ca380",
        "Single-Leg Calf Raise",
        "Single-Leg Calf Raise",
        "bodyweight",
        False,
        (("calves", "primary", 4),),
    ),
    (
        "33f2bd28-d282-4940-abf9-d12fdc8d2fc8",
        "Decline Sit-Up",
        "Decline Sit-Up",
        "bodyweight",
        False,
        (("abs", "primary", 4),),
    ),
    (
        "c0562a00-01dc-4e04-a733-129cba1035d0",
        "Ab Wheel Rollout",
        "Ab Wheel Rollout",
        "bodyweight",
        False,
        (
            ("abs", "primary", 5),
            ("lower_back", "secondary", 2),
        ),
    ),
    (
        "1a147ccc-9a31-4c6d-a023-353106d2d104",
        "Reverse Crunch",
        "Reverse Crunch",
        "bodyweight",
        False,
        (("abs", "primary", 4),),
    ),
    (
        "13c18e12-9652-4382-9d47-540c8bb8cb6c",
        "Cable Woodchop",
        "Cable Woodchop",
        "cable",
        False,
        (
            ("obliques", "primary", 5),
            ("abs", "secondary", 2),
        ),
    ),
    (
        "afa98f1c-63b7-4770-96c3-6cefd0ca475e",
        "Hanging Oblique Raise",
        "Hanging Oblique Raise",
        "bodyweight",
        False,
        (
            ("obliques", "primary", 5),
            ("abs", "secondary", 2),
        ),
    ),
    (
        "7f03fd65-86e2-41ce-8bd3-3c56f3d100df",
        "Landmine Rotation",
        "Landmine Rotation",
        "barbell",
        False,
        (("obliques", "primary", 4),),
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
