"""ORM models.

Every model must be imported here. Alembic reads `Base.metadata` to detect
tables, and a model that is never imported stays invisible to it.
"""

from app.models.base import Base
from app.models.body import BodyMeasurement
from app.models.exercise import Exercise, ExerciseMuscleGroup, MuscleGroup
from app.models.program import Program, TemplateExercise, WorkoutTemplate
from app.models.readiness import ReadinessLog
from app.models.user import RefreshToken, User
from app.models.workout import Set, Workout

__all__ = [
    "Base",
    "BodyMeasurement",
    "Exercise",
    "ExerciseMuscleGroup",
    "MuscleGroup",
    "Program",
    "ReadinessLog",
    "RefreshToken",
    "Set",
    "TemplateExercise",
    "User",
    "Workout",
    "WorkoutTemplate",
]
