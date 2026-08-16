"""FastAPI application entrypoint.

Run locally:
    uvicorn app.main:app --reload
Or through Docker Compose:
    docker compose up
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.exceptions import AppError
from app.domains.auth.router import router as auth_router
from app.domains.exercises.router import router as exercises_router
from app.domains.users.router import router as users_router

API_PREFIX = "/api/v1"

app = FastAPI(
    title="BodyTrack API",
    description="Hypertrophy-focused training platform",
    version="0.1.0",
    # Interactive docs are a development aid; keep them off in production.
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
)


@app.exception_handler(AppError)
async def handle_app_error(_: Request, exc: AppError) -> JSONResponse:
    """Turn domain exceptions into HTTP responses.

    Lets the service layer raise NotFoundError / UnauthorizedError / ... and
    stay free of any HTTP concepts.
    """
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


app.include_router(auth_router, prefix=API_PREFIX)
app.include_router(exercises_router, prefix=API_PREFIX)
app.include_router(users_router, prefix=API_PREFIX)


@app.get("/health", tags=["meta"], summary="Liveness probe")
async def health() -> dict[str, str]:
    return {"status": "ok", "environment": settings.ENVIRONMENT}