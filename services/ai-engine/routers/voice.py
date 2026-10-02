"""POST /analyze/voice — pace, pauses, filler words and voice stability."""
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from core import media, models, storage, voice
from routers.schemas import Segment

router = APIRouter(tags=["analysis"])


class VoiceRequest(BaseModel):
    audioKey: str = Field(min_length=1, max_length=512)
    segments: Optional[list[Segment]] = None
    # Candidate answer text (e.g. from interview_turns); avoids re-transcribing for fillers/WPM
    transcript: Optional[str] = Field(default=None, max_length=200000)


def _optional_transcriber():
    try:
        return models.get_whisper()
    except models.ModelUnavailable:
        return None


@router.post("/analyze/voice")
def analyze_voice(request: VoiceRequest):
    with storage.local_file(request.audioKey) as path:
        y, sr = media.load_mono(path)
    segments = [s.model_dump() for s in request.segments] if request.segments else []
    has_text = bool(request.transcript) or any(s.get("text") for s in segments)
    return voice.analyze(
        y, sr, segments=segments, transcript=request.transcript,
        transcribe=None if has_text else _optional_transcriber(),
    )
