"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { CANDIDATE_STATUS, STATUS_META, canTransition } from "@/libs/hiring/statuses";
import { NEEDS_REVIEW } from "@/libs/hiring/final-evaluator"; // only imports statuses.js, so safe in the browser

const RECOMMENDATION = {
  strong_yes: { label: "Strong yes", badge: "badge-success" },
  yes: { label: "Yes", badge: "badge-success badge-outline" },
  maybe: { label: "Maybe", badge: "badge-warning" },
  no: { label: "No", badge: "badge-error" },
};
const DECISION_TARGETS = [CANDIDATE_STATUS.FINAL_SHORTLISTED, CANDIDATE_STATUS.FINAL_REJECTED, CANDIDATE_STATUS.HIRED];
const PART_LABELS = { resume: "Resume fit", interview: "Interview answers", communication: "Communication" };

function ringColor(score) {
  if (score >= 75) return "text-success";
  if (score >= 50) return "text-warning";
  return "text-error";
}

function List({ title, items }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-base-content/50 mb-1">{title}</p>
      <ul className="list-disc list-inside text-sm text-base-content/80 space-y-0.5">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

export default function SummaryTab({ detail, onChanged }) {
  const { candidate, interview } = detail;
  const analysis = candidate?.finalAnalysis;
  const [busy, setBusy] = useState(null);

  if (!analysis) {
    const pending = ["pending", "processing"].includes(interview.analysisStatus);
    return (
      <div className="bg-base-200 border border-dashed border-base-300 rounded-xl p-8 text-center">
        {pending ? <Loader2 className="mx-auto mb-2 animate-spin text-primary" size={22} /> : <AlertTriangle className="mx-auto mb-2 text-warning" size={22} />}
        <p className="font-semibold">
          {interview.status !== "completed"
            ? "The evaluation appears after the interview is completed"
            : pending
              ? "The recording is being analysed"
              : "No evaluation yet"}
        </p>
        <p className="text-sm text-base-content/60 mt-1">
          {interview.analysisStatus === "failed"
            ? "The analysis failed. Use Re-analyse at the top to try again."
            : "This page updates by itself when the scores are ready."}
        </p>
      </div>
    );
  }

  const breakdown = analysis.breakdown || {};
  const weights = breakdown.weights || {};
  const suggestion = analysis.suggestedDecision;
  const recommendation = RECOMMENDATION[analysis.recommendation];
  const decided = analysis.decision;
  const finalScore = candidate.finalScore;

  const decide = async (decision) => {
    setBusy(decision);
    try {
      const res = await fetch(`/api/hiring/candidates/${candidate.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save the decision");
      toast.success(`Moved to ${STATUS_META[decision]?.label || decision}`);
      await onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const targets = DECISION_TARGETS.filter((t) => canTransition(candidate.status, t));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-6">
        <div
          className={`radial-progress ${finalScore != null ? ringColor(finalScore) : "text-base-content/30"} font-bold`}
          style={{ "--value": finalScore ?? 0, "--size": "7rem", "--thickness": "0.6rem" }}
          role="progressbar"
          aria-valuenow={finalScore ?? 0}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Final score"
        >
          <span className="text-2xl text-base-content">{finalScore ?? "n/a"}</span>
        </div>
        <div className="space-y-2">
          <p className="text-sm text-base-content/60">
            Final score · cut-off {breakdown.threshold ?? "–"}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {recommendation && <span className={`badge ${recommendation.badge}`}>Recommendation: {recommendation.label}</span>}
            <span className={`badge ${STATUS_META[candidate.status]?.badge || "badge-ghost"}`}>{STATUS_META[candidate.status]?.label || candidate.status}</span>
          </div>
          {analysis.answered != null && analysis.totalQuestions ? (
            <p className="text-xs text-base-content/60">Answered {analysis.answered} of {analysis.totalQuestions} questions</p>
          ) : null}
        </div>
      </div>

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-base-content/50 mb-2">How the final score is made</p>
        <div className="grid sm:grid-cols-3 gap-3">
          {Object.entries(PART_LABELS).map(([key, label]) => (
            <div key={key} className="bg-base-200 rounded-lg border border-base-300 p-3">
              <p className="text-xs text-base-content/60">{label}</p>
              <p className="text-xl font-bold tabular-nums">{breakdown[key] ?? "–"}</p>
              <progress className="progress progress-primary w-full mt-1" value={breakdown[key] ?? 0} max="100" aria-label={`${label} score`} />
              <p className="text-[11px] text-base-content/50 mt-1">
                {weights[key] != null ? `${Math.round(weights[key] * 100)}% of the final score` : "Not available, so not counted"}
              </p>
            </div>
          ))}
        </div>
      </div>

      {analysis.summary && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-base-content/50 mb-1">AI summary</p>
          <p className="text-sm leading-relaxed text-base-content/90">{analysis.summary}</p>
        </div>
      )}
      <div className="grid sm:grid-cols-3 gap-4">
        <List title="Strengths" items={analysis.strengths} />
        <List title="Risks" items={analysis.risks} />
        <List title="Suggested next steps" items={analysis.suggestedNextSteps} />
      </div>

      <div className="border-t border-base-300 pt-4 space-y-3">
        {suggestion === NEEDS_REVIEW && (
          <div className="alert alert-warning py-2 text-sm">
            <AlertTriangle size={16} />
            <span>The AI can&apos;t suggest a decision: fewer than half of the questions were answered, or there is no score. Please decide yourself.</span>
          </div>
        )}
        {decided && (
          <p className="text-sm text-base-content/70 flex items-center gap-1.5">
            <CheckCircle2 size={15} className="text-success" />
            {decided.by === "system" ? "Applied automatically (auto-finalize)" : "Decided by a recruiter"} on {new Date(decided.at).toLocaleDateString()}
            {decided.note ? ` · “${decided.note}”` : ""}
          </p>
        )}
        {targets.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {targets.map((target) => {
              const isSuggestion = target === suggestion;
              return (
                <button
                  key={target}
                  className={`btn btn-sm ${isSuggestion ? "btn-primary" : "btn-outline"}`}
                  disabled={Boolean(busy)}
                  onClick={() => decide(target)}
                >
                  {busy === target && <Loader2 size={14} className="animate-spin" />}
                  {isSuggestion ? `Approve: ${STATUS_META[target].label}` : target === CANDIDATE_STATUS.HIRED ? "Mark as hired" : `Override: ${STATUS_META[target].label}`}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-base-content/60">No decision can be made from the current status ({STATUS_META[candidate.status]?.label}).</p>
        )}
      </div>
    </div>
  );
}
