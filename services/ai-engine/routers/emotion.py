"""POST /analyze/emotion — speech emotion per candidate segment and overall."""
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from core import emotion, media, models, storage
from routers.schemas import Segment

router = APIRouter(tags=["analysis"])


class EmotionRequest(BaseModel):
    audioKey: str = Field(min_length=1, max_length=512)
    segments: Optional[list[Segment]] = None


@router.post("/analyze/emotion")
def analyze_emotion(request: EmotionRequest):
    predict = models.get_emotion()
    with storage.local_file(request.audioKey) as path:
        y, sr = media.load_mono(path)
    segments = [s.model_dump() for s in request.segments] if request.segments else None
    return emotion.analyze(y, sr, predict, segments=segments)
