import numpy as np

from conftest import AUTH
from core import config, models


def test_disabled_returns_501(client, stored_recording):
    res = client.post("/analyze/face", headers=AUTH, json={"videoKey": stored_recording["video"]})
    assert res.status_code == 501


def test_enabled_with_stand_in_model(client, portrait_video_key):
    config.FACE_ANALYSIS_ENABLED = True
    classes = ["angry", "happy", "neutral"]
    models.set_override("face", (lambda batch: np.array([0.1, 0.2, 0.7]), classes))
    res = client.post("/analyze/face", headers=AUTH, json={"videoKey": portrait_video_key, "sampleFps": 2})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["facesAnalyzed"] > 0
    assert body["dominant"] == "neutral"
