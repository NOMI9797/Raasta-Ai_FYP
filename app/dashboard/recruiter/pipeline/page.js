"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Loader2, LayoutGrid, Video } from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";
import { KANBAN_STAGES, MANUAL_TRANSITIONS, STATUS_META, allowedMovesToStage } from "@/libs/hiring/statuses";
import ScoreBadge from "../components/ScoreBadge";

// Column accents, one per stage in KANBAN_STAGES
const STAGE_ACCENT = {
  applied: "border-info",
  shortlisted: "border-primary",
  interview: "border-secondary",
  evaluation: "border-accent",
  decision: "border-success",
  closed: "border-base-300",
};

// What to say when a card can't be dropped into a column
const NO_MOVE_HINT = {
  interview: "Interview invites are sent from the candidate: use “Send interview invite” on the job's candidates page.",
  evaluation: "Candidates move here by themselves when their interview ends.",
};

const stageOf = (status) => STATUS_META[status]?.stage || "applied";

// The score that says the most about a candidate right now: final, then interview, then resume fit
function bestScore(c) {
  if (c.finalScore != null) return { label: "Final", score: c.finalScore };
  if (c.latestInterview?.interviewScore != null) return { label: "Interview", score: c.latestInterview.interviewScore };
  if (c.fitScore != null) return { label: "Fit", score: c.fitScore };
  return null;
}

export default function PipelinePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [rows, setRows] = useState([]);
  const [jobsMap, setJobsMap] = useState({});
  const [jobFilter, setJobFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [draggedId, setDraggedId] = useState(null);
  const [overStage, setOverStage] = useState(null);
  const [menu, setMenu] = useState(null); // { candidateId, options, x, y }

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/");
      return;
    }
    const modes = Array.isArray(session.user?.modes) ? session.user.modes : [];
    if (session.user?.role !== "admin" && !modes.includes("recruiter")) router.replace("/dashboard/home");
  }, [session, status, router]);

  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/hiring/candidates");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setRows(data.candidates || []);
        setJobsMap(Object.fromEntries((data.jobs || []).map((j) => [j.id, j])));
      } catch (err) {
        toast.error(err.message || "Failed to load pipeline");
      } finally {
        setLoading(false);
      }
    })();
  }, [session]);

  const filtered = useMemo(
    () => (jobFilter === "all" ? rows : rows.filter((c) => c.jobId === jobFilter)),
    [rows, jobFilter]
  );

  const byStage = useMemo(() => {
    const grouped = Object.fromEntries(KANBAN_STAGES.map((s) => [s.value, []]));
    for (const c of filtered) (grouped[stageOf(c.status)] || grouped.applied).push(c);
    return grouped;
  }, [filtered]);

  const moveCandidate = async (candidateId, newStatus) => {
    const prev = rows.find((r) => r.id === candidateId);
    if (!prev || prev.status === newStatus) return;
    setRows((rs) => rs.map((r) => (r.id === candidateId ? { ...r, status: newStatus } : r)));
    try {
      const res = await fetch(`/api/hiring/candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
      toast.success(`Moved to ${STATUS_META[newStatus].label}`);
    } catch (err) {
      toast.error(err.message || "Failed to move candidate");
      setRows((rs) => rs.map((r) => (r.id === candidateId ? { ...r, status: prev.status } : r)));
    }
  };

  // Dropping a card on a column: apply the only allowed status, ask when there are several, refuse when none
  const handleDrop = (event, stage) => {
    event.preventDefault();
    setOverStage(null);
    const candidate = rows.find((r) => r.id === draggedId);
    setDraggedId(null);
    if (!candidate || stageOf(candidate.status) === stage) return;
    const options = allowedMovesToStage(candidate.status, stage);
    const stageLabel = KANBAN_STAGES.find((s) => s.value === stage)?.label || stage;
    if (options.length === 0) {
      toast.error(NO_MOVE_HINT[stage] || `A candidate who is “${STATUS_META[candidate.status].label}” can't be moved to ${stageLabel}.`);
    } else if (options.length === 1) {
      moveCandidate(candidate.id, options[0]);
    } else {
      setMenu({ candidateId: candidate.id, options, x: event.clientX, y: event.clientY });
    }
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center">
        <div className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }
  if (!session) return null;

  return (
    <DashboardShell title="Pipeline" activeSection="recruiter-pipeline">
      <div className="h-full p-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <LayoutGrid className="h-6 w-6" /> Hiring Pipeline
            </h1>
            <p className="text-sm text-base-content/70 mt-1">
              Drag a candidate to another stage, or use the Move menu on a card. Only moves the hiring flow allows are accepted.
            </p>
          </div>
          <select
            id="pipeline-job"
            className="select select-bordered select-sm"
            aria-label="Filter by job"
            value={jobFilter}
            onChange={(e) => setJobFilter(e.target.value)}
          >
            <option value="all">All jobs</option>
            {Object.values(jobsMap).map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex gap-3 overflow-x-auto pb-2">
            {KANBAN_STAGES.map((stage) => (
              <div
                key={stage.value}
                onDragOver={(e) => { e.preventDefault(); if (overStage !== stage.value) setOverStage(stage.value); }}
                onDragLeave={() => setOverStage((s) => (s === stage.value ? null : s))}
                onDrop={(e) => handleDrop(e, stage.value)}
                className={`card bg-base-200 border-t-4 ${STAGE_ACCENT[stage.value]} flex flex-col min-h-0 w-64 shrink-0 flex-1 transition-shadow ${
                  overStage === stage.value && draggedId ? "ring-2 ring-primary" : ""
                }`}
              >
                <div className="p-3 border-b border-base-300 flex items-center justify-between">
                  <h2 className="font-semibold text-sm">{stage.label}</h2>
                  <span className="badge badge-ghost badge-sm">{byStage[stage.value].length}</span>
                </div>
                <div className="p-2 space-y-2 flex-1 overflow-y-auto">
                  {byStage[stage.value].length === 0 ? (
                    <p className="text-xs text-base-content/40 text-center py-4">No candidates here</p>
                  ) : (
                    byStage[stage.value].map((c) => {
                      const job = jobsMap[c.jobId];
                      const best = bestScore(c);
                      const moves = MANUAL_TRANSITIONS[c.status] || [];
                      const meta = STATUS_META[c.status];
                      return (
                        <div
                          key={c.id}
                          draggable
                          onDragStart={() => setDraggedId(c.id)}
                          onDragEnd={() => { setDraggedId(null); setOverStage(null); }}
                          className={`bg-base-100 rounded-lg border border-base-300 p-3 cursor-grab hover:border-primary transition-colors space-y-1.5 ${draggedId === c.id ? "opacity-50" : ""}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-medium text-sm truncate">{c.name}</p>
                            {best && <ScoreBadge label={best.label} score={best.score} />}
                          </div>
                          <p className="text-xs text-base-content/60 truncate">{job?.title || "Job"}</p>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className={`badge badge-xs ${meta?.badge || "badge-ghost"}`}>{meta?.label || c.status}</span>
                            {c.latestInterview && (
                              <Link
                                href={`/dashboard/recruiter/interviews/${c.latestInterview.id}`}
                                className="badge badge-xs badge-outline gap-0.5 hover:badge-primary"
                                draggable={false}
                                title="Open the interview"
                              >
                                <Video size={10} /> Interview
                              </Link>
                            )}
                          </div>
                          {moves.length > 0 && (
                            <select
                              className="select select-bordered select-xs w-full"
                              aria-label={`Move ${c.name}`}
                              value=""
                              onChange={(e) => e.target.value && moveCandidate(c.id, e.target.value)}
                            >
                              <option value="">Move to…</option>
                              {moves.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
                            </select>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {menu && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" aria-label="Close menu" onClick={() => setMenu(null)} />
          <ul
            className="menu bg-base-100 rounded-box shadow-xl border border-base-300 fixed z-50 w-52 p-2"
            style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 160) }}
            role="menu"
          >
            <li className="menu-title text-xs">Move to</li>
            {menu.options.map((s) => (
              <li key={s} role="none">
                <button
                  role="menuitem"
                  onClick={() => { moveCandidate(menu.candidateId, s); setMenu(null); }}
                >
                  {STATUS_META[s].label}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </DashboardShell>
  );
}
