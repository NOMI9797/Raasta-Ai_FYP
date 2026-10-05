// The web server runs the hiring worker (libs/system/worker-host.js): it starts it now, keeps it alive,
// and wakes it whenever a job is queued. Set HIRING_WORKER_MODE=external to run the worker yourself instead.
// In `npm run dev` it also opens the first screens once (libs/system/dev-warmup.js), so they are compiled by the time you sign in.
import "./libs/load-env";
import { startWorkerHost } from "./libs/system/worker-host";
import { startDevWarmup } from "./libs/system/dev-warmup";

export function startHiringWorkerHost() {
  startWorkerHost();
  startDevWarmup();
}
