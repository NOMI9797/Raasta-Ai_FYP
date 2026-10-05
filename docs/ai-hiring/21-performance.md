# 21. Speed: why `npm run dev` is slow and how to run fast

## 1. What was slow

Measured on a dual-core laptop with an empty database (so the data was never the problem):

| What | `npm run dev` | Cause |
|---|---|---|
| First visit to the sign-in page | 10 to 20 s | Next compiles each screen the first time it is opened |
| First visit to the sign-in API (`/api/auth/*`) | 13 to 15 s | same |
| First visit to each other screen or API | 0.5 to 3 s each | same |
| Sum of those first visits for the main hiring screens | 40 to 50 s | same |
| Page weight | 12 MB of JavaScript | development bundles are not minified |
| Same screens after the first visit | 0.05 to 0.15 s | the server itself is fast |

So sign in, then Home, then every new screen paid a compile. Returning to a screen after a minute could pay it again, because `next dev` drops screens it has not seen for 60 seconds.

## 2. Run fast: `npm run serve`

```bash
npm run serve                 # build if the code changed, then run on http://localhost:8085
npm run serve -- --rebuild    # build again even if nothing changed
npm run serve -- --no-build   # start the last build as it is
```

It runs the same app as a **production build**. Nothing compiles while you click, and a screen ships about 120 to 150 KB of JavaScript instead of 12 MB. Same measurement: the sum of first visits drops from about 51 s to 2.5 s. Signing in and seeing Home with its numbers takes about 1.2 s, moving between screens 0.15 to 0.3 s, and the server uses about 110 MB instead of 1 to 1.5 GB.

- The first run builds (2 to 3 minutes). Later runs start in about a second **until you change code**: it compares the newest source file with the last build and builds again only when needed. `app/`, `components/`, `libs/`, the config files and `.env*` count.
- The build goes to `.next-prod`, so it never touches a running `npm run dev`. Both want port 8085, so stop one before starting the other.
- Use `npm run dev` while you are editing code (changes show at once), and `npm run serve` for using, demoing and testing the product.
- The hiring worker is still started by the web server, in both modes (see 20).
- A fast local run is not a deployment, so the script keeps two development conveniences that production switches off: `SERVICE_CONTROL=true` (the Setup guide can start and stop the other programs) and `EMAIL_OUTBOX=local` (with no `MAILGUN_API_KEY`, emails go to `.storage/outbox` instead of failing). Set either yourself to override. A real `MAILGUN_API_KEY` always sends real email.

## 3. What makes `npm run dev` itself faster

| Change | Effect |
|---|---|
| **Warm-up** (`libs/system/dev-warmup.js`, started from `instrumentation-node.js`) | Right after the server starts, it opens the sign-in screens, Home and the hiring screens one at a time in the background (about a minute), so they are compiled before you get there. The requests carry no session, so pages redirect and APIs answer 401, which is enough for Next to compile them. After it, the same first visits sum to under 4 s instead of 51 s. `DEV_WARMUP=false` turns it off. |
| `serverComponentsExternalPackages` in `next.config.js` | Large server-side packages (drizzle-orm, postgres, ioredis, openai, stripe and others) load from `node_modules` instead of being bundled on every compile. About 20% less compile time, and it also applies to the production build. |
| `onDemandEntries` in `next.config.js` | Compiled screens stay for 30 minutes (and up to 30 of them) instead of being dropped after a minute. |
| React Query devtools are opt-in | A 1.2 MB panel was loaded on every screen. Set `QUERY_DEVTOOLS=true` in `.env.local` to bring it back. |
| Database indexes (migration `0013`, see 05) | Jobs, candidates, agent runs and steps are read by job, status and owner, and had no index for it. Nothing measurable with a handful of rows; it keeps the pipeline fast once there are thousands of candidates. |

Tried and dropped: `next dev --turbo` (Turbopack). The first sign-in compile was no faster, other first visits were only modestly faster, and every later request was slower, for an experimental mode.

## 4. Things outside the code that matter on Windows

- **Antivirus scanning.** Windows Security scans every file Next reads and writes (`node_modules`, `.next`). Adding the project folder as an exclusion (Windows Security, Virus and threat protection, Manage settings, Exclusions) is the single biggest change for `npm run dev`. It needs administrator rights, so it is not done by the app.
- **Memory.** `npm run dev` grows to 1 to 1.5 GB over a session. On an 8 GB machine with a browser, an editor and other tools open, free memory runs low and Windows starts paging. Close what you do not need, or use `npm run serve`, which needs far less.
- **One browser tab.** Each tab polls (notifications every 30 s, program status every 20 s) and every poll is a request.

## 5. Environment

| Variable | Used by | Meaning |
|---|---|---|
| `DEV_WARMUP` | `npm run dev` | `false` turns the warm-up off |
| `QUERY_DEVTOOLS` | `npm run dev` | `true` shows the React Query panel |
| `NEXT_DIST_DIR` | build and start | build folder (default `.next`; `npm run serve` uses `.next-prod`) |
| `EMAIL_OUTBOX` | web, worker | `local` keeps the outbox when there is no Mailgun key, even in production |
| `SERVICE_CONTROL` | web | see 20 |

## 6. Checked

On the dev server and on `npm run serve` with a throw-away user (removed afterwards): first-visit timings of 17 screens and APIs before and after each change; the warm-up opened 21 of 21 screens and left no errors in the log; sign in through the real form and Home with its numbers in 1.2 s; sidebar navigation 0.15 to 0.3 s. The production server started the hiring worker by itself when no other worker was running, left an already running one alone, and its worker ended within a second when the server was killed. The migration was applied to the development database.

## 7. Tests

`tests/hiring/serve.test.js` (when it builds, options, which files count), `tests/hiring/dev-warmup.test.js` (order, port, failures skipped, off in production), and a new case in `tests/hiring/emails.test.js` (`EMAIL_OUTBOX`).
