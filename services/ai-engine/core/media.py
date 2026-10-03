"""ffmpeg helpers: join recording parts, decode to mono WAV, measure duration."""
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np

EBML_MAGIC = b"\x1a\x45\xdf\xa3"  # start of a WebM/Matroska file
ANALYSIS_RATE = 16000


class MediaError(Exception):
    pass


def _run(args: list[str], timeout: int = 600) -> subprocess.CompletedProcess:
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        raise MediaError(f"{args[0]} failed: {result.stderr.strip()[-400:]}")
    return result


def duration_ms(path: Path) -> int:
    """Media duration in ms. Browser recordings often lack a duration header, so fall
    back to decoding the whole file and reading ffmpeg's final timestamp."""
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True, timeout=120,
    )
    try:
        return int(round(float(probe.stdout.strip()) * 1000))
    except ValueError:
        pass
    decoded = subprocess.run(["ffmpeg", "-nostdin", "-i", str(path), "-f", "null", "-"], capture_output=True, text=True, timeout=600)
    stamps = re.findall(r"time=(\d+):(\d+):(\d+(?:\.\d+)?)", decoded.stderr)
    if not stamps:
        raise MediaError("Could not determine media duration")
    h, m, s = stamps[-1]
    return int(round((int(h) * 3600 + int(m) * 60 + float(s)) * 1000))


def _starts_with_header(path: Path) -> bool:
    with open(path, "rb") as f:
        return f.read(4) == EBML_MAGIC


def group_into_streams(parts: list[Path]) -> list[list[Path]]:
    """Split parts into recorder streams: a new stream starts at every part with a WebM header.

    MediaRecorder timeslice chunks are byte fragments of one stream (only its first chunk has a
    header). A page reload mid-interview starts a new recorder, so one interview can hold several
    streams. Leading fragments without a header can't be decoded and are dropped.
    """
    streams: list[list[Path]] = []
    for part in parts:
        if _starts_with_header(part):
            streams.append([part])
        elif streams:
            streams[-1].append(part)
    return streams


def concat_parts(parts: list[Path], out_path: Path) -> None:
    """Join recording parts into one file.

    Each recorder stream is joined byte-wise and remuxed (so it gets duration and seek data);
    several streams (separate files, or a reload mid-interview) then go through ffmpeg's concat
    demuxer, re-encoding if their stream parameters differ.
    """
    if not parts:
        raise MediaError("No parts to join")
    streams = group_into_streams(parts)
    if not streams:
        raise MediaError("No part starts with a WebM header")
    suffix = out_path.suffix or ".webm"
    with tempfile.TemporaryDirectory() as tmp:
        remuxed = []
        for i, stream in enumerate(streams):
            raw = Path(tmp) / f"stream{i}-raw{suffix}"
            with open(raw, "wb") as out:
                for part in stream:
                    with open(part, "rb") as src:
                        shutil.copyfileobj(src, out)
            fixed = Path(tmp) / f"stream{i}{suffix}"
            _run(["ffmpeg", "-nostdin", "-y", "-i", str(raw), "-c", "copy", str(fixed)])
            remuxed.append(fixed)
        if len(remuxed) == 1:
            shutil.copyfile(remuxed[0], out_path)
            return
        listing = Path(tmp) / "parts.txt"
        listing.write_text("".join(f"file '{p.resolve().as_posix()}'\n" for p in remuxed))
        joined = Path(tmp) / f"joined{suffix}"
        try:
            _run(["ffmpeg", "-nostdin", "-y", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", str(joined)])
        except MediaError:
            _run(["ffmpeg", "-nostdin", "-y", "-f", "concat", "-safe", "0", "-i", str(listing), str(joined)])
        _run(["ffmpeg", "-nostdin", "-y", "-i", str(joined), "-c", "copy", str(out_path)])


def load_mono(path: Path, rate: int = ANALYSIS_RATE) -> tuple[np.ndarray, int]:
    """Decode any audio/video file to a mono float32 waveform at `rate` Hz."""
    import soundfile as sf

    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "audio.wav"
        _run(["ffmpeg", "-nostdin", "-y", "-i", str(path), "-vn", "-ac", "1", "-ar", str(rate), "-f", "wav", str(wav)])
        y, sr = sf.read(str(wav), dtype="float32")
    if y.ndim > 1:
        y = y.mean(axis=1)
    return y, sr


def slice_ms(y: np.ndarray, sr: int, start_ms: int, end_ms: int) -> np.ndarray:
    start = max(0, int(start_ms * sr / 1000))
    end = min(len(y), int(end_ms * sr / 1000))
    return y[start:end] if end > start else y[0:0]
