"use client";

import { Gauge, RefreshCw, AlertTriangle, Loader2 } from "lucide-react";
import FitBadge, { fitState } from "./FitBadge";

const EXPERIENCE_LABELS = {
  meets: "Meets requirement",
  above: "Above requirement",
  below: "Below requirement",
  unknown: "Unclear",
};
const EDUCATION_LABELS = {
  relevant: "Relevant",
  partially_relevant: "Partially relevant",
  not_relevant: "Not relevant",
  unknown: "Unclear",
};

function Chips({ items, className }) {
  if (!items?.length) return <span className="text-xs text-base-content/40">None</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <span key={item} className={`badge badge-sm ${className}`}>{item}</span>
      ))}
    </div>
  );
}

function Bullets({ items }) {
  if (!items?.length) return <p className="text-xs text-base-content/40">None noted</p>;
  return (
    <ul className="list-disc list-inside space-y-0.5 text-sm text-base-content/80">
      {items.map((item) => <li key={item}>{item}</li>)}
    </ul>
  );
}

function Label({ children }) {
  return <p className="text-[11px] font-semibold uppercase tracking-wide text-base-content/50 mb-1">{children}</p>;
}

/**
 * Stage-1 screening results for one candidate (docs/ai-hiring/12-recruiter-ui.md §3).
 */
export default function ScreeningSection({ candidate, onScreen, screening }) {
  const state = fitState(candidate);
  const analysis = candidate.fitAnalysis || {};
  const hasResult = candidate.fitScore != null && analysis.skillMatch;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-base-content/60 uppercase tracking-wider">
          <Gauge className="h-3.5 w-3.5" /> AI Screening
          <span className="ml-1 normal-case tracking-normal"><FitBadge candidate={candidate} size="badge-xs" /></span>
        </p>
        <button
          className="btn btn-outline btn-xs gap-1"
          onClick={() => onScreen(candidate)}
          disabled={screening || state === "queued"}
        >
          {screening || state === "queued"
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <RefreshCw className="h-3 w-3" />}
          {hasResult ? "Re-screen" : "Screen"}
        </button>
      </div>

      {state === "failed" && (
        <div className="alert alert-error py-2 text-sm">
          <AlertTriangle className="h-4 w-4" />
          <span>{analysis.error || "Screening failed"} – retry with the button above.</span>
        </div>
      )}

      {analysis.manualReview && (
        <div className="alert alert-warning py-2 text-sm">
          <AlertTriangle className="h-4 w-4" />
          <span>The resume could not be read. Review it manually.</span>
        </div>
      )}

      {!hasResult ? (
        state !== "failed" && (
          <p className="text-sm text-base-content/50">
            {state === "queued" ? "Screening is queued and will appear here shortly." : "Not screened yet."}
          </p>
        )
      ) : (
        <>
          {analysis.rationale && (
            <p className="text-sm text-base-content/80 leading-relaxed">{analysis.rationale}</p>
          )}

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label>Matched skills</Label>
              <Chips items={analysis.skillMatch.matched} className="badge-success badge-outline" />
            </div>
            <div>
              <Label>Missing skills</Label>
              <Chips items={analysis.skillMatch.missing} className="badge-error badge-outline" />
            </div>
            {analysis.skillMatch.extra?.length > 0 && (
              <div>
                <Label>Other relevant skills</Label>
                <Chips items={analysis.skillMatch.extra} className="badge-ghost" />
              </div>
            )}
            {analysis.skillMatch.unverified?.length > 0 && (
              <div>
                <Label>Claimed by AI but not found in resume</Label>
                <Chips items={analysis.skillMatch.unverified} className="badge-warning badge-outline" />
              </div>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div>
              <Label>Experience</Label>
              <p>
                {EXPERIENCE_LABELS[analysis.experienceMatch?.verdict] || "Unclear"}
                {analysis.experienceMatch?.candidateYears != null && ` · ${analysis.experienceMatch.candidateYears} yrs`}
                {analysis.experienceMatch?.required && (
                  <span className="text-base-content/50"> (needs {analysis.experienceMatch.required})</span>
                )}
              </p>
            </div>
            <div>
              <Label>Education</Label>
              <p>
                {EDUCATION_LABELS[analysis.educationMatch?.verdict] || "Unclear"}
                {analysis.educationMatch?.note && (
                  <span className="text-base-content/50"> · {analysis.educationMatch.note}</span>
                )}
              </p>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label>Strengths</Label>
              <Bullets items={analysis.strengths} />
            </div>
            <div>
              <Label>Concerns</Label>
              <Bullets items={analysis.concerns} />
            </div>
          </div>

          {candidate.screenedAt && (
            <p className="text-[10px] text-base-content/40">
              Screened {new Date(candidate.screenedAt).toLocaleString()}
              {analysis.model ? ` · ${analysis.model}` : ""}
            </p>
          )}
        </>
      )}
    </div>
  );
}
