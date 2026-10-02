import numpy as np

from conftest import AUTH
from core import emotion, models

LABELS = models.EMOTION_LABELS


def fake_predict(calls):
    """Stand-in classifier: 'neutral' for quiet audio, 'happy' for louder audio."""
    def predict(waveform, sr):
        calls.append(len(waveform) / sr)
        p = np.full(len(LABELS), 0.02)
        p[LABELS.index("happy" if np.abs(waveform).mean() > 0.05 else "neutral")] = 0.88
        return p, LABELS
    return predict


def test_long_audio_is_chunked_into_12s_windows():
    calls = []
    sr = 16000
    y = np.zeros(sr * 30, dtype=np.float32)
    emotion.segment_probs(y, sr, fake_predict(calls))
    assert [round(c, 1) for c in calls] == [12.0, 12.0, 6.0]
    calls.clear()
    assert emotion.segment_probs(np.zeros(int(sr * 0.2)), sr, fake_predict(calls)) is None


def test_segments_weighted_by_duration():
    sr = 16000
    loud = 0.3 * np.ones(sr * 9, dtype=np.float32)
    quiet = np.zeros(sr * 3, dtype=np.float32)
    y = np.concatenate([loud, quiet])
    out = emotion.analyze(y, sr, fake_predict([]), segments=[
        {"id": "a", "startMs": 0, "endMs": 9000}, {"id": "b", "startMs": 9000, "endMs": 12000}])
    assert out["dominant"] == "happy"
    assert [s["emotion"] for s in out["segments"]] == ["happy", "neutral"]
    assert out["distribution"]["happy"] > out["distribution"]["neutral"]


def test_endpoint_with_stand_in_model(client, stored_recording):
    models.set_override("emotion", fake_predict([]))
    res = client.post("/analyze/emotion", headers=AUTH, json={
        "audioKey": stored_recording["audio"],
        "segments": [{"id": "r1", "startMs": 0, "endMs": 3000}, {"id": "r2", "startMs": 9000, "endMs": 12000}]})
    assert res.status_code == 200, res.text
    body = res.json()
    assert set(body) == {"dominant", "distribution", "confidenceAvg", "segments"}
    assert set(body["distribution"]) == set(LABELS)
    assert len(body["segments"]) == 2


def test_missing_model_returns_503(client, stored_recording, monkeypatch):
    def unavailable():
        raise models.ModelUnavailable("no weights")
    monkeypatch.setattr(models, "get_emotion", unavailable)
    assert client.post("/analyze/emotion", headers=AUTH, json={"audioKey": stored_recording["audio"]}).status_code == 503
