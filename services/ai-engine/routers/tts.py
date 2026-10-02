"""POST /tts — text to speech with Kokoro-82M (24 kHz mono WAV)."""
import io
from typing import Optional

import soundfile as sf
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from core import config, models

router = APIRouter(tags=["tts"])


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=600)
    voice: Optional[str] = None


@router.post("/tts")
def synthesize(request: TtsRequest):
    text = request.text.strip()
    if not text:
        raise HTTPException(400, "text is required")
    voice = request.voice or config.TTS_VOICE
    if voice not in models.VOICES:
        raise HTTPException(400, f"Unknown voice. Choose from: {', '.join(models.VOICES)}")

    audio = models.get_tts()(text, voice)
    buffer = io.BytesIO()
    sf.write(buffer, audio, models.TTS_RATE, format="WAV", subtype="PCM_16")
    duration_ms = int(round(len(audio) / models.TTS_RATE * 1000))
    return Response(content=buffer.getvalue(), media_type="audio/wav", headers={"X-Audio-Duration-Ms": str(duration_ms)})
