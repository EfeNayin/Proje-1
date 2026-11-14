"""Add direct-work options for the five uncovered muscle groups.

Revision ID: c6a42e8b91df
Revises: 9d30c8f721ab
"""

import sqlalchemy as sa

from alembic import op

revision: str = "c6a42e8b91df"
down_revision: str | None = "9d30c8f721ab"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

# Fixed identities: rollback must never match a user's exercise by name.
EXERCISES = (
    ("670ce4cd-34be-4ab9-bf34-221d55fe4101", "Crunch", "Karın Sıkıştırma", "bodyweight", "abs"),
    (
        "670ce4cd-34be-4ab9-bf34-221d55fe4102",
        "Dumbbell Side Bend",
        "Dambıl Yan Eğilme",
        "dumbbell",
        "obliques",
    ),
    (
        "670ce4cd-34be-4ab9-bf34-221d55fe4103",
        "Dumbbell Wrist Curl",
        "Dambıl Bilek Bükme",
        "dumbbell",
        "forearms",
    ),
    (
        "670ce4cd-34be-4ab9-bf34-221d55fe4104",
        "Dumbbell Reverse Fly",
        "Dambıl Ters Açış",
        "dumbbell",
        "rear_delts",
    ),
    (
        "670ce4cd-34be-4ab9-bf34-221d55fe4105",
        "Dumbbell Shrug",
        "Dambıl Omuz Silkme",
        "dumbbell",
        "traps",
    ),
)


def upgrade() -> None:
    connection = op.get_bind()
    for exercise_id, name, name_tr, equipment, muscle in EXERCISES:
        connection.execute(
            sa.text("""
                INSERT INTO exercises (id, name, name_tr, equipment, is_compound, created_by)
                VALUES (CAST(:id AS uuid), :name, :name_tr, :equipment, false, NULL)
            """),
            {"id": exercise_id, "name": name, "name_tr": name_tr, "equipment": equipment},
        )
        # Scalar subquery fails on a missing muscle instead of silently losing its link.
        # 4 is an editorial catalogue rating, not a measured effect or set multiplier.
        connection.execute(
            sa.text("""
                INSERT INTO exercise_muscle_groups
                    (exercise_id, muscle_group_id, role, effectiveness)
                VALUES (CAST(:id AS uuid),
                        (SELECT id FROM muscle_groups WHERE name = :muscle), 'primary', 4)
            """),
            {"id": exercise_id, "muscle": muscle},
        )


def downgrade() -> None:
    # One atomic statement. Existing RESTRICT FKs refuse rollback if a workout
    # set or program template uses any added exercise; user history is never deleted.
    exercises = sa.table("exercises", sa.column("id", sa.Uuid()))
    op.get_bind().execute(
        exercises.delete().where(exercises.c.id.in_([row[0] for row in EXERCISES]))
    )
