"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  Gavel, Loader2, RefreshCw, ShieldAlert, Bot, Megaphone, UserCheck, Send, Award, CheckCircle2, ExternalLink,
} from "lucide-react";
import Sidebar from "@/components/layout/Sidebar";
import { useSidebar } from "@/components/layout/SidebarContext";
import TopBar from "@/components/layout/TopBar";
import { CANDIDATE_STATUS, STATUS_META } from "@/libs/hiring/statuses";
import { NEEDS_REVIEW } from "@/libs/hiring/final-evaluator"; // only imports statuses.js, so safe in the browser

const POLL_MS = 15000;

// Agent action types (libs/agent/policy.js AGENT_ACTION) shown in the inbox
const ACTION = {
  PUBLISH_POST: "publish_post",
  SHORTLIST: "shortlist",
  HOLD_BACK: "hold_back",
  SEND_INVITES: "send_invites",
  FINAL_DECISION: "final_decision",
};
const ACTION_LABEL = {
  [ACTION.PUBLISH_POST]: "Publish job post",
  [ACTION.SHORTLIST]: "Shortlist",
  [ACTION.HOLD_BACK]: "Don't shortlist",
  [ACTION.SEND_INVITES]: "Interview invite",
  [ACTION.FINAL_DECISION]: "Final decision",
};
const SECTIONS = [
  { key: "posts", title: "Job posts to publish", icon: Megaphone, actions: [ACTION.PUBLISH_POST] },
  { key: "shortlist", title: "Shortlist", icon: UserCheck, actions: [ACTION.SHORTLIST, ACTION.HOLD_BACK], bulk: true },
  { key: "invites", title: "Interview invites", icon: Send, actions: [ACTION.SEND_INVITES], bulk: true },
  { key: "finals", title: "Final decisions", icon: Award, actions: [ACTION.FINAL_DECISION] },
];

function Chips({ items, tone }) {
  if (!items?.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((s) => <span key={s} className={`badge badge-sm ${tone}`}>{s}</span>)}
    </div>
  );
}

function Bullets({ title, items }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-base-content/50 mb-0.5">{title}</p>
      <ul className="list-disc list-inside text-sm text-base-content/80 space-y-0.5">
        {items.map((i) => <li key={i}>{i}</li>)}
      </ul>
    </div>
  );
}

// Evidence comes before the score, so the score doesn't anchor the decision
function Evidence({ item }) {
  const ev = item.evidence || {};
  if (item.action === ACTION.PUBLISH_POST) {
    return (
      <div className="space-y-2">
        <p className="text-sm whitespace-pre-wrap bg-base-200 rounded-lg p-3 max-h-56 overflow-auto">{ev.post || "No post text"}</p>
        {ev.applyUrl && <p className="text-xs text-base-content/60">Apply link: <span className="font-mono">{ev.applyUrl}</span></p>}
      </div>
    );
  }
  if (item.action === ACTION.FINAL_DECISION) {
    return (
      <div className="space-y-2">
        {ev.summary && <p className="text-sm text-base-content/80 leading-relaxed">{ev.summary}</p>}
        <div className="grid sm:grid-cols-2 gap-3">
          <Bullets title="Strengths" items={ev.strengths} />
          <Bullets title="Risks" items={ev.risks} />
        </div>
        <p className="text-xs text-base-content/60">
          {ev.answered != null && ev.totalQuestions ? `Answered ${ev.answered} of ${ev.totalQuestions} questions · ` : ""}
          Final score <span className="font-semibold">{ev.finalScore ?? "n/a"}</span> (threshold {ev.threshold})
          {ev.breakdown && ` · resume ${ev.breakdown.resume ?? "–"} · interview ${ev.breakdown.interview ?? "–"} · communication ${ev.breakdown.communication ?? "–"}`}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-base-content/50 mb-1">Matched skills</p>
          <Chips items={ev.matched} tone="badge-success badge-outline" />
          {!ev.matched?.length && <span className="text-xs text-base-content/40">None</span>}
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-base-content/50 mb-1">Missing skills</p>
          <Chips items={ev.missing} tone="badge-error badge-outline" />
          {!ev.missing?.length && <span className="text-xs text-base-content/40">None</span>}
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Bullets title="Strengths" items={ev.strengths} />
        <Bullets title="Concerns" items={ev.concerns} />
      </div>
      {ev.rationale && <p className="text-sm text-base-content/70">{ev.rationale}</p>}
      {ev.fitScore != null && (
        <p className="text-xs text-base-content/60">
          Fit score <span className="font-semibold">{ev.fitScore}</span> (threshold {ev.minFitScore}
          {ev.maxShortlist ? `, up to ${ev.maxShortlist} shortlisted` : ""})
        </p>
      )}
    </div>
  );
}

// The buttons each request offers. `choice` overrides the agent's proposal.
function choicesFor(item) {
  switch (item.action) {
    case ACTION.PUBLISH_POST:
      return [{ label: "Approve & publish", decision: "approve", primary: true }, { label: "Don't publish", decision: "reject" }];
    case ACTION.SHORTLIST:
      return [
        { label: "Shortlist", decision: "approve", primary: true },
        { label: "Don't shortlist", decision: "approve", choice: CANDIDATE_STATUS.NOT_SHORTLISTED },
        { label: "Dismiss", decision: "reject", ghost: true },
      ];
    case ACTION.HOLD_BACK:
      return [
        { label: "Confirm: don't shortlist", decision: "approve", primary: true },
        { label: "Shortlist instead", decision: "approve", choice: CANDIDATE_STATUS.SHORTLISTED },
        { label: "Dismiss", decision: "reject", ghost: true },
      ];
    case ACTION.SEND_INVITES:
      return [{ label: "Send invite", decision: "approve", primary: true }, { label: "Not now", decision: "reject", ghost: true }];
    case ACTION.FINAL_DECISION: {
      const suggestion = item.payload?.suggestion;
      const list = [];
      if (suggestion && suggestion !== NEEDS_REVIEW) {
        list.push({ label: `Accept: ${STATUS_META[suggestion]?.label || suggestion}`, decision: "approve", primary: true });
      }
      list.push(
        { label: STATUS_META[CANDIDATE_STATUS.FINAL_SHORTLISTED].label, decision: "approve", choice: CANDIDATE_STATUS.FINAL_SHORTLISTED },
        { label: "Not selected", decision: "approve", choice: CANDIDATE_STATUS.FINAL_REJECTED },
      );
      return list;
    }
    default:
      return [];
  }
}

function RequestCard({ item, labels, busy, onDecide }) {
  const [note, setNote] = useState("");
  const escalations = item.escalations || [];
  const subject = item.candidateName || item.jobTitle || "Job";
  return (
    <div className={`bg-base-100 border rounded-xl p-4 space-y-3 ${escalations.length ? "border-warning/60" : "border-base-300"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm text-base-content">{subject}</p>
          <p className="text-xs text-base-content/60">
            {item.jobTitle}{item.candidateEmail ? ` · ${item.candidateEmail}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="badge badge-sm badge-outline">{ACTION_LABEL[item.action] || item.action}</span>
          {item.action === ACTION.FINAL_DECISION && item.payload?.suggestion && (
            <span className="badge badge-sm badge-ghost">
              Suggested: {item.payload.suggestion === NEEDS_REVIEW ? "needs your review" : STATUS_META[item.payload.suggestion]?.label}
            </span>
          )}
          <span className="text-[11px] text-base-content/40">{new Date(item.createdAt).toLocaleString()}</span>
        </div>
      </div>

      {escalations.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {escalations.map((e) => (
            <span key={e} className="badge badge-sm badge-warning gap-1"><ShieldAlert size={11} />{labels[e] || e}</span>
          ))}
        </div>
      )}

      <p className="text-sm text-base-content/70">{item.summary}</p>
      <Evidence item={item} />

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {choicesFor(item).map((c) => (
          <button
            key={c.label}
            className={`btn btn-sm ${c.primary ? "btn-primary" : c.ghost ? "btn-ghost" : "btn-outline"}`}
            disabled={busy}
            onClick={() => onDecide(item, { decision: c.decision, choice: c.choice, note })}
          >
            {c.label}
          </button>
        ))}
        <input
          id={`note-${item.id}`}
          className="input input-bordered input-sm flex-1 min-w-[10rem]"
          placeholder="Note for the record (optional)"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
        />
        {item.jobId && (
          <Link href={`/dashboard/recruiter/jobs/${item.jobId}/candidates`} className="btn btn-ghost btn-sm gap-1">
            <ExternalLink size={13} /> Open
          </Link>
        )}
      </div>
    </div>
  );
}

// Final decisions for jobs no agent manages (the Phase 7 queue)
function DecisionCard({ row, busy, onDecide }) {
  const fa = row.finalAnalysis || {};
  const suggestion = fa.suggestedDecision;
  return (
    <div className="bg-base-100 border border-base-300 rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-sm">{row.name}</p>
          <p className="text-xs text-base-content/60">{row.jobTitle} · {row.email}</p>
        </div>
        <span className="badge badge-sm badge-ghost">
          Suggested: {suggestion === NEEDS_REVIEW ? "needs your review" : STATUS_META[suggestion]?.label || "–"}
        </span>
      </div>
      {fa.summary && <p className="text-sm text-base-content/80">{fa.summary}</p>}
      <div className="grid sm:grid-cols-2 gap-3">
        <Bullets title="Strengths" items={(fa.strengths || []).slice(0, 4)} />
        <Bullets title="Risks" items={(fa.risks || []).slice(0, 4)} />
      </div>
      <p className="text-xs text-base-content/60">
        Final score <span className="font-semibold">{row.finalScore ?? "n/a"}</span> · fit {row.fitScore ?? "–"} · interview {row.interviewScore ?? "–"} · communication {row.communicationScore ?? "–"}
      </p>
      <div className="flex flex-wrap gap-2">
        {suggestion && suggestion !== NEEDS_REVIEW && (
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onDecide(row, suggestion)}>
            Accept: {STATUS_META[suggestion]?.label}
          </button>
        )}
        <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => onDecide(row, CANDIDATE_STATUS.FINAL_SHORTLISTED)}>
          {STATUS_META[CANDIDATE_STATUS.FINAL_SHORTLISTED].label}
        </button>
        <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => onDecide(row, CANDIDATE_STATUS.FINAL_REJECTED)}>
          Not selected
        </button>
      </div>
    </div>
  );
}

export default function DecisionsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { collapsed: sidebarCollapsed, setCollapsed: setSidebarCollapsed } = useSidebar();
  const [loading, setLoading] = useState(true);
  const [actions, setActions] = useState([]);
  const [labels, setLabels] = useState({});
  const [decisions, setDecisions] = useState([]);
  // Candidates whose request was approved but not carried out yet: never offered twice
  const [inProgress, setInProgress] = useState(new Set());
  const [jobFilter, setJobFilter] = useState("all");
  const [busyIds, setBusyIds] = useState(new Set());
  const [activeRuns, setActiveRuns] = useState([]); // hiring agents that are on it, with what each is doing

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/");
      return;
    }
    const modes = Array.isArray(session.user?.modes) ? session.user.modes : [];
    if (session.user?.role !== "admin" && !modes.includes("recruiter")) router.replace("/dashboard/home");
  }, [session, status, router]);

  const load = useCallback(async ({ quiet = false } = {}) => {
    try {
      if (!quiet) setLoading(true);
      const [aRes, dRes, rRes] = await Promise.all([fetch("/api/agents/actions"), fetch("/api/hiring/decisions"), fetch("/api/agents/runs?pipeline=recruiter")]);
      const [aData, dData, rData] = await Promise.all([aRes.json(), dRes.json(), rRes.json().catch(() => ({}))]);
      const live = ["queued", "running", "waiting", "paused_at_checkpoint", "paused"];
      setActiveRuns((rData.runs || []).filter((r) => live.includes(r.status)));
      if (!aRes.ok) throw new Error(aData.error || "Failed to load the agent's requests");
      if (!dRes.ok) throw new Error(dData.error || "Failed to load decisions");
      setActions(aData.actions || []);
      setInProgress(new Set(aData.inProgressCandidateIds || []));
      setLabels(aData.escalationLabels || {});
      setDecisions(dData.decisions || []);
    } catch (err) {
      if (!quiet) toast.error(err.message);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  // Look again quickly while an agent is starting or working, so a request shows up as soon as it exists
  const busyAgent = activeRuns.some((r) => r.status === "queued" || r.status === "running");
  useEffect(() => {
    if (!session) return undefined;
    load();
    const timer = setInterval(() => load({ quiet: true }), busyAgent ? 4000 : POLL_MS);
    return () => clearInterval(timer);
  }, [session, load, busyAgent]);

  const setBusy = (ids, on) => setBusyIds((prev) => {
    const next = new Set(prev);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    return next;
  });

  const decideAction = async (item, { decision, choice, note }) => {
    setBusy([item.id], true);
    try {
      const res = await fetch(`/api/agents/actions/${item.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, choice, note: note || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save your decision");
      setActions((prev) => prev.filter((a) => a.id !== item.id));
      if (decision === "approve" && item.candidateId) setInProgress((prev) => new Set(prev).add(item.candidateId));
      toast.success(decision === "approve" ? "Approved. The agent will carry it out in a moment." : "Dismissed");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy([item.id], false);
    }
  };

  const bulkApprove = async (items) => {
    const ids = items.map((i) => i.id);
    setBusy(ids, true);
    try {
      const res = await fetch("/api/agents/actions/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, decision: "approve" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bulk approval failed");
      toast.success(`Approved ${data.decided}${data.skipped ? `, ${data.skipped} left for you to review` : ""}`);
      await load({ quiet: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(ids, false);
    }
  };

  const decideLegacy = async (row, decision) => {
    setBusy([row.id], true);
    try {
      const res = await fetch(`/api/hiring/candidates/${row.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save the decision");
      setDecisions((prev) => prev.filter((d) => d.id !== row.id));
      toast.success(`Moved to ${STATUS_META[decision]?.label || decision}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy([row.id], false);
    }
  };

  const jobs = useMemo(() => {
    const map = new Map();
    actions.forEach((a) => a.jobId && map.set(a.jobId, a.jobTitle));
    decisions.forEach((d) => map.set(d.jobId, d.jobTitle));
    return [...map.entries()].map(([id, title]) => ({ id, title }));
  }, [actions, decisions]);

  const visible = actions.filter((a) => jobFilter === "all" || a.jobId === jobFilter);
  const attention = visible.filter((a) => (a.escalations || []).length > 0);
  const routine = visible.filter((a) => !(a.escalations || []).length);
  // Candidates the agent is already asking about are not shown twice
  const agentCandidates = new Set([...actions.map((a) => a.candidateId).filter(Boolean), ...inProgress]);
  const legacy = decisions.filter((d) => !agentCandidates.has(d.id) && (jobFilter === "all" || d.jobId === jobFilter));
  const total = visible.length + legacy.length;

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center">
        <div className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }
  if (!session) return null;

  return (
    <div className="min-h-screen bg-base-100 flex">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        activeSection="recruiter-decisions"
      />
      <div className={`flex-1 min-w-0 transition-all duration-300 ${sidebarCollapsed ? "ml-16" : "ml-16 md:ml-64"} flex flex-col`}>
        <TopBar title="Decisions" />
        <main className="flex-1 p-6 space-y-6 overflow-auto">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-base-content flex items-center gap-2"><Gavel size={22} /> Decisions</h1>
              <p className="text-sm text-base-content/70 mt-1">
                What your recruiter agent is asking you to approve, and evaluated candidates waiting for a final decision.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                id="decisions-job-filter"
                className="select select-bordered select-sm"
                value={jobFilter}
                onChange={(e) => setJobFilter(e.target.value)}
                aria-label="Filter by job"
              >
                <option value="all">All jobs</option>
                {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
              </select>
              <button className="btn btn-ghost btn-sm gap-1" onClick={() => load()}>
                <RefreshCw size={14} /> Refresh
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="animate-spin text-primary" size={24} /></div>
          ) : total === 0 ? (
            <div className="bg-base-200 border border-dashed border-base-300 rounded-xl p-10 text-center">
              <CheckCircle2 size={28} className="mx-auto text-success mb-2" />
              <p className="font-semibold">Nothing waiting for you</p>
              {activeRuns.length > 0 ? (
                <div className="mt-3 space-y-2 text-left max-w-xl mx-auto">
                  <p className="text-sm text-base-content/60 text-center">
                    Your hiring {activeRuns.length === 1 ? "agent is" : "agents are"} on it. It asks here when it needs you.
                  </p>
                  {activeRuns.map((run) => (
                    <Link key={run.id} href="/dashboard/recruiter/agent" className="block rounded-lg bg-base-100 border border-base-300 px-4 py-3 hover:border-primary/40">
                      <p className="text-sm font-medium">{run.activity?.jobTitle ? `${run.activity.jobTitle}: ` : ""}{run.activity?.headline || run.status}</p>
                      {run.activity?.detail && <p className="text-xs text-base-content/60 mt-0.5">{run.activity.detail}</p>}
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-base-content/60 mt-1">
                  When your hiring agent needs an approval, or a candidate finishes their interview, it will show up here.{" "}
                  <Link href="/dashboard/recruiter/agent" className="link link-primary">Set up a hiring agent</Link>
                </p>
              )}
            </div>
          ) : (
            <>
              {attention.length > 0 && (
                <section className="space-y-3">
                  <h2 className="font-semibold flex items-center gap-2 text-warning">
                    <ShieldAlert size={16} /> Needs your attention <span className="badge badge-warning badge-sm">{attention.length}</span>
                  </h2>
                  <p className="text-xs text-base-content/60">
                    The agent never decides these on its own: the score is close to the threshold, the resume couldn&apos;t be read,
                    the interview was incomplete, or there are integrity flags. Each needs its own decision.
                  </p>
                  {attention.map((item) => (
                    <RequestCard key={item.id} item={item} labels={labels} busy={busyIds.has(item.id)} onDecide={decideAction} />
                  ))}
                </section>
              )}

              {SECTIONS.map((section) => {
                const items = routine.filter((a) => section.actions.includes(a.action));
                const extra = section.key === "finals" ? legacy : [];
                if (!items.length && !extra.length) return null;
                const Icon = section.icon;
                return (
                  <section key={section.key} className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="font-semibold flex items-center gap-2">
                        <Icon size={16} className="text-base-content/60" /> {section.title}
                        <span className="badge badge-sm">{items.length + extra.length}</span>
                      </h2>
                      {section.bulk && items.length > 1 && (
                        <button
                          className="btn btn-outline btn-sm gap-1"
                          disabled={items.some((i) => busyIds.has(i.id))}
                          onClick={() => bulkApprove(items)}
                        >
                          <Bot size={14} /> Approve all {items.length} as proposed
                        </button>
                      )}
                    </div>
                    {items.map((item) => (
                      <RequestCard key={item.id} item={item} labels={labels} busy={busyIds.has(item.id)} onDecide={decideAction} />
                    ))}
                    {extra.map((row) => (
                      <DecisionCard key={row.id} row={row} busy={busyIds.has(row.id)} onDecide={decideLegacy} />
                    ))}
                  </section>
                );
              })}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
