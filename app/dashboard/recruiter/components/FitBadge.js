"use client";

import { Loader2, AlertTriangle } from "lucide-react";

// A screening takes well under a minute; still queued after this means no worker is picking it up
export const SCREENING_STALLED_MS = 5 * 60 * 1000;

// Stage-1 screening state for a candidate: "scored" | "queued" | "stalled" | "failed" | "none"
export function fitState(candidate, now = Date.now()) {
  const analysis = candidate.fitAnalysis || {};
  const screenedAt = candidate.screenedAt ? new Date(candidate.screenedAt) : null;
  const newerThanScore = (at) => at && (!screenedAt || new Date(at) > screenedAt);
  if (analysis.error && newerThanScore(analysis.failedAt)) return "failed";
  if (newerThanScore(analysis.queuedAt)) {
    return now - new Date(analysis.queuedAt).getTime() > SCREENING_STALLED_MS ? "stalled" : "queued";
  }
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
  if (state === "stalled") {
    return (
      <span className={`badge ${size} badge-warning badge-outline gap-1`} title="Screening hasn't started – is the hiring worker running?">
        <AlertTriangle className="h-3 w-3" /> Delayed
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
      <span className={`badge ${size} ${fitColor(candidate.fitScore)} font-semibold whitespace-nowrap shrink-0`} title="AI fit score (0–100)">
        Fit {candidate.fitScore}
      </span>
    );
  }
  return <span className={`badge ${size} badge-ghost text-base-content/50`}>Not screened</span>;
}
