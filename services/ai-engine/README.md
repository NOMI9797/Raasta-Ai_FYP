# Raasta-AI AI Engine

FastAPI service for the Raasta AI Interviewer: text-to-speech and interview media analysis.
Spec: [`docs/ai-hiring/14-ai-engine.md`](../../docs/ai-hiring/14-ai-engine.md).

## Endpoints

Every route except `/health` needs `Authorization: Bearer $AI_ENGINE_TOKEN` (if the token is unset they return 503).
Inputs are **storage keys** (the same keys and storage as `libs/hiring/storage.js`), never file paths.

| Route | Body | Returns |
|---|---|---|
| `GET /health` | – | `{ ok, models: { tts, emotion, whisper, gaze, face } }` (`lazy` / `loaded` / `disabled`) |
| `POST /tts` | `{ text (≤ 600), voice? }` | 24 kHz WAV, header `X-Audio-Duration-Ms` |
| `POST /media/concat` | `{ prefix: "recordings/{id}/audio/", outKey }` | `{ outKey, durationMs, parts }` |
| `POST /analyze/voice` | `{ audioKey, segments?: [{id, startMs, endMs, text?}], transcript? }` | `{ overall: {wpm, pauseRatio, longPauses, fillerPerMin, fillerTop, jitter, shimmer, durationSec, …}, segments }` |
| `POST /analyze/emotion` | `{ audioKey, segments? }` | `{ dominant, distribution, confidenceAvg, segments }` |
| `POST /analyze/gaze` | `{ videoKey, sampleFps?: 1, maxFrames?: 0 }` | `{ eyeContactScore, attentionScore, lookAwayCount, longestLookAwaySec, faceDetectionRate, timeline }` |
| `POST /analyze/face` | `{ videoKey, sampleFps? }` | `{ dominant, distribution, facesAnalyzed }`, or 501 unless `FACE_ANALYSIS_ENABLED=true` |
| `GET /auth/check` | – | `{ ok: true }` — confirms the token |

Errors: unknown storage key → 404, invalid key → 400, model unavailable → 503, undecodable media → 422.

Notes:
- `/media/concat` handles both MediaRecorder timeslice chunks (byte fragments, only the first has a WebM header) and separately recorded files, then remuxes so the result has a proper duration.
- `/analyze/voice` measures only the candidate `segments` when given. Pass the answer text in `segment.text` or `transcript` so filler words and WPM don't need Whisper; without any text, Whisper is used if installed, otherwise WPM and fillers are `null`.
- Analysis handlers run in FastAPI's thread pool, so `/tts` stays responsive during long analyses. `ENABLED_ROUTERS=tts` or `ENABLED_ROUTERS=media,voice,emotion,gaze,face` runs separate containers from the same image.

## Models

All weights download on first use into `MODEL_CACHE_DIR` (`HF_HOME` points there). Never commit weights.

| Model | Source | Used by |
|---|---|---|
| Kokoro-82M | HuggingFace (`kokoro` package) | `/tts` |
| `r-f/wav2vec-english-speech-emotion-recognition` | HuggingFace | `/analyze/emotion` |
| `openai/whisper-base` (optional) | HuggingFace | `/analyze/voice` fallback when no text is sent |
| MediaPipe face landmarker | `FACE_LANDMARKER_URL` (official MediaPipe bucket) | `/analyze/gaze` |
| Facial emotion (optional) | storage keys `models/face_emotion.h5` + `models/face_emotion_classes.json` (JSON list of labels in model output order) | `/analyze/face` |

The host must be allowed to reach `huggingface.co` (and PyPI) on first start.

## Run locally

```bash
cd services/ai-engine
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt          # needs ffmpeg + espeak-ng on the system
AI_ENGINE_TOKEN=<same value as the Node services> \
STORAGE_LOCAL_DIR=../../.storage MODEL_CACHE_DIR=./.models \
uvicorn main:app --port 8000 --reload
```

`STORAGE_LOCAL_DIR` must be the **same folder** the Next.js app and worker use.

Acceptance check (doc 14):

```bash
curl -H "Authorization: Bearer $AI_ENGINE_TOKEN" -H "Content-Type: application/json" \
  -X POST localhost:8000/tts -d '{"text":"Hello"}' -o hello.wav
```

## Tests

```bash
pip install -r requirements-dev.txt
pytest tests
```

The tests use the fixture recording in `tests/fixtures/interview/recording/`. TTS and speech emotion run against stand-in models (no weights needed); gaze uses the real MediaPipe model and MediaPipe's public sample portrait, downloaded at test time and skipped when offline.

## Docker

```bash
docker build -t raasta-ai-engine .
docker run -p 8000:8000 -e AI_ENGINE_TOKEN=... -v raasta-models:/models raasta-ai-engine
```
