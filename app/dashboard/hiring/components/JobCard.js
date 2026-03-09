"use client";

import {
  Briefcase,
  MapPin,
  Clock,
  DollarSign,
  Sparkles,
  Trash2,
  Loader2,
  Copy,
  Check,
} from "lucide-react";
import { useState } from "react";

const STATUS_BADGES = {
  draft: "badge-ghost",
  published: "badge-success",
  closed: "badge-error",
};

export default function JobCard({ job, onDelete, onGeneratePost, isGenerating }) {
  const [copied, setCopied] = useState(false);

  const skills = job.requiredSkills || [];
  const stack = job.techStack || [];

  const handleCopy = () => {
    if (!job.linkedinPost) return;
    navigator.clipboard.writeText(job.linkedinPost);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-base-200 rounded-xl border border-base-300 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-base-content truncate">{job.title}</h3>
            <span className={`badge badge-xs ${STATUS_BADGES[job.status] || "badge-ghost"}`}>
              {job.status}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-base-content/60">
            {job.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" /> {job.location}
                {job.locationType && ` (${job.locationType})`}
              </span>
            )}
            {job.employmentType && (
              <span className="flex items-center gap-1">
                <Briefcase className="h-3 w-3" /> {job.employmentType}
              </span>
            )}
            {job.experienceRange && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> {job.experienceRange}
              </span>
            )}
            {(job.salaryMin || job.salaryMax) && (
              <span className="flex items-center gap-1">
                <DollarSign className="h-3 w-3" />
                {job.salaryCurrency || "USD"} {job.salaryMin?.toLocaleString() || "?"} –{" "}
                {job.salaryMax?.toLocaleString() || "?"}
              </span>
            )}
          </div>
        </div>

        <button
          className="btn btn-ghost btn-xs text-error"
          onClick={() => onDelete(job.id)}
          title="Delete job"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Skills / Stack */}
      {(skills.length > 0 || stack.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {skills.map((s) => (
            <span key={s} className="badge badge-xs badge-outline badge-primary">
              {s}
            </span>
          ))}
          {stack.map((s) => (
            <span key={s} className="badge badge-xs badge-outline badge-secondary">
              {s}
            </span>
          ))}
        </div>
      )}

      {/* AI Post section */}
      <div className="border-t border-base-300 pt-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-base-content/70">LinkedIn post</span>
          <div className="flex items-center gap-1">
            {job.linkedinPost && (
              <button className="btn btn-ghost btn-xs" onClick={handleCopy}>
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            )}
            <button
              className="btn btn-primary btn-xs gap-1"
              onClick={() => onGeneratePost(job.id)}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating…
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  {job.linkedinPost ? "Regenerate" : "Generate AI post"}
                </>
              )}
            </button>
          </div>
        </div>

        {job.linkedinPost && (
          <div className="bg-base-100 rounded-lg p-3 text-sm whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
            {job.linkedinPost}
          </div>
        )}
      </div>
    </div>
  );
}
