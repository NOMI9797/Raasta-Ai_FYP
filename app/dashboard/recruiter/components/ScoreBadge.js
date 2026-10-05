"use client";

import { fitColor } from "./FitBadge";

// A 0–100 score with the same colour scale as the fit badge. Renders nothing without a score.
export default function ScoreBadge({ label, score, size = "badge-xs", title }) {
  if (score == null) return null;
  return (
    <span className={`badge ${size} ${fitColor(score)} font-semibold whitespace-nowrap shrink-0`} title={title || `${label} score (0–100)`}>
      {label} {score}
    </span>
  );
}
