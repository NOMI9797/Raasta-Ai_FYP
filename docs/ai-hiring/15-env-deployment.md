# 15 · Environment and Deployment

## Environment variables

Add these to `.env.local` (dev) and the deployment environment. Also create `.env.example` listing every key **without values**.

| Variable | Used by | Example / default | Notes |
|---|---|---|---|
| `DATABASE_URL` | all Node | existing | |
| `DATABASE_SSL` | all Node | `true` | `false` for local Postgres (see 03 quirk 3) |
| `REDIS_URL` | web, engine, worker | `redis://localhost:6379` | existing |
| `GROQ_API_KEY` | web, engine, worker | existing | LLM + Whisper fallback |
| `LLM_MODEL` | `libs/ai/llm.js` | `llama-3.3-70b-versatile` | main model |
| `LLM_FAST_MODEL` | `libs/ai/llm.js` | `llama-3.1-8b-instant` | analyzer pre-checks (optional) |
| `NEXT_PUBLIC_APP_URL` | web, worker | `http://localhost:8085` | used in email links |
| `NEXT_PUBLIC_INTERVIEW_WS_URL` | web (client) | `ws://localhost:8090/ws` | `wss://…/ws` in prod |
| `INTERVIEW_TICKET_SECRET` | web, engine | 32+ random bytes | JWT HS256 |
| `INTERVIEW_ENGINE_PORT` | engine | `8090` | |
| `INTERVIEW_MAX_SESSIONS` | engine | `20` | |
| `INTERVIEW_SILENCE_MS` | engine | `8000` | silence to finalise an answer |
| `INTERVIEWER_NAME` | engine | `Raasta AI Interviewer` | |
| `TTS_VOICE` | engine | `am_michael` | |
| `DEEPGRAM_API_KEY` | engine | – | if empty, the Whisper fallback is used |
| `AI_ENGINE_URL` | engine, worker | `http://localhost:8000` | |
| `AI_ENGINE_TOKEN` | engine, worker, ai-engine | 32+ random bytes | |
| `STORAGE_DRIVER` | web, worker, ai-engine | `local` | `s3` in prod |
| `STORAGE_LOCAL_DIR` | web, worker, ai-engine | `./.storage` | must be the **same folder** for all processes in dev (gitignored) |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | storage | – | `S3_ENDPOINT` for R2/MinIO |
| `HIRING_WORKER_CONCURRENCY` | worker | `3` | |
| `WORKER_ID` | worker | hostname | consumer name |
| `MAILGUN_API_KEY` | web, worker | existing | |
| `MODEL_CACHE_DIR` | ai-engine | `/models` | |
| `FACE_ANALYSIS_ENABLED` | ai-engine | `false` | needs TensorFlow + weights |

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
