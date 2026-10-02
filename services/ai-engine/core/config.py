"""Environment settings for the AI engine (docs/ai-hiring/14-ai-engine.md)."""
import os


def _flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


AI_ENGINE_TOKEN = os.getenv("AI_ENGINE_TOKEN", "")
STORAGE_DRIVER = os.getenv("STORAGE_DRIVER", "local")
STORAGE_LOCAL_DIR = os.getenv("STORAGE_LOCAL_DIR", "./.storage")
MODEL_CACHE_DIR = os.getenv("MODEL_CACHE_DIR", "/models")
FACE_ANALYSIS_ENABLED = _flag("FACE_ANALYSIS_ENABLED")
TTS_VOICE = os.getenv("TTS_VOICE", "am_michael")
