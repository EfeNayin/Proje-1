"""ORM models.

Every model must be imported here. Alembic reads `Base.metadata` to detect
tables, and a model that is never imported stays invisible to it.
"""

from app.models.base import Base
from app.models.body import BodyMeasurement
from app.models.coaching import (
    CoachAthleteLink,
    CoachInvite,
    ProgramLineage,
    ProgramOffer,
    WorkoutFeedback,
)
from app.models.exercise import Exercise, ExerciseMuscleGroup, MuscleGroup
from app.models.identity import SocialNonce, SocialSignupChallenge, UserIdentity
from app.models.program import (
    ExampleProgramCopyRequest,
    Program,
    TemplateExercise,
    TemplateSaveRequest,
    WorkoutTemplate,
)
from app.models.readiness import ReadinessLog
from app.models.recovery import PasswordResetChallenge
from app.models.user import RefreshToken, User
from app.models.workout import Set, SetSaveRequest, Workout

__all__ = [
    "Base",
    "BodyMeasurement",
    "CoachAthleteLink",
    "CoachInvite",
    "ExampleProgramCopyRequest",
    "Exercise",
    "ExerciseMuscleGroup",
    "MuscleGroup",
    "PasswordResetChallenge",
    "Program",
    "ProgramLineage",
    "ProgramOffer",
    "ReadinessLog",
    "RefreshToken",
    "Set",
    "SetSaveRequest",
    "SocialNonce",
    "SocialSignupChallenge",
    "TemplateExercise",
    "TemplateSaveRequest",
    "User",
    "UserIdentity",
    "Workout",
    "WorkoutFeedback",
    "WorkoutTemplate",
]
