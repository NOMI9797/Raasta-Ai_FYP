"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { Video, Loader2, Radio, Eye, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";
import GuidanceStrip from "@/components/system/GuidanceStrip";
import { INTERVIEW_STATUS, INTERVIEW_STATUS_META, STATUS_META } from "@/libs/hiring/statuses";
import ScoreBadge from "../components/ScoreBadge";
import { formatDateTime, formatMinutes } from "../components/format";

const POLL_MS = 15000;
const PAGE_SIZE = 25;

function ScoreCell({ value }) {
  return <span className="tabular-nums">{value ?? "–"}</span>;
}

export default function InterviewsPage() {
  const [rows, setRows] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [jobId, setJobId] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(async ({ quiet = false } = {}) => {
    try {
      if (!quiet) setLoading(true);
      const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (jobId) qs.set("jobId", jobId);
      if (status) qs.set("status", status);
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const res = await fetch(`/api/hiring/interviews?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load interviews");
      setRows(data.interviews || []);
      setTotal(data.total || 0);
      setJobs(data.jobs || []);
    } catch (err) {
      if (!quiet) toast.error(err.message);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [page, jobId, status, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  // Keep the list fresh while someone is in an interview
  const anyLive = rows.some((r) => r.status === INTERVIEW_STATUS.IN_PROGRESS);
  useEffect(() => {
    if (!anyLive) return undefined;
    const timer = setInterval(() => load({ quiet: true }), POLL_MS);
    return () => clearInterval(timer);
  }, [anyLive, load]);

  const changeFilter = (setter) => (e) => {
    setter(e.target.value);
    setPage(1);
  };
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(jobId || status || from || to);

  return (
    <DashboardShell title="Interviews" activeSection="recruiter-interviews">
      <div className="p-6 space-y-5">
        <GuidanceStrip feature="interviews" />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Video size={22} /> Interviews</h1>
            <p className="text-sm text-base-content/70 mt-1">
              AI interviews for your jobs. Open one to see answers, the recording and communication analysis.
            </p>
          </div>
          <button className="btn btn-ghost btn-sm gap-1" onClick={() => load()}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="form-control">
            <label htmlFor="iv-job" className="label py-1"><span className="label-text text-xs">Job</span></label>
            <select id="iv-job" className="select select-bordered select-sm" value={jobId} onChange={changeFilter(setJobId)}>
              <option value="">All jobs</option>
              {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
            </select>
          </div>
          <div className="form-control">
            <label htmlFor="iv-status" className="label py-1"><span className="label-text text-xs">Status</span></label>
            <select id="iv-status" className="select select-bordered select-sm" value={status} onChange={changeFilter(setStatus)}>
              <option value="">All statuses</option>
              {Object.entries(INTERVIEW_STATUS_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
            </select>
          </div>
          <div className="form-control">
            <label htmlFor="iv-from" className="label py-1"><span className="label-text text-xs">Invited from</span></label>
            <input id="iv-from" type="date" className="input input-bordered input-sm" value={from} max={to || undefined} onChange={changeFilter(setFrom)} />
          </div>
          <div className="form-control">
            <label htmlFor="iv-to" className="label py-1"><span className="label-text text-xs">Invited to</span></label>
            <input id="iv-to" type="date" className="input input-bordered input-sm" value={to} min={from || undefined} onChange={changeFilter(setTo)} />
          </div>
          {filtered && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setJobId(""); setStatus(""); setFrom(""); setTo(""); setPage(1); }}>
              Clear filters
            </button>
          )}
          {anyLive && (
            <span className="ml-auto flex items-center gap-1.5 text-xs text-accent">
              <Radio size={14} className="animate-pulse" /> Live interviews refresh every 15 s
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin text-primary" size={24} /></div>
        ) : rows.length === 0 ? (
          <div className="bg-base-200 border border-dashed border-base-300 rounded-xl p-10 text-center">
            <Video size={28} className="mx-auto text-base-content/20 mb-2" />
            <p className="font-semibold">{filtered ? "No interviews match these filters" : "No interviews yet"}</p>
            <p className="text-sm text-base-content/60 mt-1">
              {filtered ? "Try clearing a filter." : "Interviews appear here once shortlisted candidates are invited."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto border border-base-300 rounded-xl">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Job</th>
                  <th>Status</th>
                  <th>Invited</th>
                  <th>Started</th>
                  <th>Duration</th>
                  <th className="text-right">Interview</th>
                  <th className="text-right">Communication</th>
                  <th className="text-right">Final</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const meta = INTERVIEW_STATUS_META[r.status] || { label: r.status, badge: "badge-ghost" };
                  const live = r.status === INTERVIEW_STATUS.IN_PROGRESS;
                  return (
                    <tr key={r.id} className="hover">
                      <td>
                        <p className="font-medium">{r.candidateName}</p>
                        <p className="text-xs text-base-content/60">{STATUS_META[r.candidateStatus]?.label || r.candidateStatus}</p>
                      </td>
                      <td className="max-w-[14rem] truncate">{r.jobTitle}</td>
                      <td>
                        <span className={`badge badge-sm ${meta.badge} gap-1`}>
                          {live && <Radio size={11} className="animate-pulse" />}{meta.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap">{formatDateTime(r.invitedAt)}</td>
                      <td className="whitespace-nowrap">{formatDateTime(r.startedAt)}</td>
                      <td className="whitespace-nowrap">{r.endedAt ? formatMinutes(r.durationSec) : live ? "running" : "–"}</td>
                      <td className="text-right"><ScoreCell value={r.interviewScore} /></td>
                      <td className="text-right"><ScoreCell value={r.communicationScore} /></td>
                      <td className="text-right">
                        {r.finalScore != null ? <ScoreBadge label="" score={r.finalScore} size="badge-sm" title="Final score (0–100)" /> : "–"}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        <Link href={`/dashboard/recruiter/interviews/${r.id}`} className={`btn btn-xs gap-1 ${live ? "btn-accent" : "btn-ghost"}`}>
                          {live ? <><Radio size={12} /> Watch live</> : <><Eye size={12} /> View</>}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && total > PAGE_SIZE && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-base-content/60">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
            </span>
            <div className="join">
              <button className="btn btn-sm join-item" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                <ChevronLeft size={14} />
              </button>
              <span className="btn btn-sm join-item pointer-events-none">Page {page} of {pages}</span>
              <button className="btn btn-sm join-item" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
