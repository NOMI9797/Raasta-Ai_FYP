"use client";

import {
  Briefcase,
  MapPin,
  Clock,
  DollarSign,
  Trash2,
  Check,
  Users,
  Link2,
  Send,
  ExternalLink,
  CheckCircle2,
  MessageCircleQuestion,
} from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

const STATUS_BADGES = {
  draft: "badge-ghost",
  published: "badge-success",
  closed: "badge-error",
};

// Where the job is posted. The publish panel (opened with Publish) does the work.
function PlatformChip({ label, posted }) {
  if (!posted) return <span className="badge badge-sm badge-ghost">{label}: not posted</span>;
  return (
    <span className="badge badge-sm badge-success gap-1">
      <CheckCircle2 className="h-3 w-3" /> {label}
      {posted.url && (
        <a href={posted.url} target="_blank" rel="noopener noreferrer" aria-label={`Open the ${label} post`}>
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </span>
  );
}

export default function JobCard({ job, onDelete, onPublish }) {
  const [copiedLink, setCopiedLink] = useState(false);
  const router = useRouter();

  const skills = job.requiredSkills || [];
  const stack = job.techStack || [];
  const applyUrl = typeof window !== "undefined"
    ? `${window.location.origin}/apply/${job.id}`
    : `/apply/${job.id}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(applyUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
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
          aria-label={`Delete job ${job.title}`}
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

      {/* Pipeline counters (docs/ai-hiring/12-recruiter-ui.md §2) */}
      {job.counts && (
        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            ["Applied", job.counts.applied],
            ["Shortlisted", job.counts.shortlisted],
            ["Interviewed", job.counts.interviewed],
            ["Final", job.counts.final],
          ].map(([label, value]) => (
            <div key={label} className="bg-base-100 rounded-lg py-1.5 border border-base-300">
              <p className="text-sm font-semibold">{value}</p>
              <p className="text-[10px] text-base-content/60">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Apply link + candidates */}
      <div className="flex items-center gap-2 flex-wrap">
        <button className="btn btn-ghost btn-xs gap-1" onClick={handleCopyLink}>
          {copiedLink ? <Check className="h-3.5 w-3.5 text-success" /> : <Link2 className="h-3.5 w-3.5" />}
          {copiedLink ? "Copied" : "Copy apply link"}
        </button>
        <button
          className="btn btn-ghost btn-xs gap-1"
          onClick={() => router.push(`/dashboard/recruiter/jobs/${job.id}/candidates`)}
        >
          <Users className="h-3.5 w-3.5" /> View candidates
        </button>
        <button
          className="btn btn-ghost btn-xs gap-1"
          onClick={() => router.push(`/dashboard/recruiter/jobs/${job.id}/interview-questions`)}
        >
          <MessageCircleQuestion className="h-3.5 w-3.5" /> Interview questions
        </button>
      </div>

      {/* Distribution: one post per platform, written for it */}
      <div className="border-t border-base-300 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <PlatformChip label="LinkedIn" posted={job.published?.linkedin} />
            <PlatformChip label="Rozee.pk" posted={job.published?.rozee} />
            <PlatformChip label="Indeed" posted={job.published?.indeed} />
          </div>
          <button className="btn btn-primary btn-xs gap-1" onClick={() => onPublish(job)}>
            <Send className="h-3.5 w-3.5" /> Publish
          </button>
        </div>
      </div>
    </div>
  );
}
