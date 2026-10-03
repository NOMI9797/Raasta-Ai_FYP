"""Voice delivery analysis: pauses, pitch stability, filler words and speaking rate.

Pause detection and jitter/shimmer are ported from the earlier interview server, with two
fixes: filler words are counted as whole words (the original substring count treated "also"
as "so"), and the silence threshold also considers the speech level (see detect_pauses).
"""
import functools
import re

import numpy as np

MIN_PAUSE_SEC = 0.2
LONG_PAUSE_SEC = 2.0
# Frames quieter than this fraction of the loud-speech RMS (90th percentile) count as silence
SILENCE_FRACTION = 0.1

FILLERS = {
    "um": ["um", "umm", "ummm"],
    "uh": ["uh", "uhh", "uhhh"],
    "ah": ["ah", "ahh", "ahhh"],
    "hmm": ["hmm", "hmmm", "hm"],
    "like": ["like"],
    "you_know": ["you know", "ya know"],
    "well": ["well"],
    "so": ["so"],
    "actually": ["actually"],
    "er": ["er", "err"],
    "erm": ["erm"],
}
_FILLER_PATTERNS = {
    name: [re.compile(rf"(?<![a-z']){re.escape(v)}(?![a-z'])") for v in variants]
    for name, variants in FILLERS.items()
}


@functools.lru_cache(maxsize=1)
def librosa_available() -> bool:
    """librosa needs numba's compiled extensions, which Windows Smart App Control can block.
    Pitch-based metrics (jitter) need librosa; everything else here works without it."""
    try:
        import librosa

        librosa.feature.rms(y=np.zeros(2048, dtype=np.float32))
        return True
    except Exception:
        return False


def frame_rms(y: np.ndarray, frame_length: int, hop_length: int) -> np.ndarray:
    """Per-frame RMS, same framing as librosa.feature.rms (centred, zero-padded)."""
    if frame_length <= 0 or hop_length <= 0:
        raise ValueError("frame_length and hop_length must be positive")
    padded = np.pad(np.asarray(y, dtype=np.float64), (frame_length // 2, frame_length // 2))
    if len(padded) < frame_length:
        return np.zeros(0)
    frames = np.lib.stride_tricks.sliding_window_view(padded, frame_length)[::hop_length]
    return np.sqrt(np.mean(frames ** 2, axis=1))


def detect_pauses(y: np.ndarray, sr: int, min_pause: float = MIN_PAUSE_SEC) -> dict:
    """RMS-energy pause detection (25 ms frames, 10 ms hop).

    The original threshold was the 10th-percentile RMS alone, which only ever marks the
    quietest 10% of frames as silent: recordings with more silence than that had their pauses
    split into fragments and long pauses missed. The threshold is now the higher of that and
    SILENCE_FRACTION of the loud-speech level (about -20 dB).
    """
    duration = len(y) / sr if sr else 0
    empty = {"pauseCount": 0, "pauseDurations": [], "totalSilenceSec": 0.0, "pauseRatio": 0.0,
             "averagePauseSec": 0.0, "longestPauseSec": 0.0, "longPauses": 0}
    if duration <= 0 or len(y) < int(0.025 * sr):
        return empty

    frame_length = int(0.025 * sr)
    hop_length = int(0.01 * sr)
    rms = frame_rms(y, frame_length, hop_length)
    threshold = max(np.percentile(rms, 10), SILENCE_FRACTION * np.percentile(rms, 90))
    is_silence = rms < threshold

    pauses, in_pause, start = [], False, 0
    for i, silent in enumerate(is_silence):
        if silent and not in_pause:
            start, in_pause = i, True
        elif not silent and in_pause:
            length = (i - start) * hop_length / sr
            if length >= min_pause:
                pauses.append(length)
            in_pause = False
    if in_pause:
        length = (len(is_silence) - start) * hop_length / sr
        if length >= min_pause:
            pauses.append(length)

    total = sum(pauses)
    return {
        "pauseCount": len(pauses),
        "pauseDurations": [round(p, 3) for p in pauses],
        "totalSilenceSec": round(total, 3),
        "pauseRatio": round(total / duration, 4) if duration > 0 else 0.0,
        "averagePauseSec": round(float(np.mean(pauses)), 3) if pauses else 0.0,
        "longestPauseSec": round(max(pauses), 3) if pauses else 0.0,
        "longPauses": sum(1 for p in pauses if p >= LONG_PAUSE_SEC),
    }


def voice_quality(y: np.ndarray, sr: int) -> dict:
    """Jitter (pitch-period variation) and shimmer (amplitude variation), in percent.
    Both null when librosa can't load (they don't feed any score)."""
    none = {"jitter": None, "shimmer": None, "pitchMean": None, "pitchStd": None}
    if len(y) < sr * 0.1 or not librosa_available():
        return none
    import librosa

    f0, _, _ = librosa.pyin(y, fmin=librosa.note_to_hz("C2"), fmax=librosa.note_to_hz("C7"), sr=sr)
    voiced = f0[~np.isnan(f0)]
    if len(voiced) < 2:
        return none
    periods = 1.0 / voiced
    jitter = float(np.std(periods) / np.mean(periods) * 100)

    rms = frame_rms(y, int(0.025 * sr), int(0.01 * sr))
    rms = rms[rms > 0]
    shimmer = float(np.std(rms) / np.mean(rms) * 100) if len(rms) >= 2 else None
    return {
        "jitter": round(jitter, 4) if np.isfinite(jitter) else None,
        "shimmer": round(shimmer, 4) if shimmer is not None and np.isfinite(shimmer) else None,
        "pitchMean": round(float(np.mean(voiced)), 2),
        "pitchStd": round(float(np.std(voiced)), 2),
    }


def count_fillers(text: str | None) -> dict:
    if not text:
        return {"total": 0, "breakdown": {}}
    lower = text.lower()
    breakdown = {}
    for name, patterns in _FILLER_PATTERNS.items():
        n = sum(len(p.findall(lower)) for p in patterns)
        if n:
            breakdown[name] = n
    return {"total": sum(breakdown.values()), "breakdown": breakdown}


def words_per_minute(text: str | None, duration_sec: float, silence_sec: float) -> float | None:
    """Words over speaking time (duration minus detected pauses), as in the original."""
    if not text:
        return None
    speaking = duration_sec - silence_sec
    if speaking <= 0:
        return None
    return round(len(text.split()) / speaking * 60, 2)


def analyze(y: np.ndarray, sr: int, segments: list | None = None, transcript: str | None = None,
            transcribe=None) -> dict:
    """Overall and per-segment voice metrics.

    segments: [{id, startMs, endMs, text?}] — candidate answers. When given, overall metrics
    cover only those spans (the AI's own speech is excluded). Text comes from segment.text,
    then `transcript`, then `transcribe(y, sr)` if provided; without text, WPM and fillers are null.
    """
    from core.media import slice_ms

    segments = segments or []
    pieces = [slice_ms(y, sr, s["startMs"], s["endMs"]) for s in segments]
    if segments:
        non_empty = [p for p in pieces if len(p)]
        speech = np.concatenate(non_empty) if non_empty else y[0:0]
    else:
        speech = y
    duration = len(speech) / sr if sr else 0

    text = " ".join(s.get("text") or "" for s in segments).strip() or (transcript or "").strip() or None
    if text is None and transcribe is not None and duration > 0:
        try:
            text = transcribe(speech, sr) or None
        except Exception:
            text = None  # transcription is optional; keep the acoustic metrics

    pauses = detect_pauses(speech, sr)
    quality = voice_quality(speech, sr)
    fillers = count_fillers(text)
    minutes = duration / 60 if duration > 0 else 0
    top = sorted(fillers["breakdown"].items(), key=lambda kv: -kv[1])[:3]

    overall = {
        "durationSec": round(duration, 2),
        "wpm": words_per_minute(text, duration, pauses["totalSilenceSec"]),
        "pauseRatio": pauses["pauseRatio"],
        "pauseCount": pauses["pauseCount"],
        "longPauses": pauses["longPauses"],
        "longestPauseSec": pauses["longestPauseSec"],
        "fillerPerMin": round(fillers["total"] / minutes, 2) if text and minutes > 0 else None,
        "fillerTop": [name for name, _ in top],
        "jitter": quality["jitter"],
        "shimmer": quality["shimmer"],
        "pitchMean": quality["pitchMean"],
        "hasTranscript": text is not None,
    }

    per_segment = []
    for seg, piece in zip(segments, pieces, strict=True):
        seg_duration = len(piece) / sr if sr else 0
        seg_pauses = detect_pauses(piece, sr)
        seg_text = seg.get("text") or None
        per_segment.append({
            "id": seg.get("id"),
            "durationSec": round(seg_duration, 2),
            "wpm": words_per_minute(seg_text, seg_duration, seg_pauses["totalSilenceSec"]),
            "fillerCount": count_fillers(seg_text)["total"] if seg_text else None,
            "pauseRatio": seg_pauses["pauseRatio"],
        })
    return {"overall": overall, "segments": per_segment}
