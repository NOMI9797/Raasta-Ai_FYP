"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { AlertCircle, ArrowLeft, CalendarPlus, Loader2, Mail, Radio, RefreshCw } from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";
import { useServiceGuard } from "@/components/system/useServiceGuard";
import { CANDIDATE_STATUS, INTERVIEW_STATUS, INTERVIEW_STATUS_META, STATUS_META } from "@/libs/hiring/statuses";
import ScoreBadge from "../../components/ScoreBadge";
import { formatDateTime, formatMinutes } from "../../components/format";
import LiveTab from "./components/LiveTab";
import SummaryTab from "./components/SummaryTab";
import QATab from "./components/QATab";
import TranscriptTab from "./components/TranscriptTab";
import RecordingTab from "./components/RecordingTab";
import CommunicationTab from "./components/CommunicationTab";
import BehaviorTab from "./components/BehaviorTab";
import IntegrityTab from "./components/IntegrityTab";

const POLL_MS = 10000;
const LINKS_FRESH_MS = 10 * 60 * 1000; // recording links last 15 minutes
const EXTEND_OPTIONS = [24, 48, 72, 168];
const REINVITE_FROM = [INTERVIEW_STATUS.ABANDONED, INTERVIEW_STATUS.EXPIRED, INTERVIEW_STATUS.CANCELLED];
const REINVITE_CANDIDATE = [CANDIDATE_STATUS.SHORTLISTED, CANDIDATE_STATUS.INTERVIEW_INVITED, CANDIDATE_STATUS.INTERVIEW_EXPIRED];
const EXTEND_FROM = [INTERVIEW_STATUS.INVITED, INTERVIEW_STATUS.OPENED, INTERVIEW_STATUS.EXPIRED];

// A refresh signs new recording links, which would restart a video someone is watching.
// Keep the links we already have until they are about to expire.
function keepRecordingLinks(previous, next) {
  const recording = { ...next.recording, linksAt: Date.now() };
  const prev = previous?.recording;
  if (prev && !next.recording.deleted && prev.linksAt && Date.now() - prev.linksAt < LINKS_FRESH_MS) {
    if (prev.audioUrl && recording.audioUrl) recording.audioUrl = prev.audioUrl;
    if (prev.videoUrl && recording.videoUrl) recording.videoUrl = prev.videoUrl;
    recording.linksAt = prev.linksAt;
  }
  return { ...next, recording };
}

export default function InterviewDetailPage({ params }) {
  const { interviewId } = params;
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(null);
  const [seek, setSeek] = useState(null);
  const [busy, setBusy] = useState(null);
  const [extendHours, setExtendHours] = useState(48);
  const { ensure } = useServiceGuard();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/hiring/interviews/${interviewId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load the interview");
      setDetail((prev) => keepRecordingLinks(prev, data));
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [interviewId]);

  useEffect(() => {
    load();
  }, [load]);

  const status = detail?.interview.status;
  const analysisPending = status === INTERVIEW_STATUS.COMPLETED && ["pending", "processing"].includes(detail?.interview.analysisStatus);
  const polling = status === INTERVIEW_STATUS.IN_PROGRESS || analysisPending;
  useEffect(() => {
    if (!polling) return undefined;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [polling, load]);

  const act = async (name, url, method, body, success) => {
    setBusy(name);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Request failed");
      toast.success(success);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <DashboardShell title="Interview" activeSection="recruiter-interviews">
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-primary" size={28} /></div>
      </DashboardShell>
    );
  }

  if (!detail) {
    return (
      <DashboardShell title="Interview" activeSection="recruiter-interviews">
        <div className="p-6 max-w-md mx-auto text-center space-y-3 py-20">
          <AlertCircle className="mx-auto text-error" size={40} />
          <h1 className="text-xl font-semibold">Couldn&apos;t open this interview</h1>
          <p className="text-base-content/60">{error || "It may have been removed."}</p>
          <Link href="/dashboard/recruiter/interviews" className="btn btn-primary btn-sm">Back to interviews</Link>
        </div>
      </DashboardShell>
    );
  }

  const { interview, candidate, job, recording } = detail;
  const meta = INTERVIEW_STATUS_META[interview.status] || { label: interview.status, badge: "badge-ghost" };
  const live = interview.status === INTERVIEW_STATUS.IN_PROGRESS;
  const tabs = [
    live && ["live", "Live"],
    ["summary", "Summary"],
    ["qa", "Q&A"],
    ["transcript", "Transcript"],
    ["recording", "Recording"],
    ["communication", "Communication"],
    ["behavior", "Behaviour"],
    ["integrity", "Integrity"],
  ].filter(Boolean);
  const activeTab = tabs.some(([key]) => key === tab) ? tab : tabs[0][0];

  const canReanalyse = interview.status === INTERVIEW_STATUS.COMPLETED && !recording.deleted;
  const canExtend = EXTEND_FROM.includes(interview.status);
  const canReinvite = REINVITE_FROM.includes(interview.status) && candidate && REINVITE_CANDIDATE.includes(candidate.status);

  const handleSeek = (ms) => {
    setSeek({ ms, nonce: Date.now() });
    setTab("recording");
  };
  // Camera-track times start when the camera tracking started, a moment after the recording did


  return (
    <DashboardShell title="Interview" activeSection="recruiter-interviews">
      <div className="p-6 space-y-5 max-w-5xl">
        <Link href="/dashboard/recruiter/interviews" className="btn btn-ghost btn-sm gap-1 -ml-2">
          <ArrowLeft size={14} /> All interviews
        </Link>

        <header className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold truncate">{candidate?.name || "Candidate"}</h1>
              <p className="text-sm text-base-content/60">
                {candidate?.email} · applying for{" "}
                <Link href={`/dashboard/recruiter/jobs/${job.id}/candidates`} className="link link-hover">{job.title}</Link>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`badge ${meta.badge} gap-1`}>{live && <Radio size={12} className="animate-pulse" />}{meta.label}</span>
              {candidate && <span className={`badge ${STATUS_META[candidate.status]?.badge || "badge-ghost"}`}>{STATUS_META[candidate.status]?.label || candidate.status}</span>}
              <ScoreBadge label="Interview" score={interview.interviewScore} size="badge-md" />
              <ScoreBadge label="Communication" score={interview.communicationScore} size="badge-md" />
              <ScoreBadge label="Final" score={candidate?.finalScore} size="badge-md" />
            </div>
          </div>

          <p className="text-sm text-base-content/60">
            Invited {formatDateTime(interview.invitedAt)}
            {interview.startedAt && <> · started {formatDateTime(interview.startedAt)}</>}
            {interview.endedAt && <> · {formatMinutes(interview.durationSec)}</>}
            {interview.totalQuestions != null && interview.totalAnswers != null && <> · {interview.totalAnswers} of {interview.totalQuestions} questions answered</>}
            {[INTERVIEW_STATUS.INVITED, INTERVIEW_STATUS.OPENED].includes(interview.status) && <> · link expires {formatDateTime(interview.expiresAt)}</>}
          </p>

          {(canReanalyse || canExtend || canReinvite) && (
            <div className="flex flex-wrap items-center gap-2">
              {canReanalyse && (
                <button
                  className="btn btn-outline btn-sm gap-1"
                  disabled={Boolean(busy) || analysisPending}
                  onClick={() => act("reanalyse", `/api/hiring/interviews/${interview.id}/reanalyse`, "POST", {}, "Analysis queued. Scores update when it finishes.")}
                  title="Run the recording analysis and the final evaluation again. A decision you already made is kept."
                >
                  {busy === "reanalyse" || analysisPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Re-analyse
                </button>
              )}
              {canExtend && (
                <div className="join">
                  <select
                    id="extend-hours"
                    className="select select-bordered select-sm join-item"
                    value={extendHours}
                    onChange={(e) => setExtendHours(Number(e.target.value))}
                    aria-label="Extend the link by"
                  >
                    {EXTEND_OPTIONS.map((h) => <option key={h} value={h}>+{h < 168 ? `${h}h` : "7d"}</option>)}
                  </select>
                  <button
                    className="btn btn-outline btn-sm join-item gap-1"
                    disabled={Boolean(busy)}
                    onClick={() => act("extend", `/api/hiring/interviews/${interview.id}/extend`, "POST", { hours: extendHours }, "The link was extended")}
                  >
                    {busy === "extend" ? <Loader2 size={14} className="animate-spin" /> : <CalendarPlus size={14} />} Extend link
                  </button>
                </div>
              )}
              {canReinvite && (
                <button
                  className="btn btn-primary btn-sm gap-1"
                  disabled={Boolean(busy)}
                  onClick={async () => {
                    if (await ensure("invites", { required: false })) act("reinvite", `/api/hiring/candidates/${candidate.id}/invite`, "POST", { resend: true }, "A new invite was sent. The old link no longer works.");
                  }}
                >
                  {busy === "reinvite" ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Re-invite
                </button>
              )}
            </div>
          )}
          {interview.errorMessage && !interview.errorMessage.startsWith("invite_email_failed") && (
            <p className="text-xs text-error">Problem recorded: {interview.errorMessage}</p>
          )}
        </header>

        <div className="tabs tabs-boxed w-fit max-w-full overflow-x-auto flex-nowrap" role="tablist">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={activeTab === key}
              className={`tab tab-sm whitespace-nowrap ${activeTab === key ? "tab-active" : ""}`}
              onClick={() => setTab(key)}
            >
              {key === "live" && <Radio size={12} className="mr-1 animate-pulse" />}{label}
            </button>
          ))}
        </div>

        <section aria-label={tabs.find(([key]) => key === activeTab)?.[1]}>
          {activeTab === "live" && <LiveTab detail={detail} onFinished={load} />}
          {activeTab === "summary" && <SummaryTab detail={detail} onChanged={load} />}
          {activeTab === "qa" && <QATab detail={detail} />}
          {activeTab === "transcript" && <TranscriptTab detail={detail} onSeek={handleSeek} />}
          {activeTab === "recording" && <RecordingTab detail={detail} seek={seek} onChanged={load} />}
          {activeTab === "communication" && <CommunicationTab detail={detail} />}
          {activeTab === "behavior" && <BehaviorTab detail={detail} onSeek={handleSeek} />}
          {activeTab === "integrity" && <IntegrityTab detail={detail} />}
        </section>
      </div>
    </DashboardShell>
  );
}
