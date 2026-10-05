"use client";

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, RotateCcw } from "lucide-react";

const POLL_MS = 10000;

function ago(ms) {
  if (ms == null) return "never";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
}

function Stat({ label, value, tone = "" }) {
  return (
    <div className="bg-base-100 border border-base-300 rounded-lg px-3 py-2">
      <p className="text-xs text-base-content/60">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${tone}`}>{value ?? "–"}</p>
    </div>
  );
}

/**
 * Health of the hiring job queue (admin only): what is waiting, whether the worker is alive,
 * and failed jobs that can be retried.
 */
export default function HiringQueueCard() {
  const [queue, setQueue] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/hiring-queue");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load the queue");
      setQueue(data.queue);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const retry = async (id) => {
    setRetrying(id);
    try {
      const res = await fetch("/api/admin/hiring-queue/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Retry failed");
      toast.success("Queued again");
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRetrying(null);
    }
  };

  const worker = queue?.worker;
  const waiting = queue?.waiting;
  const stuck = queue && !worker.active && ((waiting ?? 0) > 0 || queue.delayed > 0);

  return (
    <section className="bg-base-200 rounded-xl shadow-sm border border-base-300" aria-labelledby="hiring-queue-title">
      <div className="px-4 py-3 border-b border-base-300 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="hiring-queue-title" className="font-semibold text-base-content">Hiring queue</h2>
          <p className="text-xs text-base-content/60">
            Screening, invites, interview analysis and the recruiter agent run through this queue. Refreshes every 10 seconds.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {worker && (
            worker.active ? (
              <span className="badge badge-success gap-1"><CheckCircle2 size={12} /> Worker running</span>
            ) : worker.seen ? (
              <span className="badge badge-warning gap-1"><AlertTriangle size={12} /> Worker stopped · last seen {ago(worker.lastSeenMs)}</span>
            ) : (
              <span className="badge badge-error gap-1"><AlertTriangle size={12} /> No worker has connected</span>
            )
          )}
          <button className="btn btn-ghost btn-xs gap-1" onClick={load} aria-label="Refresh the queue">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {loading ? (
          <div className="flex justify-center py-4"><Loader2 className="animate-spin text-primary" size={20} /></div>
        ) : error ? (
          <div className="alert alert-error py-2 text-sm"><span>{error}</span></div>
        ) : (
          <>
            {stuck && (
              <div className="alert alert-warning py-2 text-sm">
                <AlertTriangle size={16} />
                <span>
                  Jobs are waiting but no worker is running, so screening, invites and the agent are paused.
                  Start it with <code className="font-mono">npm run worker:hiring</code>.
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Waiting" value={waiting} tone={stuck && waiting ? "text-warning" : ""} />
              <Stat label="Running now" value={queue.inFlight} />
              <Stat label="Scheduled for later" value={queue.delayed} />
              <Stat label="Failed" value={queue.deadTotal} tone={queue.deadTotal ? "text-error" : ""} />
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-2">Failed jobs {queue.deadTotal > queue.dead.length ? `(newest ${queue.dead.length} of ${queue.deadTotal})` : ""}</h3>
              {queue.dead.length === 0 ? (
                <p className="text-sm text-base-content/60">No failed jobs.</p>
              ) : (
                <div className="overflow-x-auto border border-base-300 rounded-lg bg-base-100">
                  <table className="table table-sm">
                    <thead>
                      <tr><th>When</th><th>Job</th><th>Error</th><th className="text-right">Tries</th><th><span className="sr-only">Retry</span></th></tr>
                    </thead>
                    <tbody>
                      {queue.dead.map((job) => (
                        <tr key={job.id}>
                          <td className="whitespace-nowrap text-xs">{job.failedAt ? new Date(job.failedAt).toLocaleString() : "–"}</td>
                          <td className="font-mono text-xs whitespace-nowrap">{job.type}</td>
                          <td className="text-xs max-w-md break-words">{job.error}</td>
                          <td className="text-right tabular-nums">{job.attempt + 1}</td>
                          <td className="text-right">
                            <button className="btn btn-outline btn-xs gap-1" disabled={retrying === job.id} onClick={() => retry(job.id)}>
                              {retrying === job.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Retry
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
