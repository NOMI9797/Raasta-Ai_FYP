# 15 · Environment and Deployment

## Environment variables

Add these to `.env.local` (dev) and the deployment environment. Also create `.env.example` listing every key **without values**.

| Variable | Used by | Example / default | Notes |
|---|---|---|---|
| `DATABASE_URL` | all Node | existing | |
| `DATABASE_SSL` | all Node | `true` | `false` for local Postgres (see 03 quirk 3) |
| `REDIS_URL` | web, engine, worker | `redis://localhost:6379` | existing |
| `GROQ_API_KEY` | web, engine, worker | existing | LLM + Whisper fallback |
| `LLM_MODEL` | `libs/ai/llm.js` | `openai/gpt-oss-120b` | main model (Groq retired the Llama 3.x models) |
| `LLM_FAST_MODEL` | `libs/ai/llm.js` | `openai/gpt-oss-20b` | analyzer pre-checks, job-post drafts (optional) |
| `LLM_BASE_URL` | `libs/ai/llm.js` | `https://api.groq.com/openai/v1` | optional; any OpenAI-compatible endpoint (also used for a local stub in tests) |
| `NEXT_PUBLIC_APP_URL` | web, worker | `http://localhost:8085` | used in email links |
| `EMAIL_TIMEZONE` | web, worker | `UTC` | IANA timezone for the invite expiry shown in emails, e.g. `Asia/Karachi` |
| `NEXT_PUBLIC_INTERVIEW_WS_URL` | web (client) | `ws://localhost:8090/ws` | `wss://…/ws` in prod |
| `INTERVIEW_TICKET_SECRET` | web, engine | 32+ random bytes | JWT HS256 |
| `INTERVIEW_ENGINE_PORT` | engine | `8090` | |
| `INTERVIEW_MAX_SESSIONS` | engine | `20` | |
| `INTERVIEW_SILENCE_MS` | engine | `8000` | silence to finalise an answer |
| `LOG_LEVEL` | engine | `info` | `debug` adds per-answer loop logs (never transcripts at info level) |
| `INTERVIEWER_NAME` | engine | `Raasta AI Interviewer` | |
| `TTS_VOICE` | engine | `am_michael` | |
| `DEEPGRAM_API_KEY` | engine | – | live captions and the best transcripts. If empty, the Whisper fallback is used (chunked, no live captions) |
| `STT_LANGUAGE` | engine | `en` | language of the interview. Locks Whisper to it (auto-detection invents Portuguese or Japanese from noise) and turns the foreign-script filter on for English; `auto` leaves Whisper to detect |
| `LLM_REASONING_EFFORT` | web, worker, engine | – | `low`, `medium` or `high`: default reasoning effort for `openai/gpt-oss-*` models when a caller doesn't choose. The interview paths use `low` |
| `FFMPEG_PATH` | worker | `ffmpeg` | where ffmpeg is, when it isn't on PATH. The worker joins and decodes recordings with it; without it the AI engine is used for joining |
| `AI_ENGINE_URL` | engine, worker | `http://localhost:8000` | |
| `AI_ENGINE_TOKEN` | engine, worker, ai-engine | 32+ random bytes | |
| `STORAGE_DRIVER` | web, worker, ai-engine | `local` | `s3` in prod |
| `STORAGE_LOCAL_DIR` | web, worker, ai-engine | `./.storage` | must be the **same folder** for all processes in dev (gitignored) |
| `STORAGE_SIGNING_SECRET` | web | 32+ random bytes | signs short-lived `/api/files/<token>` download links (local driver) |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | storage | – | `S3_ENDPOINT` for R2/MinIO |
| `HIRING_WORKER_CONCURRENCY` | worker | `3` | |
| `WORKER_ID` | worker | hostname | consumer name |
| `MAILGUN_API_KEY` | web, worker | – | Mailgun private API key. Needed with `MAILGUN_DOMAIN` to send real email (08) |
| `MAILGUN_DOMAIN` | web, worker | – | the sending domain as Mailgun lists it (`mg.example.com`, or `sandbox….mailgun.org`: authorized recipients only) |
| `MAILGUN_REGION`, `MAILGUN_API_URL` | web, worker | `us` | `eu` for a domain created in the EU region; the URL overrides both |
| `MAILGUN_FROM`, `MAILGUN_REPLY_TO` | web, worker | `Raasta-AI <noreply@MAILGUN_DOMAIN>` | sender and default reply address |
| `EMAIL_OUTBOX` | web, worker | – | `local` writes emails to `.storage/outbox` when there is no Mailgun key, even in production (`npm run serve` sets it) |
| `DEV_WARMUP`, `QUERY_DEVTOOLS` | `npm run dev` | – | `false` turns off the screen warm-up; `true` shows the React Query panel (see 21) |
| `PUBLISH_DAILY_CAP_<PLATFORM>`, `PUBLISH_MIN_GAP_MINUTES_<PLATFORM>` | web, worker | LinkedIn 3 / 10, Rozee.pk 5 / 5, Indeed 3 / 10 | `<PLATFORM>` is `LINKEDIN`, `ROZEE` or `INDEED`; automatic posts per account per 24 hours, and the pause between two (see 19) |
| `INDEED_AUTO_POST` | web, worker | – | `true` would offer posting to Indeed in the background (a saved session, nobody watching). Nothing is built behind it: Indeed is posted with the posting engine or Copy and open (see 19, sections 5b and 5f) |
| `POSTER_ENGINE_PORT` | web, posting engine | `8095` | the posting engine's health address, on this machine only. A second engine on the same port refuses to start |
| `POSTER_TYPING_SPEED` | posting engine | `natural` | `natural`, `fast` or `off`: how quickly the engine types in its window (see 19, section 5f) |
| `POSTER_BROWSER` | posting engine | `chrome` | the browser the engine opens: `chrome` (falls back to Chromium), `msedge` or `chromium`. It has a profile of its own under `.runtime/poster-profiles/` |
| `POSTER_PAUSED_COOLOFF_HOURS` | web | `24` | how long the posting engine leaves a person's Indeed alone after Indeed paused the account (a block page is always 30 minutes); see 19, section 5f |
| `POSTER_STEALTH` | posting engine | – | `true` adds stealth launch flags. Off by default: a visible window with a person and human-like typing come first (see CLAUDE.md conventions and 19, section 5) |
| `POSTER_SHOTS_DIR` | web, posting engine | `./.runtime/poster-runs` | where each run's step screenshots are written (git-ignored, the newest 15 runs kept); the web app reads them from here |
| `INDEED_DEBUG` | web, worker | – | `true` records every automatic Indeed post attempt (screenshots, page structure, errors) in `debug-indeed/` |
| `INDEED_DEBUG_DIR` | web, worker | `./debug-indeed` | where Indeed debug runs are written (gitignored; the newest 20 are kept) |
| `INDEED_CHECK_WAIT_SECONDS` | web | `180` | with the window shown, how long the Indeed diagnostic waits for a person to clear a verification check (10 to 600) |
| `INDEED_CONNECT_WAIT_MINUTES` | web | `5` | how long the Indeed sign-in window waits for the person (1 to 30) |
| `INDEED_CONNECT_WINDOW` | web | – | `off` disables the Indeed sign-in window (a server without a screen) |
| `MODEL_CACHE_DIR` | ai-engine | `/models` | |
| `FACE_ANALYSIS_ENABLED` | ai-engine | `false` | needs TensorFlow + weights |

**ffmpeg** must be installed on the machine that runs the hiring worker (`winget install Gyan.FFmpeg`, `brew install ffmpeg`, `apt install ffmpeg`); `ffmpeg -version` should work in the terminal that starts the app. **Camera tracking** needs its browser runtime copied under `public/mediapipe/` once: `npm run sync:mediapipe` (copies the WebAssembly runtime from `node_modules` and the face model from `services/ai-engine/.models/` or downloads it once, about 4 MB). Both are git-ignored.

Generate secrets: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

Add `.storage/` to `.gitignore`.

## npm scripts (root `package.json`)
```json
"engine:dev": "tsx watch services/interview-engine/index.js",
"engine:start": "tsx services/interview-engine/index.js",
"worker:hiring": "tsx workers/hiring-worker.js",
"check:branding": "bash scripts/check-branding.sh",
"test:hiring": "tsx --test tests/hiring/*.test.js"
```
New dependencies: `ws`, `jose`, `@deepgram/sdk`, `pdf-parse`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`. `tsx` is already present.

## Local development (4 terminals)
```bash
# 0. once
cp .env.example .env.local   # fill values
psql "$DATABASE_URL" -f drizzle/0009_ai_hiring.sql
docker run -d -p 6379:6379 redis:7          # if no Redis yet

# 1. web
npm run dev
# 2. interview engine
npm run engine:dev
# 3. worker
npm run worker:hiring
# 4. ai-engine
cd services/ai-engine && python -m venv .venv && source .venv/bin/activate \
  && pip install -r requirements.txt && uvicorn main:app --port 8000 --reload
```
Microphone access needs a secure context. `http://localhost` is allowed; any other host needs HTTPS.

`npm run dev` compiles every screen the first time it is opened, which is slow on a laptop. To use or demo the product, run `npm run serve` instead (a production build on the same port, see 21). It keeps `SERVICE_CONTROL=true` and `EMAIL_OUTBOX=local` unless you set them.

## The hiring worker starts with the web server

`npm run dev` and `npm start` also run the hiring worker (`instrumentation.js`, see 20), so `npm run worker:hiring` is no longer needed. `HIRING_WORKER_MODE` is `embedded` (default), `external` (you or Docker run the worker; the web server only reports on it) or `off`. Use `external` in Docker Compose, where the worker is its own service.

## Starting from the web app

In development the other programs can also be started, stopped and watched from **Recruiter > Setup guide** (see 20). Two optional settings: `SERVICE_CONTROL` (`true` or `false`; on in development, off in production) and `AI_ENGINE_PYTHON` (path of the Python that runs the AI engine; default is `services/ai-engine/.venv`). Programs started this way write `.runtime/<program>.log` and `.runtime/<program>.pid.json`.

## Docker Compose (`docker-compose.yml` at repo root)

```yaml
services:
  web:
    build: { context: ., dockerfile: Dockerfile.web }
    env_file: .env.production
    ports: ["8085:8085"]
    depends_on: [redis]
  interview-engine:
    build: { context: ., dockerfile: Dockerfile.node }
    command: ["npx", "tsx", "services/interview-engine/index.js"]
    env_file: .env.production
    depends_on: [redis, ai-engine]
  hiring-worker:
    build: { context: ., dockerfile: Dockerfile.node }
    command: ["npx", "tsx", "workers/hiring-worker.js"]
    env_file: .env.production
    depends_on: [redis, ai-engine]
  ai-engine:
    build: ./services/ai-engine
    env_file: .env.production
    volumes: ["models:/models"]
  redis:
    image: redis:7-alpine
    volumes: ["redis:/data"]
  nginx:
    image: nginx:alpine
    ports: ["80:80", "443:443"]
    volumes: ["./nginx/raasta.conf:/etc/nginx/conf.d/default.conf:ro", "./nginx/certs:/etc/nginx/certs:ro"]
    depends_on: [web, interview-engine]
volumes: { models: {}, redis: {} }
```
- `Dockerfile.web`: Node 20, `npm ci`, `npm run build`, `npm start -- -p 8085`. Skip the Playwright `postinstall` (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`) unless the web container runs LinkedIn automation.
- `Dockerfile.node`: Node 20 slim, `npm ci --omit=dev` (keep `tsx`), copy `libs/`, `services/`, `workers/`, `config.js`.
- Postgres stays managed (existing `DATABASE_URL`); use S3 or R2 for storage in production.

### Nginx (`nginx/raasta.conf`)
```nginx
server {
  listen 443 ssl; server_name your-domain;
  ssl_certificate /etc/nginx/certs/fullchain.pem; ssl_certificate_key /etc/nginx/certs/privkey.pem;
  client_max_body_size 12m;
  location /ws {
    proxy_pass http://interview-engine:8090;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
  }
  location / {
    proxy_pass http://web:8085;
    proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto https;
    proxy_buffering off;              # SSE
  }
}
server { listen 80; return 301 https://$host$request_uri; }
```

## Hosting options
- **Single VM (recommended for the demo):** e.g. 4 vCPU / 16 GB RAM running everything with Compose; a GPU instance is optional. Free TLS via certbot.
- **Split:** web on Vercel (existing) + engine/worker/ai-engine on a VM. Then set `NEXT_PUBLIC_INTERVIEW_WS_URL=wss://engine.your-domain/ws`, and make sure the Vercel functions can reach Redis and storage. The SSE live view needs a long-lived function, so prefer the single VM.

## Operations
- Health: `web /api/test-db`, `engine /health`, `ai-engine /health`.
- Logs: JSON lines with `service`, `level`, `interviewId`/`candidateId` (no PII).
- Backups: Postgres (managed) + storage bucket versioning.
- Data retention: add a recruiter "Delete recording" action, and document deleting recordings after N days (configurable, default 90) in the privacy notice.
