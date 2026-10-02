"""Environment settings for the AI engine (docs/ai-hiring/14-ai-engine.md)."""
import os


def _flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


AI_ENGINE_TOKEN = os.getenv("AI_ENGINE_TOKEN", "")

# Storage: same keys and local folder as the Node services (libs/hiring/storage.js)
STORAGE_DRIVER = os.getenv("STORAGE_DRIVER", "local").lower()
STORAGE_LOCAL_DIR = os.getenv("STORAGE_LOCAL_DIR", "./.storage")
S3_BUCKET = os.getenv("S3_BUCKET", "")
S3_REGION = os.getenv("S3_REGION", "auto")
S3_ENDPOINT = os.getenv("S3_ENDPOINT") or None
S3_ACCESS_KEY_ID = os.getenv("S3_ACCESS_KEY_ID") or None
S3_SECRET_ACCESS_KEY = os.getenv("S3_SECRET_ACCESS_KEY") or None

# Models
MODEL_CACHE_DIR = os.getenv("MODEL_CACHE_DIR", "/models")
TTS_VOICE = os.getenv("TTS_VOICE", "am_michael")
EMOTION_MODEL = os.getenv("EMOTION_MODEL", "r-f/wav2vec-english-speech-emotion-recognition")
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "openai/whisper-base")
FACE_ANALYSIS_ENABLED = _flag("FACE_ANALYSIS_ENABLED")
FACE_MODEL_KEY = os.getenv("FACE_MODEL_KEY", "models/face_emotion.h5")
FACE_CLASSES_KEY = os.getenv("FACE_CLASSES_KEY", "models/face_emotion_classes.json")
FACE_LANDMARKER_URL = os.getenv(
    "FACE_LANDMARKER_URL",
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
)

# Comma-separated router names to mount (tts,voice,emotion,gaze,face,media); empty = all
ENABLED_ROUTERS = [r.strip() for r in os.getenv("ENABLED_ROUTERS", "").split(",") if r.strip()]
