"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Users,
  Star,
  XCircle,
  Eye,
  Link2,
  Copy,
  Check,
  ChevronDown,
  FileText,
  Linkedin,
  Mail,
} from "lucide-react";
import toast, { Toaster } from "react-hot-toast";

const STATUS_OPTIONS = [
  { value: "new", label: "New", color: "badge-info" },
  { value: "reviewed", label: "Reviewed", color: "badge-warning" },
  { value: "shortlisted", label: "Shortlisted", color: "badge-success" },
  { value: "rejected", label: "Rejected", color: "badge-error" },
];

function statusBadge(status) {
  const opt = STATUS_OPTIONS.find((o) => o.value === status) || STATUS_OPTIONS[0];
  return opt;
}

export default function CandidatesPage({ params }) {
  const { jobId } = params;
  const { data: session } = useSession();
  const router = useRouter();

  const [job, setJob] = useState(null);
  const [candidateList, setCandidateList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [filter, setFilter] = useState("all");

  const applyUrl = typeof window !== "undefined"
    ? `${window.location.origin}/apply/${jobId}`
    : `/apply/${jobId}`;

  const fetchCandidates = useCallback(async () => {
    try {
      const res = await fetch(`/api/hiring/candidates?jobId=${jobId}`);
      const data = await res.json();
      if (data.success) {
        setCandidateList(data.candidates || []);
        setJob(data.job || null);
      }
    } catch {
      toast.error("Failed to load candidates");
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    fetchCandidates();
  }, [fetchCandidates]);

  const handleStatusChange = async (candidateId, newStatus) => {
    setUpdatingId(candidateId);
    try {
      const res = await fetch(`/api/hiring/candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCandidateList((prev) =>
        prev.map((c) => (c.id === candidateId ? { ...c, status: newStatus } : c))
      );
      toast.success("Status updated");
    } catch {
      toast.error("Failed to update status");
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDelete = async (candidateId) => {
    if (!confirm("Remove this candidate?")) return;
    try {
      const res = await fetch(`/api/hiring/candidates/${candidateId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setCandidateList((prev) => prev.filter((c) => c.id !== candidateId));
      toast.success("Candidate removed");
    } catch {
      toast.error("Failed to remove candidate");
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(applyUrl);
    setCopiedLink(true);
    toast.success("Apply link copied");
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const filtered =
    filter === "all" ? candidateList : candidateList.filter((c) => c.status === filter);

  const counts = {
    all: candidateList.length,
    new: candidateList.filter((c) => c.status === "new").length,
    shortlisted: candidateList.filter((c) => c.status === "shortlisted").length,
    rejected: candidateList.filter((c) => c.status === "rejected").length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Toaster position="top-right" toastOptions={{ duration: 3000 }} />

      {/* Back + title */}
      <div className="flex items-center gap-3">
        <button className="btn btn-ghost btn-sm" onClick={() => router.push("/dashboard/hiring")}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">
            {job?.title || "Job"} — Candidates
          </h1>
          <p className="text-xs text-base-content/60 mt-0.5">
            {candidateList.length} total applicant{candidateList.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Apply link card */}
      <div className="bg-base-200 rounded-xl border border-base-300 p-4 flex items-center gap-3">
        <Link2 className="h-5 w-5 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-base-content/70 mb-1">Public apply link</p>
          <code className="text-xs bg-base-300 rounded px-2 py-1 block truncate">{applyUrl}</code>
        </div>
        <button className="btn btn-primary btn-sm gap-1" onClick={copyLink}>
          {copiedLink ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copiedLink ? "Copied" : "Copy"}
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-base-200 rounded-lg p-3 text-center border border-base-300">
          <Users className="h-5 w-5 mx-auto text-primary mb-1" />
          <p className="text-lg font-bold">{counts.all}</p>
          <p className="text-xs text-base-content/60">Total</p>
        </div>
        <div className="bg-base-200 rounded-lg p-3 text-center border border-base-300">
          <Eye className="h-5 w-5 mx-auto text-info mb-1" />
          <p className="text-lg font-bold">{counts.new}</p>
          <p className="text-xs text-base-content/60">New</p>
        </div>
        <div className="bg-base-200 rounded-lg p-3 text-center border border-base-300">
          <Star className="h-5 w-5 mx-auto text-success mb-1" />
          <p className="text-lg font-bold">{counts.shortlisted}</p>
          <p className="text-xs text-base-content/60">Shortlisted</p>
        </div>
        <div className="bg-base-200 rounded-lg p-3 text-center border border-base-300">
          <XCircle className="h-5 w-5 mx-auto text-error mb-1" />
          <p className="text-lg font-bold">{counts.rejected}</p>
          <p className="text-xs text-base-content/60">Rejected</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="tabs tabs-boxed w-fit">
        {["all", "new", "reviewed", "shortlisted", "rejected"].map((f) => (
          <button
            key={f}
            className={`tab tab-sm ${filter === f ? "tab-active" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f === "all" ? "" : ` (${candidateList.filter((c) => c.status === f).length})`}
          </button>
        ))}
      </div>

      {/* Candidate list */}
      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <Users className="h-10 w-10 text-base-content/20 mx-auto mb-3" />
          <p className="text-base-content/60">No candidates {filter !== "all" ? `with status "${filter}"` : "yet"}</p>
          <p className="text-xs text-base-content/40 mt-1">Share the apply link to start receiving applications</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => {
            const badge = statusBadge(c.status);
            const isExpanded = expandedId === c.id;
            const parsed = c.parsedData || {};

            return (
              <div
                key={c.id}
                className="bg-base-200 rounded-xl border border-base-300 overflow-hidden"
              >
                {/* Row header */}
                <div
                  className="flex items-center gap-3 p-4 cursor-pointer hover:bg-base-300/40 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : c.id)}
                >
                  <div className="avatar placeholder">
                    <div className="bg-primary/10 text-primary rounded-full w-10 h-10 flex items-center justify-center">
                      <span className="text-sm font-bold">
                        {c.name?.charAt(0)?.toUpperCase() || "?"}
                      </span>
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{c.name}</p>
                    <p className="text-xs text-base-content/60 truncate">{c.email}</p>
                  </div>

                  <span className={`badge badge-xs ${badge.color}`}>{badge.label}</span>

                  <select
                    className="select select-bordered select-xs w-28"
                    value={c.status}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => handleStatusChange(c.id, e.target.value)}
                    disabled={updatingId === c.id}
                  >
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>

                  <ChevronDown
                    className={`h-4 w-4 text-base-content/40 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                  />
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="border-t border-base-300 p-4 space-y-3 text-sm">
                    <div className="flex flex-wrap gap-3">
                      {c.email && (
                        <a
                          href={`mailto:${c.email}`}
                          className="btn btn-ghost btn-xs gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Mail className="h-3.5 w-3.5" /> Email
                        </a>
                      )}
                      {c.linkedinUrl && (
                        <a
                          href={c.linkedinUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-ghost btn-xs gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Linkedin className="h-3.5 w-3.5" /> LinkedIn
                        </a>
                      )}
                      {c.resumeUrl && (
                        <span className="btn btn-ghost btn-xs gap-1 pointer-events-none">
                          <FileText className="h-3.5 w-3.5" />
                          {c.resumeUrl.replace("uploaded:", "")}
                        </span>
                      )}
                    </div>

                    {c.coverNote && (
                      <div>
                        <p className="font-medium text-xs text-base-content/70 mb-1">Cover note</p>
                        <p className="text-base-content/80 whitespace-pre-wrap">{c.coverNote}</p>
                      </div>
                    )}

                    {/* Parsed resume data */}
                    {parsed.skills?.length > 0 && (
                      <div>
                        <p className="font-medium text-xs text-base-content/70 mb-1">Skills (parsed)</p>
                        <div className="flex flex-wrap gap-1">
                          {parsed.skills.map((s, i) => (
                            <span key={i} className="badge badge-xs badge-outline badge-primary">
                              {s}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {parsed.jobTitles?.length > 0 && (
                      <div>
                        <p className="font-medium text-xs text-base-content/70 mb-1">Past titles</p>
                        <p className="text-base-content/80">{parsed.jobTitles.join(" → ")}</p>
                      </div>
                    )}

                    {parsed.education?.length > 0 && (
                      <div>
                        <p className="font-medium text-xs text-base-content/70 mb-1">Education</p>
                        <ul className="list-disc list-inside text-base-content/80">
                          {parsed.education.map((e, i) => (
                            <li key={i}>{e}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {parsed.yearsExperience != null && (
                      <p className="text-xs text-base-content/60">
                        ~{parsed.yearsExperience} years experience
                      </p>
                    )}

                    {parsed.summary && (
                      <div>
                        <p className="font-medium text-xs text-base-content/70 mb-1">AI summary</p>
                        <p className="text-base-content/80">{parsed.summary}</p>
                      </div>
                    )}

                    <div className="pt-2 flex justify-end">
                      <button
                        className="btn btn-ghost btn-xs text-error"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(c.id);
                        }}
                      >
                        Remove candidate
                      </button>
                    </div>

                    <p className="text-[10px] text-base-content/40">
                      Applied {new Date(c.appliedAt).toLocaleDateString()}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
