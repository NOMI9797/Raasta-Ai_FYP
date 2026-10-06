"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import {
  AlertTriangle, CheckCircle2, ChevronDown, Circle, Clock, Hand, Loader2, Pause, Play, Square, XCircle,
} from "lucide-react";
import { useDialog } from "@/components/ui/DialogProvider";

const MODE_LABEL = { assisted: "Semi-auto", autopilot: "Auto" };
const RUN_BADGE = {
  queued: ["Starting", "badge-ghost"],
  running: ["Working", "badge-info"],
  waiting: ["Active", "badge-info"],
  paused: ["Paused", "badge-warning"],
  completed: ["Finished", "badge-success"],
  failed: ["Stopped (error)", "badge-error"],
  cancelled: ["Stopped", "badge-ghost"],
};
const ACTIVE = ["queued", "running", "waiting", "paused", "paused_at_checkpoint"];

const STEP_ICON = {
  completed: <CheckCircle2 className="h-4 w-4 text-success" />,
  running: <Loader2 className="h-4 w-4 text-info animate-spin" />,
  waiting: <Clock className="h-4 w-4 text-info" />,
  awaiting_approval: <Hand className="h-4 w-4 text-warning" />,
  skipped: <Circle className="h-4 w-4 opacity-20" />,
  pending: <Circle className="h-4 w-4 opacity-30" />,
};

const ACTION_ICON = {
  executed: <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" />,
  approved: <Clock className="h-3.5 w-3.5 text-info shrink-0 mt-0.5" />,
  pending: <Hand className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />,
  rejected: <XCircle className="h-3.5 w-3.5 text-base-content/40 shrink-0 mt-0.5" />,
  failed: <AlertTriangle className="h-3.5 w-3.5 text-error shrink-0 mt-0.5" />,
  superseded: <Circle className="h-3.5 w-3.5 opacity-30 shrink-0 mt-0.5" />,
};

/** One line saying what the agent is doing and whether it needs the person. */
export function activityLine(run) {
  const r = run.results || {};
  const c = r.counts || {};
  if (run.status === "failed") return run.errorMessage || "Stopped after an error.";
  if (run.status === "cancelled") return run.errorMessage || "Stopped.";
  if (run.status === "completed") return `Finished: ${c.done || 0} contacted, ${c.skipped || 0} skipped.`;
  if (run.status === "paused") return "Paused. Nothing happens until you resume.";
  if (run.status === "queued") return "Starting…";
  const parts = [];
  if (r.pendingApprovals) parts.push(`${r.pendingApprovals} message${r.pendingApprovals === 1 ? " needs" : "s need"} your approval`);
  const preparing = (c.research || 0) + (c.score || 0) + (c.write || 0);
  if (preparing) parts.push(`preparing ${preparing} lead${preparing === 1 ? "" : "s"}`);
  if (c.awaiting_acceptance) parts.push(`waiting for ${c.awaiting_acceptance} to accept on LinkedIn`);
  if (r.deferred) parts.push(`${r.deferred} waiting for tomorrow's limit`);
  if (c.blocked) parts.push(`${c.blocked} blocked: ${r.blocked}`);
  return parts.length ? `${parts.join(" · ")}.` : `${c.done || 0} contacted so far. Watching for new work.`;
}

export default function SalesRunCard({ run, stepLabels, onChanged, onOpenApprovals }) {
  const { confirm } = useDialog();
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState(null);
  const [showLog, setShowLog] = useState(false);
  const [badge, badgeCls] = RUN_BADGE[run.status] || [run.status, "badge-ghost"];
  const counts = run.results?.counts || {};

  const control = async (action) => {
    if (action === "cancel") {
      const ok = await confirm({
        title: "Stop the sales agent?",
        message: "It stops for good and withdraws its requests from your approvals. Messages already sent stay sent.",
        confirmText: "Stop it",
        tone: "warning",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/agents/runs/${run.id}/${action}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      onChanged?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleLog = async () => {
    const next = !showLog;
    setShowLog(next);
    if (next) {
      const res = await fetch(`/api/agents/runs/${run.id}`);
      const data = await res.json();
      setLog(data.actions || []);
    }
  };

  return (
    <article className="rounded-xl border border-base-300 bg-base-100 p-4 space-y-3">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold flex-1 min-w-[10rem]">{run.campaignName || "Campaign removed"}</h3>
        <span className="badge badge-outline badge-sm">{MODE_LABEL[run.mode] || run.mode}</span>
        <span className={`badge badge-sm ${badgeCls}`}>{badge}</span>
        {ACTIVE.includes(run.status) && (
          <div className="flex gap-1">
            {run.status === "paused" ? (
              <button className="btn btn-xs gap-1" disabled={busy} onClick={() => control("resume")}><Play className="h-3 w-3" /> Resume</button>
            ) : (
              <button className="btn btn-xs gap-1" disabled={busy} onClick={() => control("pause")}><Pause className="h-3 w-3" /> Pause</button>
            )}
            <button className="btn btn-xs btn-ghost gap-1" disabled={busy} onClick={() => control("cancel")}><Square className="h-3 w-3" /> Stop</button>
          </div>
        )}
      </header>

      <p className="text-sm">
        {activityLine(run)}{" "}
        {run.results?.pendingApprovals > 0 && ACTIVE.includes(run.status) && (
          <button className="link link-primary" onClick={onOpenApprovals}>Review now</button>
        )}
      </p>

      <ol className="flex flex-wrap gap-x-4 gap-y-2">
        {(run.steps || []).map((s) => (
          <li key={s.stepKey} className="flex items-center gap-1.5 text-xs" title={s.status.replace(/_/g, " ")}>
            {STEP_ICON[s.status] || STEP_ICON.pending}
            <span className={s.status === "pending" || s.status === "skipped" ? "text-base-content/50" : ""}>{stepLabels?.[s.stepKey] || s.stepKey}</span>
          </li>
        ))}
      </ol>

      {Object.keys(counts).length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {[
            ["done", "contacted", "badge-success"],
            ["awaiting_approval", "awaiting you", "badge-warning"],
            ["send", "about to send", "badge-info"],
            ["awaiting_acceptance", "waiting on LinkedIn", "badge-info"],
            ["research", "to research", "badge-ghost"],
            ["score", "to score", "badge-ghost"],
            ["write", "to write", "badge-ghost"],
            ["skipped", "skipped", "badge-ghost"],
            ["blocked", "blocked", "badge-error"],
            ["stopped", "stopped", "badge-ghost"],
          ].filter(([k]) => counts[k]).map(([k, label, cls]) => (
            <span key={k} className={`badge badge-sm ${cls}`}>{counts[k]} {label}</span>
          ))}
        </div>
      )}

      {run.results?.lastDone?.length > 0 && (
        <ul className="text-xs text-base-content/60 list-disc pl-4">
          {run.results.lastDone.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      )}

      <button className="btn btn-ghost btn-xs gap-1 !normal-case" onClick={toggleLog}>
        <ChevronDown className={`h-3 w-3 transition-transform ${showLog ? "rotate-180" : ""}`} /> Activity log
      </button>
      {showLog && (
        <ul className="max-h-72 overflow-y-auto rounded-lg border border-base-300 divide-y divide-base-300 text-xs">
          {!log ? (
            <li className="p-3 text-center"><Loader2 className="h-4 w-4 animate-spin inline" /></li>
          ) : log.length === 0 ? (
            <li className="p-3 text-base-content/50">Nothing yet.</li>
          ) : (
            log.map((a) => (
              <li key={a.id} className="flex gap-2 px-3 py-2">
                {ACTION_ICON[a.status] || ACTION_ICON.superseded}
                <span className="flex-1">
                  {a.summary}
                  {a.decidedBy && a.decidedBy !== "agent" && a.status !== "pending" && <span className="text-base-content/50"> · {a.status} by you</span>}
                </span>
                <time className="text-base-content/40 whitespace-nowrap">{new Date(a.executedAt || a.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
              </li>
            ))
          )}
        </ul>
      )}
    </article>
  );
}
