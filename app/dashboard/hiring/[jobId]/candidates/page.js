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
  MapPin,
  Phone,
  Github,
  FolderGit2,
  Zap,
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
    parsed.experience?.length > 0 ||
    parsed.projects?.length > 0 ||
    parsed.education?.length > 0 ||
    parsed.summary
  );
}

function SkillBadge({ label, color = "badge-primary" }) {
  return <span className={`badge badge-sm badge-outline ${color}`}>{label}</span>;
}

function SectionTitle({ icon, children }) {
  return (
    <p className="flex items-center gap-1.5 text-xs font-semibold text-base-content/60 uppercase tracking-wider mb-2">
      {icon}
      {children}
    </p>
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

        {/* Apply link */}
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
              const p = c.parsedData || {};
              const hasParsed = hasUsableParsedData(p);
              const isReparsing = reparsingId === c.id;

              // merge parsed contact over submitted fields
              const displayName = p.name || c.name;
              const displayEmail = p.email || c.email;
              const displayPhone = p.phone || null;
              const displayLocation = p.location || null;
              const displayGithub = p.github || null;
              const displayLinkedin = p.linkedin || c.linkedinUrl || null;
              const displayAvailability = p.availability || null;

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
                    <div className="bg-primary/10 text-primary rounded-full w-10 h-10 flex items-center justify-center shrink-0 font-bold text-sm">
                      {displayName?.charAt(0)?.toUpperCase() || "?"}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{displayName}</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs text-base-content/60 truncate">{displayEmail}</p>
                        {displayLocation && (
                          <p className="text-xs text-base-content/40 flex items-center gap-0.5">
                            <MapPin className="h-2.5 w-2.5" />{displayLocation}
                          </p>
                        )}
                      </div>
                    </div>

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
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>

                    <ChevronDown
                      className={`h-4 w-4 text-base-content/40 transition-transform shrink-0 ${isExpanded ? "rotate-180" : ""}`}
                    />
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="border-t border-base-300 divide-y divide-base-300/50">

                      {/* Contact strip */}
                      <div className="p-4 flex flex-wrap gap-2 items-center">
                        <a href={`mailto:${displayEmail}`} className="btn btn-ghost btn-xs gap-1">
                          <Mail className="h-3.5 w-3.5" /> Email
                        </a>
                        {displayPhone && (
                          <a href={`tel:${displayPhone}`} className="btn btn-ghost btn-xs gap-1">
                            <Phone className="h-3.5 w-3.5" /> {displayPhone}
                          </a>
                        )}
                        {displayLinkedin && (
                          <a
                            href={displayLinkedin.startsWith("http") ? displayLinkedin : `https://${displayLinkedin}`}
                            target="_blank" rel="noopener noreferrer"
                            className="btn btn-ghost btn-xs gap-1"
                          >
                            <Linkedin className="h-3.5 w-3.5" /> LinkedIn
                          </a>
                        )}
                        {displayGithub && (
                          <a
                            href={displayGithub.startsWith("http") ? displayGithub : `https://${displayGithub}`}
                            target="_blank" rel="noopener noreferrer"
                            className="btn btn-ghost btn-xs gap-1"
                          >
                            <Github className="h-3.5 w-3.5" /> GitHub
                          </a>
                        )}
                        {c.resumeUrl && (
                          <span className="btn btn-ghost btn-xs gap-1 cursor-default">
                            <FileText className="h-3.5 w-3.5 text-primary" />
                            {c.resumeUrl.replace("uploaded:", "")}
                          </span>
                        )}
                        {displayAvailability && (
                          <span className="badge badge-outline badge-xs ml-auto">{displayAvailability}</span>
                        )}
                        <p className="text-[10px] text-base-content/40 ml-auto">
                          Applied {new Date(c.appliedAt).toLocaleDateString()}
                        </p>
                      </div>

                      {/* Cover note */}
                      {c.coverNote && (
                        <div className="p-4">
                          <SectionTitle icon={<MessageSquare className="h-3.5 w-3.5" />}>Cover Note</SectionTitle>
                          <p className="text-sm text-base-content/80 whitespace-pre-wrap leading-relaxed">
                            {c.coverNote}
                          </p>
                        </div>
                      )}

                      {/* AI Resume Analysis */}
                      <div className="p-4 space-y-5">
                        <div className="flex items-center justify-between">
                          <SectionTitle icon={<Sparkles className="h-3.5 w-3.5" />}>
                            AI Resume Analysis
                          </SectionTitle>
                          <button
                            className="btn btn-ghost btn-xs gap-1"
                            disabled={isReparsing}
                            onClick={(e) => { e.stopPropagation(); handleReparse(c); }}
                          >
                            {isReparsing
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Sparkles className="h-3.5 w-3.5" />}
                            {isReparsing ? "Parsing…" : "Re-parse with AI"}
                          </button>
                        </div>

                        {/* Parse error / no data states */}
                        {(p.parseError || !hasParsed) && (
                          <div className="flex items-start gap-2 bg-warning/10 border border-warning/20 rounded-lg p-3">
                            <AlertCircle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                            <div>
                              <p className="text-sm font-medium text-warning">
                                {p.parseError ? "Resume could not be parsed" : "No resume data extracted"}
                              </p>
                              <p className="text-xs text-base-content/60 mt-0.5">
                                {p.parseError
                                  ? p.parseError
                                  : c.resumeUrl
                                    ? "The file format may be binary. Click 'Re-parse with AI' to extract from cover note."
                                    : "No resume uploaded. Click 'Re-parse with AI' to analyse the cover note."}
                              </p>
                            </div>
                          </div>
                        )}

                        {hasParsed && (
                          <div className="space-y-5">
                            {/* Summary */}
                            {p.summary && (
                              <div>
                                <SectionTitle icon={<Sparkles className="h-3.5 w-3.5" />}>
                                  Professional Summary
                                </SectionTitle>
                                <p className="text-sm text-base-content/80 bg-primary/5 border border-primary/15 rounded-lg p-3 leading-relaxed">
                                  {p.summary}
                                </p>
                              </div>
                            )}

                            {/* Skills */}
                            {(p.skills?.length > 0 || p.skillsByCategory) && (
                              <div>
                                <SectionTitle icon={<Code2 className="h-3.5 w-3.5" />}>Technical Skills</SectionTitle>
                                {p.skillsByCategory &&
                                Object.values(p.skillsByCategory).some((arr) => arr?.length > 0) ? (
                                  <div className="space-y-2">
                                    {Object.entries(p.skillsByCategory).map(([cat, skills]) => {
                                      if (!skills?.length) return null;
                                      return (
                                        <div key={cat} className="flex items-start gap-2">
                                          <span className="text-[10px] text-base-content/50 uppercase tracking-wide w-20 shrink-0 pt-0.5 font-semibold">
                                            {cat}
                                          </span>
                                          <div className="flex flex-wrap gap-1">
                                            {skills.map((s, i) => (
                                              <SkillBadge key={i} label={s} color="badge-primary" />
                                            ))}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div className="flex flex-wrap gap-1.5">
                                    {p.skills.map((s, i) => (
                                      <SkillBadge key={i} label={s} color="badge-primary" />
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Experience */}
                            {p.experience?.length > 0 && (
                              <div>
                                <SectionTitle icon={<Briefcase className="h-3.5 w-3.5" />}>
                                  Experience
                                  {p.yearsExperience != null && (
                                    <span className="ml-1 text-base-content/40 normal-case">
                                      (~{p.yearsExperience} yr{p.yearsExperience !== 1 ? "s" : ""})
                                    </span>
                                  )}
                                </SectionTitle>
                                <div className="space-y-3">
                                  {p.experience.map((exp, i) => (
                                    <div key={i} className="bg-base-300/40 rounded-lg p-3 space-y-1.5">
                                      <div className="flex items-start justify-between gap-2 flex-wrap">
                                        <div>
                                          <p className="text-sm font-semibold text-base-content">{exp.title}</p>
                                          <p className="text-xs text-base-content/60">{exp.company}</p>
                                        </div>
                                        {exp.period && (
                                          <span className="text-xs text-base-content/40 flex items-center gap-1 shrink-0">
                                            <Clock className="h-3 w-3" /> {exp.period}
                                          </span>
                                        )}
                                      </div>
                                      {exp.bullets?.length > 0 && (
                                        <ul className="space-y-1">
                                          {exp.bullets.map((b, j) => (
                                            <li key={j} className="text-xs text-base-content/70 flex gap-1.5">
                                              <span className="text-primary mt-0.5 shrink-0">•</span>
                                              {b}
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Projects */}
                            {p.projects?.length > 0 && (
                              <div>
                                <SectionTitle icon={<FolderGit2 className="h-3.5 w-3.5" />}>Key Projects</SectionTitle>
                                <div className="space-y-2">
                                  {p.projects.map((proj, i) => (
                                    <div key={i} className="bg-base-300/40 rounded-lg p-3 space-y-1.5">
                                      <p className="text-sm font-semibold text-base-content">{proj.name}</p>
                                      {proj.description && (
                                        <p className="text-xs text-base-content/70">{proj.description}</p>
                                      )}
                                      {proj.technologies?.length > 0 && (
                                        <div className="flex flex-wrap gap-1">
                                          {proj.technologies.map((t, j) => (
                                            <SkillBadge key={j} label={t} color="badge-secondary" />
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Education */}
                            {p.education?.length > 0 && (
                              <div>
                                <SectionTitle icon={<GraduationCap className="h-3.5 w-3.5" />}>Education</SectionTitle>
                                <div className="space-y-2">
                                  {p.education.map((edu, i) => (
                                    <div key={i} className="bg-base-300/40 rounded-lg p-3">
                                      <p className="text-sm font-semibold text-base-content">{edu.degree}</p>
                                      <p className="text-xs text-base-content/60">{edu.institution}</p>
                                      {edu.period && (
                                        <p className="text-xs text-base-content/40 mt-0.5">{edu.period}</p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Strengths */}
                            {p.strengths?.length > 0 && (
                              <div>
                                <SectionTitle icon={<Zap className="h-3.5 w-3.5" />}>Strengths</SectionTitle>
                                <div className="flex flex-wrap gap-1.5">
                                  {p.strengths.map((s, i) => (
                                    <SkillBadge key={i} label={s} color="badge-accent" />
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Footer */}
                      <div className="p-3 flex justify-end">
                        <button
                          className="btn btn-ghost btn-xs text-error"
                          onClick={(e) => { e.stopPropagation(); handleDelete(c.id); }}
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
