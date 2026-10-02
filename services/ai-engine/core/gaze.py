"""Eye-gaze analysis with the MediaPipe face landmarker (iris position within each eye).

Ported from the earlier interview server: same landmark indices, thresholds, eye-contact and
attention formulas, and looking-away segments. Timeline directions are reported in the doc 14
set: center, left, right, up, down, no_face.
"""
import numpy as np

# Landmark indices (MediaPipe face mesh with iris refinement)
LEFT_EYE_IRIS = [468, 469, 470, 471, 472]
LEFT_EYE_INNER, LEFT_EYE_OUTER, LEFT_EYE_TOP, LEFT_EYE_BOTTOM = 362, 263, 386, 374
RIGHT_EYE_IRIS = [473, 474, 475, 476, 477]
RIGHT_EYE_INNER, RIGHT_EYE_OUTER, RIGHT_EYE_TOP, RIGHT_EYE_BOTTOM = 133, 33, 159, 145

HORIZONTAL_THRESHOLD = 0.30
VERTICAL_THRESHOLD = 0.25
LOOKING_AWAY_THRESHOLD = 0.45


def iris_ratio(iris, inner, outer, top, bottom, landmarks, width, height):
    """Iris centre within the eye box; (0.5, 0.5) is centred. (None, None) if unavailable."""
    if len(landmarks) <= max(max(iris), inner, outer, top, bottom):
        return None, None
    iris_x = np.mean([landmarks[i].x for i in iris]) * width
    iris_y = np.mean([landmarks[i].y for i in iris]) * height
    inner_x, outer_x = landmarks[inner].x * width, landmarks[outer].x * width
    top_y, bottom_y = landmarks[top].y * height, landmarks[bottom].y * height
    eye_w, eye_h = abs(outer_x - inner_x), abs(bottom_y - top_y)
    if eye_w < 1 or eye_h < 1:
        return None, None
    return (iris_x - min(inner_x, outer_x)) / eye_w, (iris_y - min(top_y, bottom_y)) / eye_h


def classify(h_ratio, v_ratio) -> str:
    """Original classification: center, up/down/left/right (or combined), looking_away, unknown."""
    if h_ratio is None or v_ratio is None:
        return "unknown"
    h_off, v_off = abs(h_ratio - 0.5), abs(v_ratio - 0.5)
    if h_off > LOOKING_AWAY_THRESHOLD or v_off > LOOKING_AWAY_THRESHOLD:
        return "looking_away"
    parts = []
    if v_off > VERTICAL_THRESHOLD:
        parts.append("up" if v_ratio < 0.5 else "down")
    if h_off > HORIZONTAL_THRESHOLD:
        parts.append("left" if h_ratio < 0.5 else "right")
    return "_".join(parts) if parts else "center"


def to_direction(label: str, h_ratio, v_ratio) -> str:
    """Map an original label to center/left/right/up/down/no_face (dominant axis wins)."""
    if label in ("center", "left", "right", "up", "down"):
        return label
    if label in ("unknown", "no_face") or h_ratio is None or v_ratio is None:
        return "no_face"
    if abs(h_ratio - 0.5) >= abs(v_ratio - 0.5):
        return "left" if h_ratio < 0.5 else "right"
    return "up" if v_ratio < 0.5 else "down"


def summarise(frames: list[dict], fps: float, total_frames: int) -> dict:
    """frames: [{t, label, h, v}] with label None when no face was found."""
    with_face = [f for f in frames if f["label"] is not None]
    counts: dict = {}
    for f in with_face:
        counts[f["label"]] = counts.get(f["label"], 0) + 1
    n_face = len(with_face)
    eye_contact = round(counts.get("center", 0) / n_face * 100, 2) if n_face else 0.0
    attention = round(sum(counts.get(d, 0) for d in ("center", "up", "down")) / n_face * 100, 2) if n_face else 0.0

    # Consecutive looking_away samples form one look-away segment
    segments, start = [], None
    for f in frames:
        if f["label"] == "looking_away":
            start = f["t"] if start is None else start
        elif start is not None:
            segments.append(f["t"] - start)
            start = None
    if start is not None and frames:
        segments.append(frames[-1]["t"] - start)

    timeline = [
        {"t": round(f["t"], 3), "direction": to_direction(f["label"] or "no_face", f["h"], f["v"])}
        for f in frames
    ]
    distribution: dict = {}
    for entry in timeline:
        distribution[entry["direction"]] = distribution.get(entry["direction"], 0) + 1
    return {
        "eyeContactScore": eye_contact,
        "attentionScore": attention,
        "lookAwayCount": len(segments),
        "longestLookAwaySec": round(max(segments, default=0.0), 3),
        "totalLookAwaySec": round(sum(segments), 3),
        "faceDetectionRate": round(n_face / len(frames), 4) if frames else 0.0,
        "distribution": {k: round(v / len(timeline) * 100, 2) for k, v in distribution.items()} if timeline else {},
        "framesSampled": len(frames),
        "videoInfo": {
            "fps": round(fps, 2),
            "totalFrames": total_frames,
            "durationSec": round(total_frames / fps, 2) if fps > 0 else None,
        },
        "timeline": timeline,
    }


def analyze_video(video_path: str, model_path: str, sample_fps: float = 1.0, max_frames: int = 0) -> dict:
    import cv2
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError("Cannot open video")
    fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
    if fps <= 0 or fps > 1000:  # browser WebM often reports no/garbage fps; assume 30
        fps = 30.0
    interval = max(1, int(round(fps / sample_fps))) if sample_fps > 0 else 1

    options = vision.FaceLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=model_path),
        running_mode=vision.RunningMode.IMAGE,
        num_faces=1,
        output_face_blendshapes=False,
        output_facial_transformation_matrixes=False,
    )
    landmarker = vision.FaceLandmarker.create_from_options(options)
    frames, index = [], 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if index % interval:
                index += 1
                continue
            if max_frames and len(frames) >= max_frames:
                break
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
            entry = {"t": index / fps, "label": None, "h": None, "v": None}
            if result.face_landmarks:
                lm = result.face_landmarks[0]
                height, width = frame.shape[:2]
                lh, lv = iris_ratio(LEFT_EYE_IRIS, LEFT_EYE_INNER, LEFT_EYE_OUTER, LEFT_EYE_TOP, LEFT_EYE_BOTTOM, lm, width, height)
                rh, rv = iris_ratio(RIGHT_EYE_IRIS, RIGHT_EYE_INNER, RIGHT_EYE_OUTER, RIGHT_EYE_TOP, RIGHT_EYE_BOTTOM, lm, width, height)
                if lh is not None and rh is not None:
                    h, v = (lh + rh) / 2, (lv + rv) / 2
                else:
                    h, v = (lh, lv) if lh is not None else (rh, rv)
                entry.update(label=classify(h, v), h=h, v=v)
            frames.append(entry)
            index += 1
    finally:
        cap.release()
        landmarker.close()
    return summarise(frames, fps, index)
