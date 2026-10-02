"""Raasta-AI AI engine: speech synthesis and media analysis (docs/ai-hiring/14-ai-engine.md).

Phase 0 skeleton: /health plus the bearer-token dependency every other route uses.
Run: uvicorn main:app --port 8000
"""
import secrets

from fastapi import APIRouter, Depends, FastAPI, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from core import config

app = FastAPI(title="Raasta-AI AI Engine", version="0.1.0")

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
    # Models load lazily on first use (added in Phase 4)
    return {
        "ok": True,
        "models": {
            "tts": "lazy",
            "emotion": "lazy",
            "whisper": "lazy",
            "gaze": "lazy",
            "face": "lazy" if config.FACE_ANALYSIS_ENABLED else "disabled",
        },
    }


# All feature routers (tts, voice, emotion, gaze, face, media) mount here in Phase 4
protected = APIRouter(dependencies=[Depends(require_token)])


@protected.get("/auth/check")
def auth_check() -> dict:
    """Lets the engine and worker confirm their AI_ENGINE_TOKEN is accepted."""
    return {"ok": True}


app.include_router(protected)
