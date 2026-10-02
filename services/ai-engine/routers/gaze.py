"""POST /analyze/gaze — eye contact and attention from the interview video."""
from fastapi import APIRouter
from pydantic import BaseModel, Field

from core import gaze, models, storage

router = APIRouter(tags=["analysis"])


class GazeRequest(BaseModel):
    videoKey: str = Field(min_length=1, max_length=512)
    sampleFps: float = Field(default=1.0, gt=0, le=30)
    maxFrames: int = Field(default=0, ge=0)


@router.post("/analyze/gaze")
def analyze_gaze(request: GazeRequest):
    model_path = models.face_landmarker_path()
    with storage.local_file(request.videoKey) as path:
        return gaze.analyze_video(str(path), model_path, sample_fps=request.sampleFps, max_frames=request.maxFrames)
