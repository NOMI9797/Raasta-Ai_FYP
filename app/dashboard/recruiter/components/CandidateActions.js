"use client";

import { useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { Award, BadgeCheck, CheckCircle2, Eye, Loader2, Mail, Radio, Send, Star, XCircle } from "lucide-react";
import { CANDIDATE_STATUS, STATUS_META } from "@/libs/hiring/statuses";
import { useServiceGuard } from "@/components/system/useServiceGuard";
import { NEEDS_REVIEW } from "@/libs/hiring/final-evaluator"; // only imports statuses.js, so safe in the browser

const PRE_SHORTLIST = [CANDIDATE_STATUS.NEW, CANDIDATE_STATUS.SCREENED, CANDIDATE_STATUS.REVIEWED];
const FINAL_STATUSES = [CANDIDATE_STATUS.FINAL_SHORTLISTED, CANDIDATE_STATUS.FINAL_REJECTED, CANDIDATE_STATUS.HIRED];

/**
 * The next step for one candidate, by status (docs/ai-hiring/12-recruiter-ui.md §3):
 * applied → Shortlist / Reject · shortlisted → Invite · expired → Re-invite · interviewing → Watch live ·
 * interviewed → View results / Approve suggestion · final → View results / Mark hired.
 * Screening and the status menu stay on the row; resend, extend and cancel live in the expanded invite section.
 */
export default function CandidateActions({ candidate, onStatusChange, onChanged }) {
  const [busy, setBusy] = useState(null);
  const { ensure } = useServiceGuard();
  const status = candidate.status;
  const interviewId = candidate.latestInterview?.id;
  const suggestion = candidate.finalAnalysis?.suggestedDecision;

  const run = async (name, request, success) => {
    setBusy(name);
    try {
      const res = await request();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Request failed");
      toast.success(data.skipped ? "An invite is already active" : success);
      await onChanged?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const post = (url, body) => () => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  // The invite is queued for the hiring worker, and the candidate needs the engines when they open it:
  // offer to start what is off, but let the recruiter carry on without
  const invite = async (resend) => {
    if (!(await ensure("invites", { required: false }))) return;
    await run("invite", post(`/api/hiring/candidates/${candidate.id}/invite`, { resend }), resend ? "New invite sent; the old link no longer works" : "Invite sent");
  };
  const decide = (decision) => run(decision, post(`/api/hiring/candidates/${candidate.id}/decision`, { decision }), `Moved to ${STATUS_META[decision].label}`);

  const button = (name, label, Icon, onClick, className = "btn-outline") => (
    <button
      type="button"
      className={`btn btn-xs gap-1 ${className}`}
      disabled={Boolean(busy)}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      {busy === name ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
      <span className="hidden md:inline">{label}</span>
    </button>
  );

  const link = (href, label, Icon, className = "btn-ghost") => (
    <Link href={href} className={`btn btn-xs gap-1 ${className}`} onClick={(e) => e.stopPropagation()}>
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden md:inline">{label}</span>
    </Link>
  );

  if (PRE_SHORTLIST.includes(status)) {
    return (
      <>
        {button("shortlist", "Shortlist", Star, () => run("shortlist", () => fetch(`/api/hiring/candidates/${candidate.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: CANDIDATE_STATUS.SHORTLISTED }),
        }), "Shortlisted"), "btn-ghost text-success")}
        {button("reject", "Reject", XCircle, () => onStatusChange(candidate.id, CANDIDATE_STATUS.REJECTED), "btn-ghost text-error")}
      </>
    );
  }

  if (status === CANDIDATE_STATUS.SHORTLISTED) {
    return button("invite", "Invite", Send, () => invite(false), "btn-primary btn-outline");
  }

  if (status === CANDIDATE_STATUS.INTERVIEW_EXPIRED) {
    return button("invite", "Re-invite", Mail, () => invite(true), "btn-primary btn-outline");
  }

  if (status === CANDIDATE_STATUS.INTERVIEW_IN_PROGRESS && interviewId) {
    return link(`/dashboard/recruiter/interviews/${interviewId}`, "Watch live", Radio, "btn-accent");
  }

  if (status === CANDIDATE_STATUS.INTERVIEW_COMPLETED) {
    const canApprove = suggestion && suggestion !== NEEDS_REVIEW && [CANDIDATE_STATUS.FINAL_SHORTLISTED, CANDIDATE_STATUS.FINAL_REJECTED].includes(suggestion);
    return (
      <>
        {interviewId && link(`/dashboard/recruiter/interviews/${interviewId}`, "View results", Eye)}
        {canApprove && button(suggestion, `Approve: ${STATUS_META[suggestion].label}`, CheckCircle2, () => decide(suggestion), "btn-primary btn-outline")}
      </>
    );
  }

  if (FINAL_STATUSES.includes(status)) {
    return (
      <>
        {interviewId && link(`/dashboard/recruiter/interviews/${interviewId}`, "View results", Eye)}
        {status === CANDIDATE_STATUS.FINAL_SHORTLISTED && button(CANDIDATE_STATUS.HIRED, "Mark hired", Award, () => decide(CANDIDATE_STATUS.HIRED), "btn-success btn-outline")}
        {status === CANDIDATE_STATUS.HIRED && <span className="badge badge-xs badge-success gap-1"><BadgeCheck className="h-3 w-3" /> Hired</span>}
      </>
    );
  }

  return null;
}
