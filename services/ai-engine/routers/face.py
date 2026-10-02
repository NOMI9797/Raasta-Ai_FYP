"""POST /analyze/face — optional facial emotion (TensorFlow); 501 unless FACE_ANALYSIS_ENABLED.

Ported from the earlier video-analysis script: Haar-cascade face detection on sampled frames,
128x128 RGB crops scaled to [0, 1], one prediction per detected face, counts aggregated.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core import config, models, storage

router = APIRouter(tags=["analysis"])

IMG_SIZE = (128, 128)


class FaceRequest(BaseModel):
    videoKey: str = Field(min_length=1, max_length=512)
    sampleFps: float = Field(default=1.0, gt=0, le=30)


def analyze_faces(video_path: str, predict, class_names: list[str], sample_fps: float) -> dict:
    import cv2
    import numpy as np

    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    if cascade.empty():
        raise RuntimeError("Could not load face detector")
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError("Cannot open video")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    if fps <= 0 or fps > 1000:
        fps = 30.0
    interval = max(1, int(round(fps / sample_fps)))

    counts = {name: 0 for name in class_names}
    faces_total, index = 0, 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if index % interval == 0:
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                for (x, y, w, h) in cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30)):
                    roi = frame[y:y + h, x:x + w]
                    if roi.size == 0:
                        continue
                    rgb = cv2.cvtColor(cv2.resize(roi, IMG_SIZE), cv2.COLOR_BGR2RGB).astype("float32") / 255.0
                    probs = predict(np.expand_dims(rgb, axis=0))
                    counts[class_names[int(np.argmax(probs))]] += 1
                    faces_total += 1
            index += 1
    finally:
        cap.release()

    if not faces_total:
        return {"dominant": None, "distribution": {}, "facesAnalyzed": 0}
    return {
        "dominant": max(counts, key=counts.get),
        "distribution": {k: round(v / faces_total, 4) for k, v in counts.items()},
        "facesAnalyzed": faces_total,
    }


@router.post("/analyze/face")
def analyze_face(request: FaceRequest):
    if not config.FACE_ANALYSIS_ENABLED:
        raise HTTPException(501, "Facial emotion analysis is disabled (FACE_ANALYSIS_ENABLED=false)")
    predict, class_names = models.get_face_emotion()
    with storage.local_file(request.videoKey) as path:
        return analyze_faces(str(path), predict, class_names, request.sampleFps)
