from conftest import AUTH
from core import voice


def test_fillers_are_whole_words():
    assert voice.count_fillers("I also likely know so much") == {"total": 1, "breakdown": {"so": 1}}
    assert voice.count_fillers("Um, like, you know, I uh think so") == {
        "total": 5, "breakdown": {"um": 1, "uh": 1, "like": 1, "you_know": 1, "so": 1}}
    assert voice.count_fillers(None) == {"total": 0, "breakdown": {}}


def test_words_per_minute_uses_speaking_time():
    assert voice.words_per_minute("one two three four", 4.0, 2.0) == 120.0
    assert voice.words_per_minute("", 4.0, 0) is None
    assert voice.words_per_minute("a b", 1.0, 1.0) is None


def test_fixture_voice_metrics(client, stored_recording):
    res = client.post("/analyze/voice", headers=AUTH, json={"audioKey": stored_recording["audio"]})
    assert res.status_code == 200, res.text
    overall = res.json()["overall"]
    assert 13.5 < overall["durationSec"] < 14.5
    assert overall["longPauses"] >= 1            # the 2.5 s gap at 6.5-9 s
    assert overall["longestPauseSec"] >= 2.0
    assert 0 < overall["pauseRatio"] < 0.5
    assert overall["jitter"] is not None and overall["shimmer"] is not None
    assert overall["wpm"] is None and overall["hasTranscript"] is False  # no text, no Whisper here


def test_segments_with_text(client, stored_recording):
    res = client.post("/analyze/voice", headers=AUTH, json={
        "audioKey": stored_recording["audio"],
        "segments": [
            {"id": "r1", "startMs": 0, "endMs": 3000, "text": "Um I have worked with Docker and Kubernetes for years"},
            {"id": "r2", "startMs": 9000, "endMs": 12000, "text": "So I like automating pipelines"},
        ],
    })
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["overall"]["hasTranscript"] is True
    assert 5.5 < body["overall"]["durationSec"] < 6.5   # only the candidate segments
    assert body["overall"]["fillerTop"][:1] in (["um"], ["so"], ["like"])
    assert [s["id"] for s in body["segments"]] == ["r1", "r2"]
    assert body["segments"][0]["fillerCount"] == 1 and body["segments"][1]["fillerCount"] == 2
    assert body["segments"][0]["wpm"] > 0


def test_segment_validation(client, stored_recording):
    res = client.post("/analyze/voice", headers=AUTH, json={"audioKey": stored_recording["audio"], "segments": [{"startMs": 500, "endMs": 100}]})
    assert res.status_code == 422
