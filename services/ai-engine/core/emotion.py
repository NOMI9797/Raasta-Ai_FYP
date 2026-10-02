"""Speech emotion over a recording, per candidate segment and overall.

Ported chunking: long audio is split into 12 s windows (single long forward passes ran out
of memory), windows shorter than 0.4 s are skipped, and window probabilities are averaged.
Segments are aggregated weighted by their duration.
"""
import numpy as np

from core.media import slice_ms

CHUNK_SEC = 12.0
MIN_CHUNK_SEC = 0.4


def segment_probs(waveform: np.ndarray, sr: int, predict) -> tuple[np.ndarray, list] | None:
    """Average class probabilities over 12 s windows. None if the audio is too short."""
    chunk = int(CHUNK_SEC * sr)
    min_len = int(MIN_CHUNK_SEC * sr)
    if len(waveform) < min_len:
        return None
    if len(waveform) <= chunk:
        return predict(waveform, sr)
    probs, labels = [], None
    for start in range(0, len(waveform), chunk):
        window = waveform[start:start + chunk]
        if len(window) < min_len:
            continue
        p, labels = predict(window, sr)
        probs.append(p)
    return np.mean(probs, axis=0), labels


def analyze(y: np.ndarray, sr: int, predict, segments: list | None = None) -> dict:
    """segments: [{id, startMs, endMs}]; without segments the whole recording is one segment."""
    spans = segments or [{"id": None, "startMs": 0, "endMs": int(len(y) * 1000 / sr)}]
    per_segment, weighted, total_weight, labels = [], None, 0.0, None

    for seg in spans:
        piece = slice_ms(y, sr, seg["startMs"], seg["endMs"])
        result = segment_probs(piece, sr, predict)
        if result is None:
            per_segment.append({"id": seg.get("id"), "emotion": None, "confidence": None})
            continue
        probs, labels = np.asarray(result[0], dtype=float), result[1]
        top = int(np.argmax(probs))
        per_segment.append({"id": seg.get("id"), "emotion": labels[top], "confidence": round(float(probs[top]), 4)})
        weight = len(piece) / sr
        weighted = probs * weight if weighted is None else weighted + probs * weight
        total_weight += weight

    if weighted is None or total_weight <= 0:
        return {"dominant": None, "distribution": {}, "confidenceAvg": None, "segments": per_segment}

    mean = weighted / total_weight
    confidences = [s["confidence"] for s in per_segment if s["confidence"] is not None]
    return {
        "dominant": labels[int(np.argmax(mean))],
        "distribution": {label: round(float(p), 4) for label, p in zip(labels, mean, strict=True)},
        "confidenceAvg": round(float(np.mean(confidences)), 4),
        "segments": per_segment if segments else [],
    }
