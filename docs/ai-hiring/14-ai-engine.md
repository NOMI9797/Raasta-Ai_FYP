# 14 · AI Engine (`services/ai-engine`, Python)

A FastAPI service for speech synthesis and media analysis. Ported from the legacy Python server; see [04-source-port-map.md](04-source-port-map.md).

## Layout
```
services/ai-engine/
  main.py                  # FastAPI app, auth dependency, routers, /health
  core/
    config.py              # env: AI_ENGINE_TOKEN, STORAGE_*, MODEL_CACHE_DIR, FACE_ANALYSIS_ENABLED, TTS_VOICE
    storage.py             # get_local_path(key) downloads from S3 to /tmp (or resolves local dir); put(key, path)
    media.py               # ffmpeg helpers: concat webm parts, webm→wav 16k mono, cut segments
    models.py              # lazy singletons: kokoro pipeline, wav2vec2 emotion, whisper (optional), mediapipe
    gaze.py                # MediaPipe face landmarker gaze logic (ported)
  routers/
    tts.py  voice.py  emotion.py  gaze.py  face.py  media.py
  requirements.txt  Dockerfile  README.md
```

## Auth
Every route except `/health` requires `Authorization: Bearer ${AI_ENGINE_TOKEN}`. Don't expose the service publicly (internal network only in Docker Compose).

## Endpoints

| Method & path | Request | Response |
|---|---|---|
| `GET /health` | – | `{ ok, models: { tts: loaded|lazy, emotion, whisper, gaze, face } }` |
| `POST /tts` | `{ text (≤ 600 chars), voice? }` | `audio/wav` bytes (24 kHz mono), header `X-Audio-Duration-Ms` |
| `POST /media/concat` | `{ prefix: "recordings/{id}/audio/", outKey: "recordings/{id}/audio.webm" }` | `{ outKey, durationMs }` |
| `POST /analyze/voice` | `{ audioKey, segments?: [{id,startMs,endMs}] }` | `{ overall: {wpm, pauseRatio, longPauses, fillerPerMin, fillerTop[], jitter, shimmer, durationSec}, segments: [{id, wpm, fillerCount, pauseRatio}] }` |
| `POST /analyze/emotion` | `{ audioKey, segments? }` | `{ dominant, distribution{}, confidenceAvg, segments:[{id, emotion, confidence}] }` |
| `POST /analyze/gaze` | `{ videoKey, sampleFps?: 1, maxFrames?: 0 }` | `{ eyeContactScore, attentionScore, lookAwayCount, longestLookAwaySec, faceDetectionRate, timeline:[{t, direction}] }` |
| `POST /analyze/face` | `{ videoKey }` | `{ dominant, distribution{} }` (or 501 if `FACE_ANALYSIS_ENABLED=false`) |

Behaviour notes (ported):
- **Voice:**
  - Pauses come from the RMS energy of librosa (`min_pause 0.2s`; long pause ≥ 2s).
  - Filler words come from the transcription (Whisper via transformers pipeline if available; otherwise skip fillers). **Better:** the worker passes the candidate's `interview_turns` text so the engine can count fillers without re-transcribing. Add an optional `transcript` field to the request.
  - Jitter and shimmer are estimated from pitch (librosa pyin).
- **Emotion:** Wav2Vec2 speech emotion recognition (labels: angry, disgust, fear, happy, neutral, sad, surprise). Run it per segment (max 30s windows) and aggregate weighted by duration.
- **Gaze:** MediaPipe face landmarker with iris ratios. Directions: center/left/right/up/down/no_face. `eyeContactScore` = center share × 100.
- **TTS:** Kokoro-82M `KPipeline(lang_code='a')`, voices `af_heart, af_bella, af_nicole, af_sarah, af_sky, am_adam, am_michael`; default `am_michael`.

Implementation notes (Phase 4):
- Pause detection: the silence threshold is the higher of the original 10th-percentile RMS and 10% of the loud-speech RMS (90th percentile). The percentile alone only ever marks the quietest 10% of frames as silent, so long pauses were missed in recordings with more silence than that.
- Filler words are matched as whole words (the original substring count treated "also" as "so").
- Gaze directions use the original iris thresholds; combined or "looking away" labels map to the dominant axis so the timeline uses center/left/right/up/down/no_face. `lookAwayCount` still counts the original "looking away" segments.
- Facial emotion class names are a JSON list at `FACE_CLASSES_KEY` (default `models/face_emotion_classes.json`) instead of a pickle, which is unsafe to load from storage.
- `opencv-python-headless` is pinned below 5 (5.x no longer ships the Haar cascades), and the image needs `libegl1 libgles2` for MediaPipe.

## Models and weights
- All weights are downloaded on first use into `MODEL_CACHE_DIR` (`HF_HOME` set to it).
- The MediaPipe `face_landmarker.task` is downloaded from the official MediaPipe model URL at startup if missing.
- Facial emotion (optional) needs the trained `.h5` weights. Upload them once to object storage (`models/face_emotion.h5`) and download them at startup. **Never commit weights.**

## requirements.txt (baseline)
```
fastapi>=0.110
uvicorn[standard]>=0.29
pydantic>=2.6
python-multipart
boto3
numpy
scipy
soundfile
librosa>=0.10
torch>=2.2
transformers>=4.40
accelerate
safetensors
kokoro>=0.9.2
opencv-python-headless>=4.9
mediapipe>=0.10
# optional (FACE_ANALYSIS_ENABLED=true):
# tensorflow>=2.15
```
System packages: `ffmpeg`, `espeak-ng` (Kokoro may need it for some words).

## Dockerfile (outline)
```dockerfile
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg espeak-ng libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV MODEL_CACHE_DIR=/models HF_HOME=/models
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
```
Mount `/models` as a volume so the weights survive rebuilds.

## Performance
- CPU is fine for the demo (TTS takes about 0.5–2s per sentence on a modern CPU; analysis takes minutes per interview). A GPU speeds up everything.
- Use one Uvicorn worker (the models are large). Run heavy analysis in a thread pool so `/tts` stays responsive, or run two containers: `ai-engine-tts` and `ai-engine-analysis` (same image, different `ENABLED_ROUTERS` env).

## Acceptance
- `curl -H "Authorization: Bearer $AI_ENGINE_TOKEN" -X POST localhost:8000/tts -d '{"text":"Hello"}' -o hello.wav` plays.
- Each analyze endpoint returns valid JSON for the fixture recording in `tests/fixtures/interview/recording/`.
