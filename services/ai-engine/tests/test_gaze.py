from conftest import AUTH
from core import gaze


class P:
    def __init__(self, x, y):
        self.x, self.y = x, y


def test_classification_and_doc_direction_mapping():
    assert gaze.classify(0.5, 0.5) == "center"
    assert gaze.classify(0.1, 0.5) == "left"
    assert gaze.classify(0.5, 0.9) == "down"
    assert gaze.classify(0.1, 0.1) == "up_left"
    assert gaze.classify(0.99, 0.5) == "looking_away"
    assert gaze.to_direction("up_left", 0.1, 0.2) == "left"
    assert gaze.to_direction("looking_away", 0.5, 0.98) == "down"
    assert gaze.to_direction("unknown", None, None) == "no_face"


def test_summary_scores_and_look_away_segments():
    frames = [
        {"t": 0, "label": "center", "h": .5, "v": .5}, {"t": 1, "label": "looking_away", "h": .99, "v": .5},
        {"t": 2, "label": "looking_away", "h": .99, "v": .5}, {"t": 3, "label": "center", "h": .5, "v": .5},
        {"t": 4, "label": None, "h": None, "v": None}, {"t": 5, "label": "down", "h": .5, "v": .8},
    ]
    s = gaze.summarise(frames, fps=1, total_frames=6)
    assert s["eyeContactScore"] == 40.0      # 2 center of 5 face frames
    assert s["attentionScore"] == 60.0       # center + down
    assert s["lookAwayCount"] == 1 and s["longestLookAwaySec"] == 2
    assert s["faceDetectionRate"] == round(5 / 6, 4)
    assert [e["direction"] for e in s["timeline"]] == ["center", "right", "right", "center", "no_face", "down"]


def test_fixture_video_without_a_face(client, stored_recording, face_landmarker):
    res = client.post("/analyze/gaze", headers=AUTH, json={"videoKey": stored_recording["video"], "sampleFps": 2})
    assert res.status_code == 200, res.text
    body = res.json()
    for key in ("eyeContactScore", "attentionScore", "lookAwayCount", "longestLookAwaySec", "faceDetectionRate", "timeline"):
        assert key in body
    assert body["faceDetectionRate"] == 0
    assert body["timeline"] and all(e["direction"] == "no_face" for e in body["timeline"])


def test_real_face_is_detected(client, face_landmarker, portrait_video_key):
    res = client.post("/analyze/gaze", headers=AUTH, json={"videoKey": portrait_video_key, "sampleFps": 2})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["faceDetectionRate"] >= 0.9
    assert body["timeline"][0]["direction"] in {"center", "left", "right", "up", "down"}
