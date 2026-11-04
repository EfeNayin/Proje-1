"""FastAPI application entrypoint.

Run locally:
    uvicorn app.main:app --reload
Or through Docker Compose:
    docker compose up
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.dberrors import references_missing_user
from app.core.exceptions import AppError
from app.core.ratelimit import Limiter, close_rate_limiter
from app.core.readiness import is_ready
from app.domains.analytics.router import router as analytics_router
from app.domains.auth.router import router as auth_router
from app.domains.body.router import router as body_router
from app.domains.coaching.router import router as coaching_router
from app.domains.exercises.router import router as exercises_router
from app.domains.nutrition.router import router as nutrition_router
from app.domains.programs.router import router as programs_router
from app.domains.readiness.router import router as readiness_router
from app.domains.research.router import router as research_router
from app.domains.users.router import router as users_router
from app.domains.workouts.router import router as workouts_router

API_PREFIX = "/api/v1"

@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    await close_rate_limiter()


app = FastAPI(
    lifespan=lifespan,
    title="BodyTrack API",
    description="Hypertrophy-focused training platform",
    version="0.1.0",
    # Interactive docs are a development aid; keep them off anywhere but development
    # (a hosted staging service is reachable by anyone who has its address).
    docs_url="/docs" if settings.is_development else None,
    redoc_url="/redoc" if settings.is_development else None,
    openapi_url="/openapi.json" if settings.is_development else None,
)


@app.exception_handler(AppError)
async def handle_app_error(_: Request, exc: AppError) -> JSONResponse:
    """Turn domain exceptions into HTTP responses.

    Lets the service layer raise NotFoundError / UnauthorizedError / ... and
    stay free of any HTTP concepts.
    """
    return JSONResponse(
        status_code=exc.status_code, content={"detail": exc.detail}, headers=exc.headers
    )


@app.exception_handler(RequestValidationError)
async def handle_validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    """FastAPI's default 422, minus the submitted values.

    The default answer echoes each rejected value back (`input`). For a password field
    that would return the password, and a body that is not an object returns the whole
    body. Where the problem is (`loc`) and what it is (`msg`, `type`) is all a client
    needs.
    """
    errors = [
        {key: value for key, value in error.items() if key != "input"} for error in exc.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(errors)})


@app.exception_handler(IntegrityError)
async def handle_integrity_error(_: Request, exc: IntegrityError) -> JSONResponse:
    """A write for an account that was deleted while the request ran is a plain 401.

    The row names a user id that no longer exists (the account deletion committed
    first, and nothing is stored). Any other integrity error is not handled here and
    stays the server error it always was.
    """
    if references_missing_user(exc):
        return JSONResponse(
            status_code=401, content={"detail": "Invalid or expired access token"}
        )
    raise exc


app.include_router(analytics_router, prefix=API_PREFIX)
app.include_router(auth_router, prefix=API_PREFIX)
app.include_router(body_router, prefix=API_PREFIX)
app.include_router(coaching_router, prefix=API_PREFIX)
app.include_router(exercises_router, prefix=API_PREFIX)
app.include_router(nutrition_router, prefix=API_PREFIX)
app.include_router(programs_router, prefix=API_PREFIX)
app.include_router(readiness_router, prefix=API_PREFIX)
app.include_router(research_router, prefix=API_PREFIX)
app.include_router(users_router, prefix=API_PREFIX)
app.include_router(workouts_router, prefix=API_PREFIX)


@app.get("/health", tags=["meta"], summary="Liveness probe")
async def health() -> dict[str, str]:
    return {"status": "ok", "environment": settings.ENVIRONMENT}


@app.get(
    "/health/ready",
    tags=["meta"],
    summary="Readiness probe (database and Redis)",
    responses={503: {"description": "A dependency did not answer in time"}},
)
async def ready(
    response: Response, db: Annotated[AsyncSession, Depends(get_db)], limiter: Limiter
) -> dict[str, str]:
    """200 when both the database and Redis answer, 503 otherwise. No detail either way."""
    response.headers["Cache-Control"] = "no-store"
    if await is_ready(db, limiter):
        return {"status": "ready"}
    response.status_code = 503
    return {"status": "unavailable"}
