# Raasta-AI AI Engine

FastAPI service for the Raasta AI Interviewer: text-to-speech and interview media analysis.
Spec: [`docs/ai-hiring/14-ai-engine.md`](../../docs/ai-hiring/14-ai-engine.md).

**Status:** Phase 0 skeleton — `/health` and the bearer-token check. Models and routers arrive in Phase 4.

## Run locally

```bash
cd services/ai-engine
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
AI_ENGINE_TOKEN=<same value as the Node services> uvicorn main:app --port 8000 --reload
```

- `GET /health` is public.
- Every other route needs `Authorization: Bearer $AI_ENGINE_TOKEN`. If the token is unset, those routes return 503.
- Keep the service on the internal network; never expose it publicly.

## Tests

```bash
pip install -r requirements-dev.txt
pytest tests
```

## Docker

```bash
docker build -t raasta-ai-engine .
docker run -p 8000:8000 -e AI_ENGINE_TOKEN=... -v raasta-models:/models raasta-ai-engine
```

Model weights download on first use into `MODEL_CACHE_DIR` (`/models`). Never commit weights.
