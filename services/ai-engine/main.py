"""Raasta-AI AI engine: speech synthesis and media analysis (docs/ai-hiring/14-ai-engine.md).

Run: uvicorn main:app --port 8000
Every route except /health needs `Authorization: Bearer ${AI_ENGINE_TOKEN}`.
Handlers are plain `def`, so FastAPI runs them in its thread pool and a long analysis
doesn't block /tts.
"""
import logging
import secrets

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from core import config, models
from core.media import MediaError
from core.storage import StorageError, StorageNotFound
from routers import emotion, face, gaze, media, tts, voice

log = logging.getLogger("ai-engine")

app = FastAPI(title="Raasta-AI AI Engine", version="0.2.0")

_bearer = HTTPBearer(auto_error=False)


def require_token(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> None:
    """Every route except /health requires `Authorization: Bearer ${AI_ENGINE_TOKEN}`."""
    if not config.AI_ENGINE_TOKEN:
        # Fail closed: an unset token must never mean "no auth"
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "AI_ENGINE_TOKEN is not configured")
    if credentials is None or not secrets.compare_digest(credentials.credentials, config.AI_ENGINE_TOKEN):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or missing token")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "models": models.status()}


# ─── Errors from the core modules → HTTP status codes ───

@app.exception_handler(StorageNotFound)
def _not_found(_: Request, exc: StorageNotFound):
    return JSONResponse(status_code=404, content={"detail": "Object not found in storage"})


@app.exception_handler(StorageError)
def _bad_key(_: Request, exc: StorageError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(models.ModelUnavailable)
def _model_unavailable(_: Request, exc: models.ModelUnavailable):
    log.error("Model unavailable: %s", exc)
    return JSONResponse(status_code=503, content={"detail": "Model unavailable", "error": str(exc)[:300]})


@app.exception_handler(MediaError)
def _media_error(_: Request, exc: MediaError):
    return JSONResponse(status_code=422, content={"detail": "Could not process media", "error": str(exc)[:300]})


# ─── Routers (ENABLED_ROUTERS can split TTS and analysis into separate containers) ───

ROUTERS = {"tts": tts, "media": media, "voice": voice, "emotion": emotion, "gaze": gaze, "face": face}

protected = APIRouter(dependencies=[Depends(require_token)])


@protected.get("/auth/check")
def auth_check() -> dict:
    """Lets the engine and worker confirm their AI_ENGINE_TOKEN is accepted."""
    return {"ok": True}


for name, module in ROUTERS.items():
    if not config.ENABLED_ROUTERS or name in config.ENABLED_ROUTERS:
        protected.include_router(module.router)

app.include_router(protected)
