"use client";

import { useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  AlertTriangle, ArrowRight, Ban, CalendarCheck, Check, CheckCircle2, ChevronDown, Circle, Clock, Hand, Loader2,
  MailCheck, MessagesSquare, Pause, Play, Square, XCircle,
} from "lucide-react";
import { useDialog } from "@/components/ui/DialogProvider";

const MODE_LABEL = { assisted: "Semi-auto", autopilot: "Auto" };
const RUN_STATUS = {
  queued: { label: "Starting", dot: "bg-base-content/40", text: "text-base-content/70" },
  running: { label: "Working", dot: "bg-info animate-pulse", text: "text-info" },
  waiting: { label: "Active", dot: "bg-success", text: "text-success" },
  paused: { label: "Paused", dot: "bg-warning", text: "text-warning" },
  completed: { label: "Finished", dot: "bg-success", text: "text-success" },
  failed: { label: "Stopped (error)", dot: "bg-error", text: "text-error" },
  cancelled: { label: "Stopped", dot: "bg-base-content/40", text: "text-base-content/60" },
};
const ACTIVE = ["queued", "running", "waiting", "paused", "paused_at_checkpoint"];

const ACTION_ICON = {
  executed: <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" />,
  approved: <Clock className="h-3.5 w-3.5 text-info shrink-0 mt-0.5" />,
  pending: <Hand className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />,
  rejected: <XCircle className="h-3.5 w-3.5 text-base-content/40 shrink-0 mt-0.5" />,
  failed: <AlertTriangle className="h-3.5 w-3.5 text-error shrink-0 mt-0.5" />,
  superseded: <Circle className="h-3.5 w-3.5 opacity-30 shrink-0 mt-0.5" />,
};

/** One line saying what the agent is doing. */
export function activityLine(run) {
  const r = run.results || {};
  const c = r.counts || {};
  const conv = r.conversations || {};
  if (run.status === "failed") return run.errorMessage || "Stopped after an error.";
  if (run.status === "cancelled") return run.errorMessage || "Stopped.";
  if (run.status === "completed") {
    return `Finished: ${c.done || 0} contacted, ${c.skipped || 0} skipped${conv.meetings ? `, ${conv.meetings} meeting${conv.meetings === 1 ? "" : "s"} booked` : ""}.`;
  }
  if (run.status === "paused") return "Paused. Nothing is sent or answered until you resume.";
  if (run.status === "queued") return "Starting…";
  const parts = [];
  const preparing = (c.research || 0) + (c.score || 0) + (c.write || 0);
  if (preparing) parts.push(`preparing ${preparing} lead${preparing === 1 ? "" : "s"}`);
  if (c.awaiting_acceptance) parts.push(`waiting for ${c.awaiting_acceptance} to accept on LinkedIn`);
  if (r.deferred) parts.push(`${r.deferred} waiting for tomorrow's email limit`);
  if (conv.open) parts.push(`watching ${conv.open} conversation${conv.open === 1 ? "" : "s"} for replies`);
  return parts.length ? `${parts.join(" · ").replace(/^./, (s) => s.toUpperCase())}.` : `${c.done || 0} contacted so far. Watching for new work.`;
}

// ─── Pieces ───

function StatusPill({ status }) {
  const s = RUN_STATUS[status] || { label: status, dot: "bg-base-content/40", text: "" };
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${s.text}`}>
      <span className={`h-2 w-2 rounded-full ${s.dot}`} /> {s.label}
    </span>
  );
}

function ModePill({ mode }) {
  return <span className="rounded-full border border-base-300 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-base-content/70">{MODE_LABEL[mode] || mode}</span>;
}

const STEP_STYLE = {
  completed: { ring: "bg-success text-success-content border-success", line: "bg-success" },
  running: { ring: "bg-info/15 text-info border-info", line: "bg-base-300" },
  waiting: { ring: "bg-info/15 text-info border-info", line: "bg-base-300" },
  awaiting_approval: { ring: "bg-warning/20 text-warning border-warning", line: "bg-base-300" },
  pending: { ring: "bg-base-100 text-base-content/30 border-base-300", line: "bg-base-300" },
  skipped: { ring: "bg-base-100 text-base-content/25 border-dashed border-base-300", line: "bg-base-300" },
};

function stepNote(step) {
  const o = step.output || {};
  if (step.status === "skipped") return "Not used";
  switch (step.stepKey) {
    case "research": return o.left ? `${o.left} left` : null;
    case "score": return o.left ? `${o.left} left` : o.skipped ? `${o.skipped} skipped` : null;
    case "write_messages": return o.left ? `${o.left} left` : null;
    case "approvals": return o.pending ? `${o.pending} waiting` : null;
    case "outreach": return o.sent ? `${o.sent} sent` : o.queued ? `${o.queued} queued` : null;
    case "follow_up": return o.open ? `${o.open} open` : o.replied ? `${o.replied} replied` : null;
    default: return null;
  }
}

function Stepper({ steps, labels }) {
  if (!steps?.length) return null;
  return (
    <ol className="flex w-full items-start overflow-x-auto pb-1">
      {steps.map((step, i) => {
        const style = STEP_STYLE[step.status] || STEP_STYLE.pending;
        const note = stepNote(step);
        const icon = step.status === "completed" ? <Check className="h-3.5 w-3.5" />
          : step.status === "awaiting_approval" ? <Hand className="h-3.5 w-3.5" />
          : step.status === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : step.status === "waiting" ? <Clock className="h-3.5 w-3.5" />
          : <span className="text-[11px] font-semibold">{i + 1}</span>;
        return (
          <li key={step.stepKey} className="relative flex min-w-[5.5rem] flex-1 flex-col items-center text-center">
            {i > 0 && <span className={`absolute right-1/2 top-3.5 h-0.5 w-full -translate-y-1/2 ${STEP_STYLE[steps[i - 1].status]?.line || "bg-base-300"}`} aria-hidden />}
            <span className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 ${style.ring}`}>{icon}</span>
            <span className={`mt-1.5 px-1 text-xs font-medium leading-tight ${["pending", "skipped"].includes(step.status) ? "text-base-content/45" : ""}`}>{labels?.[step.stepKey] || step.stepKey}</span>
            {note && <span className="text-[11px] text-base-content/50">{note}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function Stat({ icon: Icon, label, value, tone = "", hint }) {
  return (
    <div className="rounded-lg border border-base-300 bg-base-100 px-3 py-2.5" title={hint || ""}>
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-base-content/55"><Icon className="h-3.5 w-3.5" /> {label}</p>
      <p className={`mt-0.5 text-xl font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

// ─── Card ───

/**
 * One sales agent run. `compact` shows a one-line row (earlier runs) that expands to the full card.
 */
export default function SalesRunCard({ run, stepLabels, onChanged, onOpenApprovals, compact = false }) {
  const { confirm } = useDialog();
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState(null);
  const [showLog, setShowLog] = useState(false);
  const [expanded, setExpanded] = useState(!compact);
  const r = run.results || {};
  const counts = r.counts || {};
  const conv = r.conversations || {};
  const active = ACTIVE.includes(run.status);
  const pending = active ? r.pendingApprovals || 0 : 0;

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

  const started = run.startedAt || run.createdAt;
  const startedText = started ? new Date(started).toLocaleDateString([], { day: "numeric", month: "short" }) : null;

  if (!expanded) {
    return (
      <button type="button" onClick={() => setExpanded(true)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-base-300 bg-base-100 px-4 py-3 text-left transition-colors hover:border-primary/40">
        <span className="min-w-[12rem] flex-1 font-medium">{run.campaignName || "Campaign removed"}</span>
        <ModePill mode={run.mode} />
        <StatusPill status={run.status} />
        <span className="text-xs tabular-nums text-base-content/60">{counts.done || 0} contacted · {conv.replied || 0} replied · {conv.meetings || 0} meetings</span>
        {startedText && <span className="text-xs text-base-content/40">{startedText}</span>}
        <ChevronDown className="h-4 w-4 text-base-content/40" />
      </button>
    );
  }

  return (
    <article className="overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-sm">
      <header className="flex flex-wrap items-center gap-3 border-b border-base-300 px-5 py-3.5">
        <div className="min-w-[12rem] flex-1">
          <h3 className="font-semibold leading-tight">{run.campaignName || "Campaign removed"}</h3>
          {startedText && <p className="mt-0.5 text-xs text-base-content/55">Started {startedText}</p>}
        </div>
        <ModePill mode={run.mode} />
        <StatusPill status={run.status} />
        {active ? (
          <div className="flex items-center gap-1 border-l border-base-300 pl-3">
            {run.status === "paused" ? (
              <button className="btn btn-primary btn-xs gap-1" disabled={busy} onClick={() => control("resume")}><Play className="h-3 w-3" /> Resume</button>
            ) : (
              <button className="btn btn-ghost btn-xs gap-1" disabled={busy} onClick={() => control("pause")}><Pause className="h-3 w-3" /> Pause</button>
            )}
            <button className="btn btn-ghost btn-xs gap-1 text-base-content/70" disabled={busy} onClick={() => control("cancel")}><Square className="h-3 w-3" /> Stop</button>
          </div>
        ) : compact ? (
          <button className="btn btn-ghost btn-xs" title="Collapse" onClick={() => setExpanded(false)}><ChevronDown className="h-4 w-4 rotate-180" /></button>
        ) : null}
      </header>

      <div className="space-y-4 px-5 py-4">
        {pending > 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5">
            <Hand className="h-4 w-4 text-warning" />
            <p className="flex-1 text-sm">
              <span className="font-semibold">{pending} message{pending === 1 ? "" : "s"} need{pending === 1 ? "s" : ""} your approval</span>
              {run.status === "paused" && <span className="text-base-content/60"> · the agent is paused</span>}
            </p>
            <button className="btn btn-warning btn-sm gap-1" onClick={onOpenApprovals}>Review <ArrowRight className="h-3.5 w-3.5" /></button>
          </div>
        ) : (
          <p className="text-sm text-base-content/75">{activityLine(run)}</p>
        )}

        <Stepper steps={run.steps} labels={stepLabels} />

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Stat icon={MailCheck} label="Contacted" value={counts.done || 0} />
          <Stat icon={Hand} label="Awaiting you" value={pending} tone={pending ? "text-warning" : ""} />
          <Stat icon={MessagesSquare} label="Replied" value={`${conv.replied || 0}${conv.total ? ` / ${conv.total}` : ""}`} />
          <Stat icon={CalendarCheck} label="Meetings" value={conv.meetings || 0} tone={conv.meetings ? "text-success" : ""} />
          <Stat
            icon={Ban}
            label="Skipped · blocked"
            value={`${counts.skipped || 0} · ${counts.blocked || 0}`}
            tone={counts.blocked ? "text-error" : ""}
            hint={counts.blocked && r.blocked ? `Blocked: ${r.blocked}` : "Skipped: poor fit or no company name"}
          />
        </div>
        {counts.blocked > 0 && r.blocked && (
          <p className="flex items-start gap-1.5 text-xs text-base-content/60"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-error" /> {counts.blocked} blocked: {r.blocked}</p>
        )}

        {r.lastDone?.length > 0 && (
          <div className="rounded-lg bg-base-200/60 px-3 py-2">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-base-content/50">Latest</p>
            <ul className="space-y-0.5 text-xs text-base-content/75">
              {r.lastDone.slice(-3).map((line, i) => <li key={i} className="truncate">{line}</li>)}
            </ul>
          </div>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-base-300 bg-base-200/30 px-5 py-2">
        <button className="btn btn-ghost btn-xs gap-1 !normal-case" onClick={toggleLog}>
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showLog ? "rotate-180" : ""}`} /> Activity log
        </button>
        <span className="flex-1" />
        {conv.total > 0 && (
          <Link href="/dashboard/sales/conversations" className="btn btn-ghost btn-xs gap-1 !normal-case"><MessagesSquare className="h-3.5 w-3.5" /> Conversations</Link>
        )}
        {conv.meetings > 0 && (
          <Link href="/dashboard/sales/meetings" className="btn btn-ghost btn-xs gap-1 !normal-case"><CalendarCheck className="h-3.5 w-3.5" /> Meetings</Link>
        )}
      </footer>
      {showLog && (
        <ul className="max-h-72 divide-y divide-base-300 overflow-y-auto border-t border-base-300 text-xs">
          {!log ? (
            <li className="p-3 text-center"><Loader2 className="inline h-4 w-4 animate-spin" /></li>
          ) : log.length === 0 ? (
            <li className="p-3 text-base-content/50">Nothing yet.</li>
          ) : (
            log.map((a) => (
              <li key={a.id} className="flex gap-2 px-5 py-2">
                {ACTION_ICON[a.status] || ACTION_ICON.superseded}
                <span className="flex-1">
                  {a.summary}
                  {a.decidedBy && a.decidedBy !== "agent" && a.status !== "pending" && <span className="text-base-content/50"> · {a.status} by you</span>}
                </span>
                <time className="whitespace-nowrap text-base-content/40">{new Date(a.executedAt || a.createdAt).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time>
              </li>
            ))
          )}
        </ul>
      )}
    </article>
  );
}
