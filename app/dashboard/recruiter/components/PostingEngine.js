"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { AlertTriangle, CheckCircle2, Circle, ExternalLink, Hand, Image as ImageIcon, Loader2, Play, Square, Eye } from "lucide-react";
import { useDialog } from "@/components/ui/DialogProvider";
import { useServiceGuard } from "@/components/system/useServiceGuard";

const POLL_MS = 1500;
const runsKey = (jobId, platform) => ["posting-runs", jobId, platform];

async function request(url, options) {
  const res = await fetch(url, { cache: "no-store", ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

const shotUrl = (run, step) => `/api/hiring/posting-runs/${run.id}/shots/${step.shot}`;

function FieldChips({ fields }) {
  const shown = (fields || []).filter((f) => f.state !== "skipped" || f.note);
  if (shown.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-wrap gap-1">
      {shown.map((f) => (
        <li
          key={f.key}
          className={`badge badge-sm gap-1 h-auto py-0.5 whitespace-normal text-left ${f.state === "verified" ? "badge-success badge-outline" : f.state === "unverified" ? "badge-warning" : "badge-ghost"}`}
          title={f.note || ""}
        >
          {f.state === "verified" && <CheckCircle2 className="h-3 w-3 shrink-0" />}
          {f.state === "unverified" && <AlertTriangle className="h-3 w-3 shrink-0" />}
          <span>{f.label}{f.note ? `: ${f.note}` : ""}</span>
        </li>
      ))}
    </ul>
  );
}

function StepIcon({ status }) {
  if (status === "done") return <CheckCircle2 className="h-4 w-4 text-success" aria-label="Done" />;
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-primary" aria-label="In progress" />;
  if (status === "needs_you") return <Hand className="h-4 w-4 text-warning" aria-label="Needs you" />;
  if (status === "failed") return <AlertTriangle className="h-4 w-4 text-error" aria-label="Failed" />;
  return <Circle className="h-4 w-4 text-base-content/30" aria-label="Waiting" />;
}

function Timeline({ run }) {
  const steps = run.steps.filter((s) => s.status !== "pending" || run.live);
  if (steps.length === 0) return null;
  return (
    <ol className="space-y-2" aria-label="Steps">
      {steps.map((step) => (
        <li key={step.id} className="flex gap-2">
          <span className="mt-0.5"><StepIcon status={step.status} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-sm ${step.status === "pending" ? "text-base-content/50" : "font-medium"}`}>{step.label}</span>
              {step.shot && (
                <a href={shotUrl(run, step)} target="_blank" rel="noopener noreferrer" className="link text-xs inline-flex items-center gap-1" aria-label={`Screenshot of ${step.label}`}>
                  <ImageIcon className="h-3 w-3" /> Screenshot
                </a>
              )}
            </div>
            <FieldChips fields={step.fields} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function Banner({ run, onStartEngine }) {
  if (run.status === "queued") {
    return (
      <div className={`alert ${run.waitingForEngine ? "alert-warning" : "alert-info"} py-2 text-sm items-start`}>
        <Loader2 className="h-4 w-4 mt-0.5 shrink-0 animate-spin" />
        <div className="flex-1">
          <p>{run.waitingForEngine ? "Waiting for the posting engine. It does not seem to be running." : "Waiting for the posting engine to pick this up."}</p>
          {run.waitingForEngine && <button type="button" className="btn !normal-case btn-xs mt-1" onClick={onStartEngine}>Start the posting engine</button>}
        </div>
      </div>
    );
  }
  if (run.stale) {
    return (
      <div className="alert alert-warning py-2 text-sm items-start">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <p>The posting engine has stopped reporting. If the window is closed, this run ends by itself in a moment.</p>
      </div>
    );
  }
  if (run.status === "needs_you" || run.status === "awaiting_confirm") {
    const confirm = run.status === "awaiting_confirm";
    return (
      <div className={`alert ${confirm ? "alert-success" : "alert-warning"} py-2 text-sm items-start`} role="status">
        <Hand className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold">{confirm ? "Your turn: review and press Confirm" : "Needs you in the browser window"}</p>
          <p>{run.gate?.message}</p>
          <p className="text-xs opacity-80 mt-1">The window is open on the computer that runs Raasta-AI. If you cannot see it, look for it in the taskbar.</p>
        </div>
      </div>
    );
  }
  if (run.status === "running") {
    const current = run.steps.find((s) => s.status === "running");
    return (
      <div className="alert alert-info py-2 text-sm items-start" role="status">
        <Loader2 className="h-4 w-4 mt-0.5 shrink-0 animate-spin" />
        <p>{current ? `Filling in: ${current.label}.` : "Opening the window."} Watch it, or leave it be; it stops by itself when it needs you.</p>
      </div>
    );
  }
  return null;
}

function Result({ run, label }) {
  const message = run.outcome?.message;
  if (run.status === "published" && run.mode === "practice") {
    return (
      <div className="alert alert-success py-2 text-sm items-start">
        <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold">Practice finished</p>
          {message && <p>{message}</p>}
        </div>
      </div>
    );
  }
  if (run.status === "published") {
    return (
      <div className="alert alert-success py-2 text-sm items-start">
        <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold">Posted to {label}</p>
          {message && <p>{message}</p>}
          {run.outcome?.postUrl && (
            <a href={run.outcome.postUrl} target="_blank" rel="noopener noreferrer" className="link text-xs inline-flex items-center gap-1">Open the job <ExternalLink className="h-3 w-3" /></a>
          )}
        </div>
      </div>
    );
  }
  if (run.status === "rehearsed") {
    return (
      <div className="alert alert-info py-2 text-sm items-start">
        <Eye className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold">Rehearsal finished</p>
          {message && <p>{message}</p>}
          <p className="text-xs opacity-80 mt-1">{label} may keep an unfinished draft of this job in your account. You can delete it there.</p>
        </div>
      </div>
    );
  }
  if (run.status === "failed" || run.status === "cancelled") {
    return (
      <div className="alert alert-warning py-2 text-sm items-start">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold">{run.status === "cancelled" ? "The run was stopped" : "The run did not finish"}</p>
          {message && <p>{message}</p>}
        </div>
      </div>
    );
  }
  return null;
}

/**
 * The posting engine for one platform (Indeed or Rozee.pk): a visible browser window, on the computer that runs Raasta-AI, in which
 * the form is filled in like a person and the recruiter handles every check, sign-in and the final Confirm. This shows the
 * run live: what is being filled in, which fields were read back correctly, and when the window needs the person.
 * `onBeforeStart` saves unsaved edits to the post first; `onFinished(run)` lets the panel refresh when a run ends.
 */
export default function PostingEngine({ job, platform, text, over, onBeforeStart, onFinished }) {
  const queryClient = useQueryClient();
  const { confirm } = useDialog();
  const { ensure } = useServiceGuard();
  const [openings, setOpenings] = useState(1);
  const [starting, setStarting] = useState(null); // "practice" | "rehearsal" | "post"
  const [stopping, setStopping] = useState(false);
  const [details, setDetails] = useState(false);
  const key = runsKey(job.id, platform.id);

  const { data } = useQuery({
    queryKey: key,
    queryFn: () => request(`/api/hiring/jobs/${job.id}/posting-runs?platform=${platform.id}`),
    refetchInterval: (query) => (query.state.data?.runs?.[0]?.live ? POLL_MS : false),
    refetchOnWindowFocus: true,
    retry: false,
  });
  const run = data?.runs?.[0] || null;
  const live = Boolean(run?.live);

  // Tell the panel once when a run that was being watched ends (the job's history may have changed)
  const seen = useRef(null);
  useEffect(() => {
    if (!run) return;
    if (seen.current && seen.current.id === run.id && seen.current.live && !run.live) onFinished?.(run);
    seen.current = { id: run.id, live: run.live };
  }, [run, onFinished]);

  const blocked = !text.trim() ? "Write or generate the post first." : over ? `The post is over the ${platform.maxChars} character limit.` : null;

  const start = async (mode) => {
    if (mode === "post") {
      const ok = await confirm({
        title: `Post to ${platform.label} with the posting engine?`,
        message: `A browser window opens on this computer and the post is typed into ${platform.label}'s form. You handle any check or sign-in and press ${platform.label}'s own Confirm button; nothing is submitted before that. ${platform.label}'s terms restrict automated use of its employer site, so use this on your own account and at your own risk.`,
        confirmText: "Open the window",
        tone: "warning",
      });
      if (!ok) return;
    }
    if (!(await ensure("posting"))) return;
    setStarting(mode);
    try {
      await onBeforeStart?.();
      const body = { platform: platform.id, mode, options: platform.id === "indeed" ? { openings } : {} };
      const result = await request(`/api/hiring/jobs/${job.id}/posting-runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      queryClient.setQueryData(key, (old) => ({ runs: [result.run, ...(old?.runs || [])].slice(0, 5) }));
      toast.success(mode === "post" ? "The window is opening" : mode === "practice" ? "Practice started: it uses a practice site, no account" : "Rehearsal started: nothing will be posted");
    } catch (error) {
      toast.error(error.message || "Could not start");
    } finally {
      setStarting(null);
    }
  };

  const stop = async () => {
    setStopping(true);
    try {
      const result = await request(`/api/hiring/posting-runs/${run.id}/cancel`, { method: "POST" });
      queryClient.setQueryData(key, (old) => ({ runs: [result.run, ...(old?.runs || []).filter((r) => r.id !== run.id)] }));
    } catch (error) {
      toast.error(error.message || "Could not stop it");
    } finally {
      setStopping(false);
    }
  };

  const startEngine = async () => {
    await ensure("posting");
  };

  return (
    <div className="rounded-lg border border-base-300 bg-base-200/40 p-3 space-y-3" aria-label={`${platform.label} posting engine`}>
      <div>
        <h4 className="text-sm font-semibold">Post with the posting engine</h4>
        <p className="text-xs text-base-content/60">
          A browser window opens on this computer and the post is typed into {platform.label}&apos;s form like a person would. It stops and waits for you at every check, sign-in and decision, and never presses {platform.label}&apos;s final Confirm button: that is yours. <strong>Practice</strong> does all of it on a practice site, with no account involved.
        </p>
      </div>

      {run && live && <Banner run={run} onStartEngine={startEngine} />}
      {run && !live && <Result run={run} label={platform.label} />}

      {!live && (
        <div className="flex flex-wrap items-end gap-2">
          {platform.id === "indeed" && (
          <label className="form-control">
            <span className="label-text text-xs">People to hire</span>
            <input
              type="number"
              min={1}
              max={50}
              className="input input-bordered input-sm w-24"
              value={openings}
              onChange={(e) => setOpenings(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              aria-label="People to hire"
            />
          </label>
          )}
          <button type="button" className="btn !normal-case btn-outline btn-sm gap-1" onClick={() => start("practice")} disabled={Boolean(starting) || Boolean(blocked)} title={blocked || "Runs the whole thing on a practice site that stands in for the platform: no account, no network, nothing recorded"}>
            {starting === "practice" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Practice (no account)
          </button>
          <button type="button" className="btn !normal-case btn-outline btn-sm gap-1" onClick={() => start("rehearsal")} disabled={Boolean(starting) || Boolean(blocked)} title={blocked || `Fills in every step and checks it, then stops before ${platform.id === "rozee" ? "Publish Job" : "the final Confirm"}. Nothing is posted.`}>
            {starting === "rehearsal" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />} Rehearse (posts nothing)
          </button>
          <button type="button" className="btn !normal-case btn-primary btn-sm gap-1" onClick={() => start("post")} disabled={Boolean(starting) || Boolean(blocked)} title={blocked || `Opens the window; you press ${platform.label}'s ${platform.id === "rozee" ? "Publish Job" : "Confirm"} yourself`}>
            {starting === "post" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Post with the engine
          </button>
        </div>
      )}
      {!live && blocked && <p className="text-xs text-base-content/60">{blocked}</p>}

      {live && (
        <button type="button" className="btn !normal-case btn-ghost btn-sm gap-1" onClick={stop} disabled={stopping || run.cancelRequested}>
          {stopping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />} {run.cancelRequested ? "Stopping..." : "Stop"}
        </button>
      )}

      {run && (live || details) && <Timeline run={run} />}
      {run && !live && run.steps.length > 0 && (
        <button type="button" className="link text-xs" onClick={() => setDetails((v) => !v)}>{details ? "Hide the steps" : "Show what it did"}</button>
      )}
    </div>
  );
}
