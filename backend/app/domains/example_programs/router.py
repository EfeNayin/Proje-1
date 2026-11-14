"""Example-program endpoints: browse, preview, and copy into the caller's programs.

Browsing creates nothing. Only the PUT .../requests/{request_id} writes, and it
replays the original result when the same request id is sent again.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.domains.auth.dependencies import CurrentUser
from app.domains.example_programs import service
from app.domains.example_programs.schemas import ExampleCopyRequest, ExampleDetail, ExampleList
from app.domains.programs.schemas import ProgramDetail

router = APIRouter(tags=["example-programs"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.get("/example-programs", response_model=ExampleList, summary="List the example programs")
async def list_examples(current_user: CurrentUser) -> ExampleList:
    return service.list_examples()


@router.get(
    "/example-programs/{example_id}",
    response_model=ExampleDetail,
    summary="Preview one example program: days, targets and sources",
)
async def get_example(example_id: str, current_user: CurrentUser, db: DbSession) -> ExampleDetail:
    return await service.get_example(db, example_id)


@router.put(
    "/example-programs/requests/{request_id}",
    response_model=ProgramDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Add an example to my programs once (inactive copy) and replay it on retry",
)
async def copy_example(
    request_id: UUID, payload: ExampleCopyRequest, current_user: CurrentUser, db: DbSession
) -> ProgramDetail:
    return await service.copy_example(db, current_user.id, request_id, payload)
