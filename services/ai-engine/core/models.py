"""Model access: every model loads lazily on first use and is cached for the process.

Heavy libraries (torch, transformers, kokoro, tensorflow) are imported only inside the
loaders, so the service starts — and /health answers — without them. Tests replace a model
with set_override(name, obj).
"""
import json
import os
import threading
import urllib.request
from pathlib import Path

import numpy as np

from core import config

_lock = threading.Lock()
_cache: dict = {}
_overrides: dict = {}

TTS_RATE = 24000
VOICES = ["af_heart", "af_bella", "af_nicole", "af_sarah", "af_sky", "am_adam", "am_michael"]
EMOTION_LABELS = ["angry", "disgust", "fear", "happy", "neutral", "sad", "surprise"]


class ModelUnavailable(Exception):
    """A model or its library could not be loaded."""


def set_override(name: str, value) -> None:
    """Test hook: replace a model loader's result. None removes the override."""
    if value is None:
        _overrides.pop(name, None)
    else:
        _overrides[name] = value


def _cached(name: str, loader):
    if name in _overrides:
        return _overrides[name]
    if name not in _cache:
        with _lock:
            if name not in _cache:
                try:
                    _cache[name] = loader()
                except ModelUnavailable:
                    raise
                except Exception as exc:  # missing library, download failure, bad weights
                    raise ModelUnavailable(f"{name} model unavailable: {exc}") from exc
    return _cache[name]


def status() -> dict:
    def state(name: str) -> str:
        return "loaded" if name in _cache or name in _overrides else "lazy"

    return {
        "tts": state("tts"),
        "emotion": state("emotion"),
        "whisper": state("whisper"),
        "gaze": state("gaze"),
        "face": state("face") if config.FACE_ANALYSIS_ENABLED else "disabled",
    }


def _prepare_cache_dir() -> None:
    Path(config.MODEL_CACHE_DIR).mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("HF_HOME", config.MODEL_CACHE_DIR)


# ─── Text-to-speech: Kokoro-82M ───

def get_tts():
    """Returns synthesize(text, voice) -> float32 waveform at 24 kHz."""

    def load():
        _prepare_cache_dir()
        from kokoro import KPipeline

        pipeline = KPipeline(lang_code="a")

        def synthesize(text: str, voice: str) -> np.ndarray:
            chunks = [audio for _, _, audio in pipeline(text, voice=voice)]
            if not chunks:
                raise ModelUnavailable("TTS produced no audio")
            return np.concatenate([np.asarray(c, dtype=np.float32) for c in chunks])

        return synthesize

    return _cached("tts", load)


# ─── Speech emotion: Wav2Vec2 classifier ───

def get_emotion():
    """Returns predict(waveform, sr) -> (probabilities, labels)."""

    def load():
        _prepare_cache_dir()
        import torch
        from transformers import Wav2Vec2FeatureExtractor, Wav2Vec2ForSequenceClassification

        extractor = Wav2Vec2FeatureExtractor.from_pretrained(config.EMOTION_MODEL)
        model = Wav2Vec2ForSequenceClassification.from_pretrained(config.EMOTION_MODEL)
        model.eval()
        labels = [model.config.id2label[i] for i in range(len(model.config.id2label))]

        def predict(waveform: np.ndarray, sr: int):
            inputs = extractor(waveform, sampling_rate=sr, return_tensors="pt", padding=True)
            with torch.no_grad():
                logits = model(inputs.input_values).logits
            return torch.nn.functional.softmax(logits, dim=-1)[0].cpu().numpy(), labels

        return predict

    return _cached("emotion", load)


# ─── Optional transcription: Whisper (only when no transcript is supplied) ───

def get_whisper():
    """Returns transcribe(waveform, sr) -> text."""

    def load():
        _prepare_cache_dir()
        from transformers import pipeline

        asr = pipeline("automatic-speech-recognition", model=config.WHISPER_MODEL, device=-1)

        def transcribe(waveform: np.ndarray, sr: int) -> str:
            return (asr({"array": waveform, "sampling_rate": sr}).get("text") or "").strip()

        return transcribe

    return _cached("whisper", load)


# ─── Gaze: MediaPipe face landmarker (downloaded, never committed) ───

def face_landmarker_path() -> str:
    def load():
        _prepare_cache_dir()
        target = Path(config.MODEL_CACHE_DIR) / "face_landmarker.task"
        if not target.is_file():
            tmp = target.with_suffix(".part")
            with urllib.request.urlopen(config.FACE_LANDMARKER_URL, timeout=120) as response, open(tmp, "wb") as out:
                out.write(response.read())
            tmp.replace(target)
        return str(target)

    return _cached("gaze", load)


# ─── Optional facial emotion: Keras model stored at FACE_MODEL_KEY ───

def get_face_emotion():
    """Returns (predict(face_batch) -> probabilities, class_names)."""
    if not config.FACE_ANALYSIS_ENABLED:
        raise ModelUnavailable("Facial emotion analysis is disabled")

    def load():
        _prepare_cache_dir()
        from tensorflow import keras

        from core import storage

        cache = Path(config.MODEL_CACHE_DIR)
        model_file = cache / "face_emotion.h5"
        classes_file = cache / "face_emotion_classes.json"
        for key, target in ((config.FACE_MODEL_KEY, model_file), (config.FACE_CLASSES_KEY, classes_file)):
            if not target.is_file():
                with storage.local_file(key) as src:
                    target.write_bytes(Path(src).read_bytes())
        model = keras.models.load_model(str(model_file))
        class_names = json.loads(classes_file.read_text())  # ordered list of labels

        def predict(face_batch: np.ndarray) -> np.ndarray:
            return model.predict(face_batch, verbose=0)[0]

        return predict, class_names

    return _cached("face", load)
