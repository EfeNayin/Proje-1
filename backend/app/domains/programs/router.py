"""Program, template and template-exercise endpoints.

Templates and their exercises are addressed directly by their own id
(/templates/{id}), not nested under their program — the same shape sets use
under /workouts/{id}/sets, except here ownership is proven by joining
through the parent program rather than by the URL nesting itself.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.domains.auth.dependencies import CurrentUser
from app.domains.programs import service
from app.domains.programs.schemas import (
    ProgramCreate,
    ProgramDetail,
    ProgramSummary,
    ProgramUpdate,
    TemplateExercisesSet,
    TemplateStart,
    WorkoutTemplateCreate,
    WorkoutTemplateRead,
    WorkoutTemplateUpdate,
    WorkoutTemplateWithExercisesCreate,
)

router = APIRouter(tags=["programs"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.post(
    "/programs",
    response_model=ProgramDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Create a program (becomes the active one)",
)
async def create_program(
    payload: ProgramCreate, current_user: CurrentUser, db: DbSession
) -> ProgramDetail:
    return await service.create_program(db, current_user.id, payload)


@router.get("/programs", response_model=list[ProgramSummary], summary="List your programs")
async def list_programs(current_user: CurrentUser, db: DbSession) -> list[ProgramSummary]:
    return await service.list_programs(db, current_user.id)


@router.get(
    "/programs/{program_id}",
    response_model=ProgramDetail,
    summary="Get one program with its templates and their exercise targets",
)
async def get_program(program_id: UUID, current_user: CurrentUser, db: DbSession) -> ProgramDetail:
    return await service.get_program(db, current_user.id, program_id)


@router.patch(
    "/programs/{program_id}",
    response_model=ProgramDetail,
    summary="Rename a program or edit its notes",
)
async def update_program(
    program_id: UUID, payload: ProgramUpdate, current_user: CurrentUser, db: DbSession
) -> ProgramDetail:
    return await service.update_program(db, current_user.id, program_id, payload)


@router.post(
    "/programs/{program_id}/activate",
    response_model=ProgramDetail,
    summary="Make this the active program, deactivating whatever was active",
)
async def activate_program(
    program_id: UUID, current_user: CurrentUser, db: DbSession
) -> ProgramDetail:
    return await service.activate_program(db, current_user.id, program_id)


@router.delete(
    "/programs/{program_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a program and its templates",
)
async def delete_program(program_id: UUID, current_user: CurrentUser, db: DbSession) -> None:
    await service.delete_program(db, current_user.id, program_id)


@router.post(
    "/programs/{program_id}/templates",
    response_model=WorkoutTemplateRead,
    status_code=status.HTTP_201_CREATED,
    summary="Add a template (a training day) to a program",
)
async def create_template(
    program_id: UUID,
    payload: WorkoutTemplateCreate,
    current_user: CurrentUser,
    db: DbSession,
) -> WorkoutTemplateRead:
    return await service.create_template(db, current_user.id, program_id, payload)


@router.post(
    "/programs/{program_id}/templates/with-exercises",
    response_model=WorkoutTemplateRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a template and all exercise targets atomically",
)
async def create_template_with_exercises(
    program_id: UUID,
    payload: WorkoutTemplateWithExercisesCreate,
    current_user: CurrentUser,
    db: DbSession,
) -> WorkoutTemplateRead:
    return await service.create_template_with_exercises(db, current_user.id, program_id, payload)


@router.put(
    "/programs/{program_id}/templates/requests/{request_id}",
    response_model=WorkoutTemplateRead,
    status_code=status.HTTP_201_CREATED,
    summary="Save a template once and replay the result on retry",
)
async def save_template_once(
    program_id: UUID,
    request_id: UUID,
    payload: WorkoutTemplateWithExercisesCreate,
    current_user: CurrentUser,
    db: DbSession,
) -> WorkoutTemplateRead:
    return await service.create_template_with_exercises(
        db, current_user.id, program_id, payload, request_id=request_id
    )


@router.get(
    "/templates/{template_id}",
    response_model=WorkoutTemplateRead,
    summary="Get one template with its exercise targets",
)
async def get_template(
    template_id: UUID, current_user: CurrentUser, db: DbSession
) -> WorkoutTemplateRead:
    return await service.get_template(db, current_user.id, template_id)


@router.patch(
    "/templates/{template_id}",
    response_model=WorkoutTemplateRead,
    summary="Rename, reorder or edit notes on a template",
)
async def update_template(
    template_id: UUID,
    payload: WorkoutTemplateUpdate,
    current_user: CurrentUser,
    db: DbSession,
) -> WorkoutTemplateRead:
    return await service.update_template(db, current_user.id, template_id, payload)


@router.delete(
    "/templates/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a template",
)
async def delete_template(template_id: UUID, current_user: CurrentUser, db: DbSession) -> None:
    await service.delete_template(db, current_user.id, template_id)


@router.put(
    "/templates/{template_id}/exercises",
    response_model=WorkoutTemplateRead,
    summary="Replace every exercise and its targets in one request",
)
async def set_template_exercises(
    template_id: UUID,
    payload: TemplateExercisesSet,
    current_user: CurrentUser,
    db: DbSession,
) -> WorkoutTemplateRead:
    return await service.set_template_exercises(db, current_user.id, template_id, payload)


@router.post(
    "/templates/{template_id}/start",
    response_model=TemplateStart,
    status_code=status.HTTP_201_CREATED,
    summary="Start an empty workout linked to this template",
)
async def start_workout_from_template(
    template_id: UUID, current_user: CurrentUser, db: DbSession
) -> TemplateStart:
    return await service.start_workout_from_template(db, current_user.id, template_id)
