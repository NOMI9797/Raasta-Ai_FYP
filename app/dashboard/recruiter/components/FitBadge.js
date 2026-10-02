"use client";

import { Loader2, AlertTriangle } from "lucide-react";

// Stage-1 screening state for a candidate: "scored" | "queued" | "failed" | "none"
export function fitState(candidate) {
  const analysis = candidate.fitAnalysis || {};
  const screenedAt = candidate.screenedAt ? new Date(candidate.screenedAt) : null;
  const newerThanScore = (at) => at && (!screenedAt || new Date(at) > screenedAt);
  if (analysis.error && newerThanScore(analysis.failedAt)) return "failed";
  if (newerThanScore(analysis.queuedAt)) return "queued";
  if (candidate.fitScore != null) return "scored";
  return "none";
}

// Green ≥ 75, yellow 50–74, red < 50 (docs/ai-hiring/06-stage1-screening.md §6)
export function fitColor(score) {
  if (score >= 75) return "badge-success";
  if (score >= 50) return "badge-warning";
  return "badge-error";
}

export default function FitBadge({ candidate, size = "badge-sm" }) {
  const state = fitState(candidate);
  if (state === "queued") {
    return (
      <span className={`badge ${size} badge-ghost gap-1`} title="AI screening is queued">
        <Loader2 className="h-3 w-3 animate-spin" /> Screening
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className={`badge ${size} badge-error badge-outline gap-1`} title="Screening failed – retry">
        <AlertTriangle className="h-3 w-3" /> Failed
      </span>
    );
  }
  if (state === "scored") {
    return (
      <span className={`badge ${size} ${fitColor(candidate.fitScore)} font-semibold`} title="AI fit score (0–100)">
        Fit {candidate.fitScore}
      </span>
    );
  }
  return <span className={`badge ${size} badge-ghost text-base-content/50`}>Not screened</span>;
}
