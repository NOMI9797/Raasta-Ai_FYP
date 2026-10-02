import io

import numpy as np
import soundfile as sf

from conftest import AUTH
from core import models


def fake_tts(text, voice):
    seconds = 0.05 * len(text.split())
    t = np.linspace(0, seconds, int(models.TTS_RATE * seconds), endpoint=False)
    return (0.2 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def test_tts_returns_24khz_wav_with_duration_header(client):
    models.set_override("tts", fake_tts)
    res = client.post("/tts", headers=AUTH, json={"text": "Hello there candidate, welcome to the interview"})
    assert res.status_code == 200, res.text
    assert res.headers["content-type"] == "audio/wav"
    audio, rate = sf.read(io.BytesIO(res.content))
    assert rate == 24000
    assert int(res.headers["x-audio-duration-ms"]) == round(len(audio) / rate * 1000)


def test_tts_validation(client):
    models.set_override("tts", fake_tts)
    assert client.post("/tts", headers=AUTH, json={"text": "x" * 601}).status_code == 422
    assert client.post("/tts", headers=AUTH, json={"text": "hi", "voice": "robot"}).status_code == 400
    assert client.post("/tts", headers=AUTH, json={"text": "   "}).status_code == 400
