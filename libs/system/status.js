// One report of everything the hiring pipeline stands on: Postgres, Redis, the four programs, and the
// settings they need. Safe to send to the browser: it holds states and short sentences, never values or secrets.
// Relative imports only.
import { sql } from "drizzle-orm";
import { db } from "../db";
import { getRedisClient } from "../redis";
import { getQueueOverview } from "../hiring/queue-admin";
import {
  INFRA_ID, SERVICE_ID, checkConfig, getServiceDefs, probeHttp, probePostgres, probeRedis, workerFromOverview,
} from "./services";
import { START_GRACE_MS, controlEnabled, getManaged, readLogTail } from "./supervisor";
import { getHostState } from "./worker-host";

export const SERVICE_STATE = Object.freeze({
  RUNNING: "running",
  STARTING: "starting",
  STOPPED: "stopped",
  CRASHED: "crashed",
  NOT_RESPONDING: "not_responding",
});

const INFRA_HINT = {
  [INFRA_ID.REDIS]: "Redis is not reachable. If it runs in WSL, open a WSL terminal once (it can go to sleep when idle), or start it with: redis-server. Check REDIS_URL in .env.local.",
  [INFRA_ID.POSTGRES]: "The database is not reachable. Check that Postgres is running and that DATABASE_URL in .env.local is right.",
};

/**
 * Turns what was observed about one program into what the screen shows. Pure, so it can be tested.
 * `probe` = { up, ... }, `managed` = getManaged(), `infraDown` = ids of infrastructure that is down.
 */
export function describeService({ def, probe, managed, infraDown = [], canControl, now, logTail = [], extras = {} }) {
  let state = SERVICE_STATE.STOPPED;
  if (probe.up) state = SERVICE_STATE.RUNNING;
  else if (managed.managed) state = now - managed.startedAt < START_GRACE_MS ? SERVICE_STATE.STARTING : SERVICE_STATE.NOT_RESPONDING;
  else if (managed.crashed) state = SERVICE_STATE.CRASHED;

  // The worker is run by the web server (embedded mode): say what it is doing about it, not just that it is off
  const host = def.id === SERVICE_ID.WORKER && def.hosted ? extras.host : null;
  let hostNote = "";
  if (host && !probe.up) {
    if (!host.desired) {
      state = SERVICE_STATE.STOPPED;
      hostNote = "Paused: you stopped it, so the web server will not start it again until you press Start.";
    } else if (host.gaveUp) {
      state = SERVICE_STATE.CRASHED;
      hostNote = "It kept stopping, so the web server paused its attempts for a few minutes. Press Restart to try again. The last lines it wrote are below.";
    } else if (!host.alive && host.lastExit) {
      state = SERVICE_STATE.STARTING;
      hostNote = "It stopped. The web server is starting it again.";
    } else if (!host.alive && host.lastStatus === "unavailable") {
      state = SERVICE_STATE.CRASHED;
      hostNote = "The worker program is missing (node_modules/tsx). Run npm install, or set HIRING_WORKER_MODE=external and run it yourself.";
    } else if (!host.alive && host.lastStatus === "waiting_for_redis") {
      hostNote = "Waiting for Redis. The web server starts it by itself as soon as Redis is back.";
    } else if (!host.alive) {
      state = SERVICE_STATE.STARTING;
      hostNote = "The web server is starting it.";
    }
  }

  const blockedBy = (def.needs || []).filter((id) => infraDown.includes(id));
  const idle = state === SERVICE_STATE.STOPPED || state === SERVICE_STATE.CRASHED || state === SERVICE_STATE.NOT_RESPONDING;

  let detail = "";
  if (state === SERVICE_STATE.RUNNING) {
    if (def.id === SERVICE_ID.WORKER) detail = extras.waiting ? `Working through the queue (${extras.waiting} waiting).` : "Idle, ready for jobs.";
    else if (def.id === SERVICE_ID.ENGINE) detail = extras.activeSessions ? `${extras.activeSessions} interview${extras.activeSessions === 1 ? "" : "s"} in progress.` : "Ready for interviews.";
    else if (def.id === SERVICE_ID.AI_ENGINE) detail = "Ready.";
    else detail = "You are using it now.";
  } else if (state === SERVICE_STATE.STARTING) {
    detail = "Starting. The AI engine can take up to a minute the first time.";
  } else if (state === SERVICE_STATE.CRASHED) {
    detail = "It stopped unexpectedly. The last lines it wrote are below.";
  } else if (state === SERVICE_STATE.NOT_RESPONDING) {
    detail = "It is running but not answering. Restart it; the last lines it wrote are below.";
  } else if (def.id === SERVICE_ID.WORKER && extras.waiting) {
    detail = `Not running. ${extras.waiting} job${extras.waiting === 1 ? " is" : "s are"} waiting for it.`;
  } else {
    detail = "Not running.";
  }
  if (hostNote) detail = hostNote;
  else if (host && state === SERVICE_STATE.RUNNING) detail = `${detail} Run by the web server.`;

  return {
    id: def.id,
    label: def.label,
    role: def.role,
    state,
    managed: Boolean(managed.managed),
    hosted: Boolean(def.hosted),
    pid: managed.managed ? managed.pid : null,
    detail,
    blockedBy,
    controllable: def.controllable,
    canStart: canControl && def.controllable && idle && blockedBy.length === 0,
    canStop: canControl && def.controllable && Boolean(managed.managed),
    manual: def.manual,
    local: def.local,
    activeSessions: extras.activeSessions || 0,
    waiting: extras.waiting ?? null,
    logTail: idle || state === SERVICE_STATE.STARTING ? logTail : [],
  };
}

/** ready = everything the pipeline needs is up; degraded = something is off; blocked = Postgres or Redis is down. */
export function summarise({ infra, services, config }) {
  const infraDown = infra.filter((i) => !i.up);
  const stopped = services.filter((s) => s.id !== SERVICE_ID.WEB && s.state !== SERVICE_STATE.RUNNING);
  const missingConfig = config.filter((c) => !c.ok && !c.optional);
  let overall = "ready";
  let summary = "Everything the hiring pipeline needs is running.";
  if (infraDown.length) {
    overall = "blocked";
    summary = `${infraDown.map((i) => i.label).join(" and ")} ${infraDown.length === 1 ? "is" : "are"} not reachable.`;
  } else if (stopped.length || missingConfig.length) {
    overall = "degraded";
    const parts = [];
    if (stopped.length) parts.push(`${stopped.map((s) => s.label).join(", ")} ${stopped.length === 1 ? "is" : "are"} not running`);
    if (missingConfig.length) parts.push(`${missingConfig.length} setting${missingConfig.length === 1 ? " is" : "s are"} missing`);
    summary = `${parts.join(" and ")}.`;
  }
  return { overall, summary, stopped: stopped.map((s) => s.id) };
}

/**
 * Observe everything. `deps` lets tests replace the network: { env, now, redis, query, queueOverview, httpProbe }.
 */
export async function getSystemStatus(deps = {}) {
  const env = deps.env || process.env;
  const now = deps.now ? deps.now() : Date.now();
  const redis = deps.redis || (() => getRedisClient());
  const httpProbe = deps.httpProbe || probeHttp;
  const query = deps.query || (() => db.execute(sql`select 1`));
  const canControl = controlEnabled(env);

  const [pg, rd] = await Promise.all([
    probePostgres({ query }),
    probeRedis({ redis: deps.redis ? deps.redis : { ping: () => redis().ping() } }),
  ]);
  const infra = [
    { id: INFRA_ID.POSTGRES, label: "Database (Postgres)", up: pg.up, hint: pg.up ? null : INFRA_HINT[INFRA_ID.POSTGRES] },
    { id: INFRA_ID.REDIS, label: "Redis (job queue)", up: rd.up, hint: rd.up ? null : INFRA_HINT[INFRA_ID.REDIS] },
  ];
  const infraDown = infra.filter((i) => !i.up).map((i) => i.id);

  let overview = null;
  if (rd.up) {
    try {
      overview = await (deps.queueOverview ? deps.queueOverview() : getQueueOverview());
    } catch {
      overview = null;
    }
  }

  const defs = getServiceDefs(env);
  const services = await Promise.all(defs.map(async (def) => {
    let probe = { up: false };
    let extras = {};
    if (def.id === SERVICE_ID.WEB) {
      probe = { up: true };
    } else if (def.id === SERVICE_ID.WORKER) {
      const worker = workerFromOverview(overview);
      probe = { up: worker.up };
      extras = { waiting: worker.waiting, failed: worker.failed, lastSeenMs: worker.lastSeenMs, host: def.hosted ? getHostState({ env }) : null };
    } else {
      probe = await httpProbe(def.healthUrl);
      extras = { activeSessions: probe.body?.activeSessions };
    }
    const managed = def.controllable ? getManaged(def.id, deps.cwd ? { cwd: deps.cwd } : {}) : { managed: false, crashed: false };
    const tail = def.controllable && !probe.up ? readLogTail(def.id, { cwd: deps.cwd || process.cwd(), maxLines: 12 }) : [];
    return describeService({ def, probe, managed, infraDown, canControl, now, logTail: tail, extras });
  }));

  const config = checkConfig(env).map(({ id, label, ok, optional, impact, hint }) => ({ id, label, ok, optional: Boolean(optional), impact, hint: ok ? null : hint }));
  return { checkedAt: new Date(now).toISOString(), controlEnabled: canControl, infra, services, config, ...summarise({ infra, services, config }) };
}

/** Is one program answering right now? Used by start, so it never starts something that is already up. */
export async function isServiceUp(def, deps = {}) {
  if (def.id === SERVICE_ID.WEB) return true;
  if (def.id === SERVICE_ID.WORKER) {
    try {
      return workerFromOverview(await (deps.queueOverview ? deps.queueOverview() : getQueueOverview())).up;
    } catch {
      return false;
    }
  }
  return (await (deps.httpProbe || probeHttp)(def.healthUrl)).up;
}
