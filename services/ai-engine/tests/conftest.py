"""Shared test setup: isolated storage folder, model cache and auth token.

Environment variables are set before main/config are imported.
"""
import os
import shutil
import subprocess
import tempfile
import urllib.request
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
RECORDING = ROOT / "tests" / "fixtures" / "interview" / "recording"
_STORAGE = Path(tempfile.mkdtemp(prefix="ai-engine-storage-"))
_MODELS = Path(os.environ.get("TEST_MODEL_CACHE_DIR") or tempfile.mkdtemp(prefix="ai-engine-models-"))

os.environ.update({
    "AI_ENGINE_TOKEN": "test-token-123",
    "STORAGE_DRIVER": "local",
    "STORAGE_LOCAL_DIR": str(_STORAGE),
    "MODEL_CACHE_DIR": str(_MODELS),
    "FACE_ANALYSIS_ENABLED": "false",
})

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from core import config, models  # noqa: E402

AUTH = {"Authorization": "Bearer test-token-123"}
PORTRAIT_URL = "https://storage.googleapis.com/mediapipe-assets/portrait.jpg"


@pytest.fixture(scope="session")
def client():
    return TestClient(main.app)


@pytest.fixture(scope="session", autouse=True)
def stored_recording():
    """The fixture recording as storage keys recordings/test-1/{audio,video}.webm."""
    target = _STORAGE / "recordings" / "test-1"
    target.mkdir(parents=True, exist_ok=True)
    shutil.copy(RECORDING / "audio.webm", target / "audio.webm")
    shutil.copy(RECORDING / "video.webm", target / "video.webm")
    yield {"audio": "recordings/test-1/audio.webm", "video": "recordings/test-1/video.webm"}
    shutil.rmtree(_STORAGE, ignore_errors=True)


@pytest.fixture
def storage_dir():
    return _STORAGE


@pytest.fixture(autouse=True)
def reset_overrides():
    yield
    for name in ("tts", "emotion", "whisper", "face"):
        models.set_override(name, None)
    config.FACE_ANALYSIS_ENABLED = False


@pytest.fixture(scope="session")
def face_landmarker():
    """Downloads the MediaPipe face landmarker once; skips when offline."""
    try:
        return models.face_landmarker_path()
    except models.ModelUnavailable as exc:
        pytest.skip(f"face landmarker download unavailable: {exc}")


@pytest.fixture(scope="session")
def portrait_video_key():
    """A 3 s video of MediaPipe's public sample portrait (downloaded at test time, never committed)."""
    target = _STORAGE / "recordings" / "portrait" / "video.webm"
    target.parent.mkdir(parents=True, exist_ok=True)
    image = target.parent / "portrait.jpg"
    try:
        with urllib.request.urlopen(PORTRAIT_URL, timeout=60) as response:
            image.write_bytes(response.read())
    except Exception as exc:
        pytest.skip(f"sample portrait unavailable: {exc}")
    subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-loop", "1", "-i", str(image), "-t", "3",
         "-r", "10", "-vf", "scale=640:-2", "-c:v", "libvpx", "-b:v", "500k", str(target)],
        check=True,
    )
    return "recordings/portrait/video.webm"
