"use client";

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { CalendarPlus, Loader2, Mail, MailWarning, RotateCcw, Send, Video, XCircle } from "lucide-react";
import { CANDIDATE_STATUS, INTERVIEW_STATUS, INTERVIEW_STATUS_META } from "@/libs/hiring/statuses";
import { formatAgo as ago, formatUntil as until } from "./format";

const SHOWN_FOR = [
  CANDIDATE_STATUS.SHORTLISTED,
  CANDIDATE_STATUS.INTERVIEW_INVITED,
  CANDIDATE_STATUS.INTERVIEW_EXPIRED,
  CANDIDATE_STATUS.INTERVIEW_IN_PROGRESS,
  CANDIDATE_STATUS.INTERVIEW_COMPLETED,
];


/**
 * Interview invite status and actions for one candidate (docs/ai-hiring/12-recruiter-ui.md §3):
 * shortlisted → Send invite; invited → status, Resend / Extend / Cancel; expired → Re-invite.
 */
export default function InterviewInviteSection({ candidate, onChanged }) {
  const [interview, setInterview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [extendHours, setExtendHours] = useState(48);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/hiring/candidates/${candidate.id}/interview`);
      const data = await res.json();
      if (res.ok) setInterview(data.interview);
    } finally {
      setLoading(false);
    }
  }, [candidate.id]);

  const shown = SHOWN_FOR.includes(candidate.status);
  useEffect(() => {
    if (shown) load();
  }, [load, shown, candidate.status]);

  if (!shown) return null;

  async function act(name, url, body, success) {
    setBusy(name);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Request failed");
      toast.success(data.skipped ? "An invite is already active" : success);
      await load();
      await onChanged?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  }

  const status = candidate.status;
  const active = interview && [INTERVIEW_STATUS.INVITED, INTERVIEW_STATUS.OPENED].includes(interview.status);
  const emailFailed = interview?.errorMessage?.startsWith("invite_email_failed");
  const button = (name, label, Icon, onClick, className = "btn-outline") => (
    <button type="button" className={`btn btn-xs gap-1 ${className}`} disabled={Boolean(busy)} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      {busy === name ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
      {label}
    </button>
  );

  return (
    <div className="p-4 space-y-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-base-content/60 uppercase tracking-wider">
        <Video className="h-3.5 w-3.5" /> AI Interview
        {interview && (
          <span className="badge badge-xs badge-outline normal-case tracking-normal ml-1">{INTERVIEW_STATUS_META[interview.status]?.label || interview.status}</span>
        )}
      </p>

      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-base-content/40" />
      ) : (
        <>
          {interview && (
            <div className="text-sm text-base-content/70 space-y-0.5">
              <p>
                Invited {ago(interview.invitedAt)}
                {active && <> · {until(interview.expiresAt)}</>}
                {interview.openedAt && <> · opened {ago(interview.openedAt)}</>}
                {interview.reminderSentAt && <> · reminder sent</>}
              </p>
              {interview.startedAt && (
                <p>
                  Started {ago(interview.startedAt)}
                  {interview.durationSec != null && <> · {Math.round(interview.durationSec / 60)} min</>}
                  {interview.totalAnswers != null && <> · {interview.totalAnswers}/{interview.totalQuestions} answered</>}
                </p>
              )}
              {emailFailed && (
                <p className="text-warning flex items-center gap-1"><MailWarning className="h-3.5 w-3.5" /> The invite email couldn&apos;t be sent; it will be retried.</p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {status === CANDIDATE_STATUS.SHORTLISTED && !active &&
              button("invite", "Send interview invite", Send, () => act("invite", `/api/hiring/candidates/${candidate.id}/invite`, {}, "Invite sent"), "btn-primary")}

            {status === CANDIDATE_STATUS.INTERVIEW_INVITED && active && (
              <>
                {button("resend", "Resend", Mail, () => act("resend", `/api/hiring/candidates/${candidate.id}/invite`, { resend: true }, "New invite sent; the old link no longer works"))}
                <div className="join">
                  <select
                    className="select select-bordered select-xs join-item"
                    value={extendHours}
                    onChange={(e) => setExtendHours(Number(e.target.value))}
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Extend by"
                  >
                    {[24, 48, 72, 168].map((h) => <option key={h} value={h}>+{h < 168 ? `${h}h` : "7d"}</option>)}
                  </select>
                  {button("extend", "Extend", CalendarPlus, () => act("extend", `/api/hiring/interviews/${interview.id}/extend`, { hours: extendHours }, "Invite extended"), "btn-outline join-item")}
                </div>
                {button("cancel", "Cancel invite", XCircle, () => act("cancel", `/api/hiring/interviews/${interview.id}/cancel`, {}, "Invite cancelled"), "btn-ghost text-error")}
              </>
            )}

            {(status === CANDIDATE_STATUS.INTERVIEW_EXPIRED || (status === CANDIDATE_STATUS.INTERVIEW_INVITED && !active)) &&
              button("reinvite", "Re-invite", RotateCcw, () => act("reinvite", `/api/hiring/candidates/${candidate.id}/invite`, { resend: true }, "New invite sent"), "btn-primary")}
          </div>
        </>
      )}
    </div>
  );
}
