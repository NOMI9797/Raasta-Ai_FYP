# 20. Setup guide: starting the programs from the app

The hiring pipeline runs on four programs plus Postgres and Redis. The **Setup guide** (sidebar: Recruiter > Setup guide, `/dashboard/recruiter/setup`) shows which are running, starts and stops the ones on this machine, and tells the person what to do next. Everything is also still possible from a terminal.

## 1. What it shows

| Part | How the app knows it is up |
|---|---|
| Web app | It is answering the request |
| Hiring worker | A consumer of the job queue was seen in the last 30 seconds (it has no address) |
| Interview engine | `GET /health` at the host of `NEXT_PUBLIC_INTERVIEW_WS_URL` (default `http://localhost:8090/health`) |
| AI engine | `GET <AI_ENGINE_URL>/health` (default `http://localhost:8000/health`) |
| Postgres, Redis | A query and a `PING`, each with a short timeout |
| Settings | Only yes or no for `GROQ_API_KEY`, `AI_ENGINE_TOKEN`, `INTERVIEW_TICKET_SECRET`, and `MAILGUN_API_KEY` with `MAILGUN_DOMAIN` (optional). Values never leave the server |

Each program card shows a state (running, starting, stopped, stopped unexpectedly, not responding), what the program is for in plain words, the buttons that make sense now, and the last lines it printed when it is down.

## 2. Starting and stopping

| Program | Command the app runs (fixed) |
|---|---|
| Hiring worker | `node node_modules/tsx/dist/cli.mjs workers/hiring-worker.js`, run by the web server itself (see 3) |
| Interview engine | `node node_modules/tsx/dist/cli.mjs services/interview-engine/index.js` |
| AI engine | `<python> -m uvicorn main:app --host 127.0.0.1 --port <port>` in `services/ai-engine`. `<python>` is `AI_ENGINE_PYTHON`, else `services/ai-engine/.venv`, else `python` |

- The browser sends only a program id and an action (`start`, `stop`, `restart`). Nothing it sends becomes part of a command, and unknown ids are refused.
- Programs start **detached**, so they keep running when the web app restarts. A pid file and the output go to `.runtime/` (git-ignored). Output has keys and tokens blanked out before it is shown.
- **Start** never starts a second copy: if the program already answers it does nothing, and a program still booting is left alone. A program that never became healthy after 90 seconds is ended and started again. A port held by something else is reported (`port_in_use`) instead of fought over.
- **Stop** only ends a program the app started. One started from a terminal is shown as running but must be stopped there (Ctrl+C). Before ending a process the app checks it is the right kind (node or python), so a reused process number is never killed.
- Stopping asks first and says what it costs: the worker pauses screening, invites and the agent (jobs it was in the middle of are picked up again after about 5 minutes); stopping the engine ends interviews in progress.
- A program that is not on this machine (`AI_ENGINE_URL` or `NEXT_PUBLIC_INTERVIEW_WS_URL` pointing elsewhere) is shown but cannot be started from here; the card gives the command to run where it lives.
- Postgres and Redis are not started from the app. If Redis is down the card says so and suggests waking WSL or running `redis-server`.

**Who and where:** admins and people in hiring mode can see the status and use the buttons. Control is **on in development and off in production**; set `SERVICE_CONTROL=true` or `false` to override. In Docker or on a server, run each program as its own service instead.

## 3. The hiring worker is run by the web server

You do not start the worker yourself any more. The web server (`instrumentation.js`, `libs/system/worker-host.js`) runs it as a child process:

- **At start:** it starts the worker when the server starts (once Redis answers).
- **When needed:** every job the web server adds to the queue (`libs/hiring/queue.js`) first checks that a worker is alive, and the Setup guide status check does the same. So queueing work never leaves it with nobody to do it.
- **If it stops:** it is started again after 1, 2, 5, 10 and 30 seconds as it keeps failing. Five quick stops in two minutes make the server pause its attempts for five minutes (the Setup guide shows why and what it printed); pressing **Start** or **Restart** tries again at once.
- **With the server:** it stops when the server stops. If the server is killed hard, the worker notices within 5 seconds (`HIRING_WORKER_PARENT_PID`) and ends itself.
- **Not twice:** if another worker already reads the queue (one you started in a terminal, a Docker service), the server leaves it alone. Workers it starts are named `web-<server process>` so its own, possibly just-died, entry is never mistaken for someone else.
- **Stop** on the Setup card pauses it: the server does not restart it until you press Start or the server restarts. A worker run another way is only reported.

Set `HIRING_WORKER_MODE=external` when something else runs the worker (Docker Compose, a service manager, a terminal), or `off` to turn it all off. The default is `embedded`. In the browser this is the first Next.js dev start of a session: Next compiles the instrumentation file lazily, so the worker can take up to about 20 seconds to appear after `npm run dev`.

## 4. Guidance

- **Checklist** on the Setup page: start the programs, connect a platform (optional), create a job, publish it, set up the Hiring agent (optional), get applicants, review interviews. The first step that is not done is highlighted. It is computed from the database (`libs/system/guidance.js`), so it moves on by itself.
- **Strip** at the top of Jobs, Candidates, Hiring agent and Interviews (`components/system/GuidanceStrip.js`): shows only what matters there. Postgres or Redis down (red), a program this screen depends on is off with a **Start now** button (amber), things waiting for the person such as agent approvals (blue), and on Jobs the next step.
- **Guards** before the two actions that otherwise wait silently (`useServiceGuard`): starting the Hiring agent needs the worker (Start now, or Cancel); sending an invite offers to start the worker, interview engine and AI engine but lets the recruiter **Continue anyway**.
- **Sidebar dot** on Recruiter and Setup guide while a program is off (amber) or Postgres or Redis is down (red). The status refreshes every 20 seconds and when the tab regains focus.

## 5. API

| Route | Purpose |
|---|---|
| `GET /api/system/status[?guidance=1][&fresh=1]` | Everything above. `fresh=1` skips the shared two-second reading (used right after a start or stop) |
| `POST /api/system/services/[id]` `{ action }` | `start`, `stop` or `restart` for `worker`, `engine` or `ai-engine` |
| `GET /api/system/services/[id]/logs` | Last lines of a program started from the app |

Code: `libs/system/` (`features.js` constants, `services.js` probes, `supervisor.js` start and stop, `status.js` report, `guidance.js` checklist), `components/system/`, `app/dashboard/recruiter/setup/`.

## 6. Tests

`tests/hiring/system-services.test.js` (26 tests): addresses and who can be started, probes, control gating, start and stop with a fake process (detached command, pid file, already running, grace period, port in use, missing Python, terminal-started program, recycled process number), log redaction, states and buttons, summary, and the checklist. The real worker command was also run through the supervisor with Redis pointed at a dead port, so it stopped at its first step: spawn, pid file, crash detection and log reading all worked. The interview engine and AI engine were started and stopped from the page in a browser.
