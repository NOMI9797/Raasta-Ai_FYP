"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, CheckCircle2, ClipboardCopy, Loader2, Play, RotateCw, ScrollText, Square } from "lucide-react";

const STATE = {
  running: { label: "Running", badge: "badge-success" },
  starting: { label: "Starting", badge: "badge-info" },
  stopped: { label: "Stopped", badge: "badge-ghost" },
  crashed: { label: "Stopped unexpectedly", badge: "badge-error" },
  not_responding: { label: "Not responding", badge: "badge-warning" },
};

function LogViewer({ id }) {
  const [lines, setLines] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/system/services/${id}/logs`, { cache: "no-store" });
        const data = await res.json();
        if (alive && res.ok) setLines(data.lines);
      } catch {
        /* the next poll tries again */
      }
    };
    load();
    const timer = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id]);
  if (lines === null) return <Loader2 className="h-4 w-4 animate-spin" />;
  return (
    <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-base-300/60 p-3 text-[11px] leading-snug whitespace-pre-wrap break-words" aria-label="Recent output">
      {lines.length ? lines.join("\n") : "Nothing written yet. Programs started from a terminal print there, not here."}
    </pre>
  );
}

/**
 * One program: what it does, whether it is up, and the buttons that make sense right now.
 * `onAction(id, "start" | "stop" | "restart")` does the work (and asks first when stopping hurts).
 */
export default function ProgramCard({ service, busy, controlEnabled, onAction }) {
  const [showLog, setShowLog] = useState(false);
  const meta = STATE[service.state] || STATE.stopped;
  const working = busy === service.id;
  const idle = service.state === "stopped" || service.state === "crashed" || service.state === "not_responding";
  const showManual = idle && service.id !== "web" && (!controlEnabled || !service.controllable);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(service.manual);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy. Select the text and copy it.");
    }
  };

  return (
    <section className="rounded-xl border border-base-300 bg-base-100 p-4 space-y-3" aria-label={service.label}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{service.label}</h3>
        <span className={`badge badge-sm gap-1 ${meta.badge}`}>
          {service.state === "starting" && <Loader2 className="h-3 w-3 animate-spin" />}
          {service.state === "running" && <CheckCircle2 className="h-3 w-3" />}
          {(service.state === "crashed" || service.state === "not_responding") && <AlertTriangle className="h-3 w-3" />}
          {meta.label}
        </span>
        {service.state === "running" && service.id !== "web" && (
          <span className="text-xs text-base-content/50">{service.hosted ? "run by the web server" : service.managed ? "started from the app" : "started from a terminal"}</span>
        )}
      </div>
      <p className="text-sm text-base-content/70">{service.role}</p>
      <p className="text-sm">{service.detail}</p>
      {service.blockedBy.length > 0 && <p className="text-xs text-warning">It needs {service.blockedBy.join(" and ")} to be reachable first.</p>}

      {service.controllable && controlEnabled && (
        <div className="flex flex-wrap items-center gap-2">
          {service.canStart && (
            <button type="button" className="btn btn-primary btn-sm !normal-case gap-1" disabled={Boolean(busy)} onClick={() => onAction(service.id, "start")}>
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Start
            </button>
          )}
          {service.canStop && (
            <>
              <button type="button" className="btn btn-outline btn-sm !normal-case gap-1" disabled={Boolean(busy)} onClick={() => onAction(service.id, "restart")}>
                {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />} Restart
              </button>
              <button type="button" className="btn btn-ghost btn-sm !normal-case gap-1 text-error" disabled={Boolean(busy)} onClick={() => onAction(service.id, "stop")}>
                <Square className="h-4 w-4" /> Stop
              </button>
            </>
          )}
          <button type="button" className="btn btn-ghost btn-sm !normal-case gap-1 ml-auto" onClick={() => setShowLog((v) => !v)} aria-expanded={showLog}>
            <ScrollText className="h-4 w-4" /> {showLog ? "Hide output" : "Output"}
          </button>
        </div>
      )}

      {showManual && (
        <div className="rounded-lg bg-base-200 p-3 text-xs space-y-1">
          <p className="text-base-content/70">{service.controllable ? "Starting from the app is off here. Start it yourself:" : "This one is not on this machine. Start it where it runs:"}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all">{service.manual}</code>
            <button type="button" className="btn btn-ghost btn-xs" onClick={copy} aria-label="Copy the command"><ClipboardCopy className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      )}

      {!showLog && service.logTail.length > 0 && (
        <pre className="max-h-32 overflow-auto rounded-lg bg-base-300/60 p-3 text-[11px] leading-snug whitespace-pre-wrap break-words" aria-label="Last output">
          {service.logTail.join("\n")}
        </pre>
      )}
      {showLog && <LogViewer id={service.id} />}
    </section>
  );
}
