from fastapi.testclient import TestClient

import main
from core import config

client = TestClient(main.app)


def test_health_is_public():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["ok"] is True


def test_protected_route_requires_token(monkeypatch):
    monkeypatch.setattr(config, "AI_ENGINE_TOKEN", "test-token-123")
    assert client.get("/auth/check").status_code == 401
    assert client.get("/auth/check", headers={"Authorization": "Bearer wrong"}).status_code == 401
    ok = client.get("/auth/check", headers={"Authorization": "Bearer test-token-123"})
    assert ok.status_code == 200 and ok.json() == {"ok": True}


def test_unset_token_fails_closed(monkeypatch):
    monkeypatch.setattr(config, "AI_ENGINE_TOKEN", "")
    response = client.get("/auth/check", headers={"Authorization": "Bearer anything"})
    assert response.status_code == 503
