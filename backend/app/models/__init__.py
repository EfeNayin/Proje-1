"""ORM models.

Every model must be imported here. Alembic reads `Base.metadata` to detect
tables, and a model that is never imported stays invisible to it.
"""

from app.models.base import Base
from app.models.body import BodyMeasurement
from app.models.exercise import Exercise, ExerciseMuscleGroup, MuscleGroup
from app.models.program import Program, TemplateExercise, TemplateSaveRequest, WorkoutTemplate
from app.models.readiness import ReadinessLog
from app.models.user import RefreshToken, User
from app.models.workout import Set, SetSaveRequest, Workout

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
    "SetSaveRequest",
    "TemplateExercise",
    "TemplateSaveRequest",
    "User",
    "Workout",
    "WorkoutTemplate",
]
