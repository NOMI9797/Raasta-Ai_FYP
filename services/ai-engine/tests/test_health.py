from conftest import AUTH
from core import config


def test_health_is_public_and_reports_models(client):
    body = client.get("/health").json()
    assert body["ok"] is True
    assert body["models"]["face"] == "disabled"
    assert set(body["models"]) == {"tts", "emotion", "whisper", "gaze", "face"}


def test_protected_routes_require_the_token(client):
    assert client.get("/auth/check").status_code == 401
    assert client.get("/auth/check", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.post("/tts", json={"text": "hi"}).status_code == 401
    assert client.post("/analyze/voice", json={"audioKey": "x"}).status_code == 401
    assert client.get("/auth/check", headers=AUTH).json() == {"ok": True}


def test_unset_token_fails_closed(client, monkeypatch):
    monkeypatch.setattr(config, "AI_ENGINE_TOKEN", "")
    assert client.get("/auth/check", headers={"Authorization": "Bearer anything"}).status_code == 503
