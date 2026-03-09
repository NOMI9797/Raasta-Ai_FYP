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
  Sparkles,
  AlertCircle,
  GraduationCap,
  Briefcase,
  Code2,
  Clock,
  MessageSquare,
} from "lucide-react";
import toast, { Toaster } from "react-hot-toast";

const STATUS_OPTIONS = [
  { value: "new", label: "New", color: "badge-info" },
  { value: "reviewed", label: "Reviewed", color: "badge-warning" },
  { value: "shortlisted", label: "Shortlisted", color: "badge-success" },
  { value: "rejected", label: "Rejected", color: "badge-error" },
];

function statusBadge(status) {
  return STATUS_OPTIONS.find((o) => o.value === status) || STATUS_OPTIONS[0];
}

function hasUsableParsedData(parsed) {
  if (!parsed || parsed.parseError) return false;
  return (
    parsed.skills?.length > 0 ||
    parsed.jobTitles?.length > 0 ||
    parsed.education?.length > 0 ||
    parsed.summary
  );
}

export default function CandidatesPage({ params }) {
  const { jobId } = params;
  const { data: session } = useSession();
  const router = useRouter();

  const [job, setJob] = useState(null);
  const [candidateList, setCandidateList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);
  const [reparsingId, setReparsingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [filter, setFilter] = useState("all");

  const applyUrl =
    typeof window !== "undefined"
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

  const handleReparse = async (candidate) => {
    setReparsingId(candidate.id);
    try {
      const res = await fetch(`/api/hiring/candidates/${candidate.id}/reparse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText: "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCandidateList((prev) =>
        prev.map((c) =>
          c.id === candidate.id ? { ...c, parsedData: data.candidate.parsedData } : c
        )
      );
      toast.success("Resume re-parsed successfully");
    } catch {
      toast.error("Failed to re-parse resume");
    } finally {
      setReparsingId(null);
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
    <div className="min-h-screen bg-base-100">
      <Toaster position="top-right" toastOptions={{ duration: 3000 }} />

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Back + title */}
        <div className="flex items-center gap-3">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => router.push("/dashboard/hiring")}
          >
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
            <code className="text-xs bg-base-300 rounded px-2 py-1 block truncate">
              {applyUrl}
            </code>
          </div>
          <button className="btn btn-primary btn-sm gap-1" onClick={copyLink}>
            {copiedLink ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copiedLink ? "Copied" : "Copy"}
          </button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { icon: <Users className="h-5 w-5 text-primary" />, label: "Total", val: counts.all },
            { icon: <Eye className="h-5 w-5 text-info" />, label: "New", val: counts.new },
            { icon: <Star className="h-5 w-5 text-success" />, label: "Shortlisted", val: counts.shortlisted },
            { icon: <XCircle className="h-5 w-5 text-error" />, label: "Rejected", val: counts.rejected },
          ].map(({ icon, label, val }) => (
            <div key={label} className="bg-base-200 rounded-lg p-3 text-center border border-base-300">
              <div className="flex justify-center mb-1">{icon}</div>
              <p className="text-lg font-bold">{val}</p>
              <p className="text-xs text-base-content/60">{label}</p>
            </div>
          ))}
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
              {f !== "all" && ` (${candidateList.filter((c) => c.status === f).length})`}
            </button>
          ))}
        </div>

        {/* Candidate list */}
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <Users className="h-10 w-10 text-base-content/20 mx-auto mb-3" />
            <p className="text-base-content/60">
              No candidates {filter !== "all" ? `with status "${filter}"` : "yet"}
            </p>
            <p className="text-xs text-base-content/40 mt-1">
              Share the apply link to start receiving applications
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((c) => {
              const badge = statusBadge(c.status);
              const isExpanded = expandedId === c.id;
              const parsed = c.parsedData || {};
              const hasParsed = hasUsableParsedData(parsed);
              const isReparsing = reparsingId === c.id;

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
                    <div className="bg-primary/10 text-primary rounded-full w-10 h-10 flex items-center justify-center shrink-0">
                      <span className="text-sm font-bold">
                        {c.name?.charAt(0)?.toUpperCase() || "?"}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{c.name}</p>
                      <p className="text-xs text-base-content/60 truncate">{c.email}</p>
                    </div>

                    {/* parsed indicator */}
                    {hasParsed && (
                      <span className="hidden sm:flex items-center gap-1 text-[10px] text-success font-medium">
                        <Sparkles className="h-3 w-3" /> AI parsed
                      </span>
                    )}

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
                      className={`h-4 w-4 text-base-content/40 transition-transform shrink-0 ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                    />
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="border-t border-base-300 divide-y divide-base-300/60">

                      {/* Contact + resume row */}
                      <div className="p-4 flex flex-wrap items-center gap-2">
                        <a
                          href={`mailto:${c.email}`}
                          className="btn btn-ghost btn-xs gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Mail className="h-3.5 w-3.5" /> Email
                        </a>
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
                          <span className="btn btn-ghost btn-xs gap-1 cursor-default">
                            <FileText className="h-3.5 w-3.5 text-primary" />
                            {c.resumeUrl.replace("uploaded:", "")}
                          </span>
                        )}
                        <p className="text-[10px] text-base-content/40 ml-auto">
                          Applied {new Date(c.appliedAt).toLocaleDateString()}
                        </p>
                      </div>

                      {/* Cover note */}
                      {c.coverNote && (
                        <div className="p-4 space-y-1">
                          <p className="flex items-center gap-1.5 text-xs font-semibold text-base-content/60 uppercase tracking-wider">
                            <MessageSquare className="h-3.5 w-3.5" /> Cover Note
                          </p>
                          <p className="text-sm text-base-content/80 whitespace-pre-wrap leading-relaxed">
                            {c.coverNote}
                          </p>
                        </div>
                      )}

                      {/* AI Parsed Resume Section */}
                      <div className="p-4 space-y-4">
                        <div className="flex items-center justify-between">
                          <p className="flex items-center gap-1.5 text-xs font-semibold text-base-content/60 uppercase tracking-wider">
                            <Sparkles className="h-3.5 w-3.5" /> AI Resume Analysis
                          </p>
                          <button
                            className="btn btn-ghost btn-xs gap-1"
                            disabled={isReparsing}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleReparse(c);
                            }}
                          >
                            {isReparsing ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Sparkles className="h-3.5 w-3.5" />
                            )}
                            {isReparsing ? "Parsing…" : "Re-parse with AI"}
                          </button>
                        </div>

                        {parsed.parseError ? (
                          <div className="flex items-start gap-2 bg-warning/10 border border-warning/30 rounded-lg p-3 text-sm">
                            <AlertCircle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                            <div>
                              <p className="font-medium text-warning">Resume could not be parsed</p>
                              <p className="text-xs text-base-content/60 mt-0.5">
                                {parsed.parseError}. Click "Re-parse with AI" to retry using cover note and profile info.
                              </p>
                            </div>
                          </div>
                        ) : !hasParsed ? (
                          <div className="flex items-start gap-2 bg-base-300/50 rounded-lg p-3 text-sm">
                            <AlertCircle className="h-4 w-4 text-base-content/40 shrink-0 mt-0.5" />
                            <div>
                              <p className="font-medium text-base-content/70">No resume data extracted</p>
                              <p className="text-xs text-base-content/50 mt-0.5">
                                {c.resumeUrl
                                  ? "The resume file could not be read (binary format). Click \"Re-parse with AI\" to extract data from the cover note and profile."
                                  : "No resume was uploaded. Click \"Re-parse with AI\" to analyse the cover note."}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {/* Skills */}
                            {parsed.skills?.length > 0 && (
                              <div className="space-y-2">
                                <p className="flex items-center gap-1.5 text-xs font-semibold text-base-content/70">
                                  <Code2 className="h-3.5 w-3.5" /> Skills
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  {parsed.skills.map((s, i) => (
                                    <span
                                      key={i}
                                      className="badge badge-sm badge-outline badge-primary"
                                    >
                                      {s}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Experience */}
                            {(parsed.yearsExperience != null || parsed.jobTitles?.length > 0) && (
                              <div className="space-y-2">
                                <p className="flex items-center gap-1.5 text-xs font-semibold text-base-content/70">
                                  <Briefcase className="h-3.5 w-3.5" /> Experience
                                </p>
                                {parsed.yearsExperience != null && (
                                  <p className="text-sm text-base-content/80 flex items-center gap-1">
                                    <Clock className="h-3.5 w-3.5 text-base-content/40" />
                                    ~{parsed.yearsExperience} year{parsed.yearsExperience !== 1 ? "s" : ""} experience
                                  </p>
                                )}
                                {parsed.jobTitles?.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5">
                                    {parsed.jobTitles.map((t, i) => (
                                      <span
                                        key={i}
                                        className="badge badge-sm badge-outline badge-secondary"
                                      >
                                        {t}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Education */}
                            {parsed.education?.length > 0 && (
                              <div className="space-y-2">
                                <p className="flex items-center gap-1.5 text-xs font-semibold text-base-content/70">
                                  <GraduationCap className="h-3.5 w-3.5" /> Education
                                </p>
                                <ul className="space-y-1">
                                  {parsed.education.map((e, i) => (
                                    <li key={i} className="text-sm text-base-content/80">
                                      • {e}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* Summary */}
                            {parsed.summary && (
                              <div className="space-y-2 sm:col-span-2">
                                <p className="flex items-center gap-1.5 text-xs font-semibold text-base-content/70">
                                  <Sparkles className="h-3.5 w-3.5" /> AI Summary
                                </p>
                                <p className="text-sm text-base-content/80 bg-primary/5 border border-primary/15 rounded-lg p-3 leading-relaxed">
                                  {parsed.summary}
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Footer actions */}
                      <div className="p-3 flex justify-end">
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
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
