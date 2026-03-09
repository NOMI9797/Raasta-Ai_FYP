"use client";

import { useState, useEffect } from "react";
import { Send, CheckCircle, Loader2, Briefcase, MapPin, AlertCircle } from "lucide-react";

export default function ApplyPage({ params }) {
  const { jobId } = params;
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "",
    email: "",
    linkedinUrl: "",
    coverNote: "",
  });
  const [resumeFile, setResumeFile] = useState(null);

  useEffect(() => {
    fetch(`/api/hiring/apply/${jobId}/info`)
      .then((r) => r.json())
      .then((data) => {
        if (data.job) setJob(data.job);
        else setError(data.error || "Job not found");
      })
      .catch(() => setError("Failed to load job details"))
      .finally(() => setLoading(false));
  }, [jobId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) {
      setError("Name and email are required");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const fd = new FormData();
      fd.append("name", form.name);
      fd.append("email", form.email);
      if (form.linkedinUrl) fd.append("linkedinUrl", form.linkedinUrl);
      if (form.coverNote) fd.append("coverNote", form.coverNote);
      if (resumeFile) fd.append("resume", resumeFile);

      const res = await fetch(`/api/hiring/apply/${jobId}`, {
        method: "POST",
        body: fd,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submission failed");
      setSubmitted(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-base-100">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-base-100">
        <div className="text-center space-y-3">
          <AlertCircle className="h-12 w-12 text-error mx-auto" />
          <h2 className="text-xl font-semibold">Job not found</h2>
          <p className="text-base-content/60">{error || "This position may have been removed."}</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-base-100 p-4">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="bg-success/10 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
            <CheckCircle className="h-10 w-10 text-success" />
          </div>
          <h2 className="text-2xl font-bold">Application Submitted!</h2>
          <p className="text-base-content/60">
            Thank you for applying to <strong>{job.title}</strong>. The recruiter will review your
            application and get back to you.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base-100 py-10 px-4">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Job header */}
        <div className="bg-base-200 rounded-xl p-5 space-y-2 border border-base-300">
          <h1 className="text-2xl font-bold">{job.title}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-base-content/60">
            {job.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-4 w-4" /> {job.location}
              </span>
            )}
            {job.employmentType && (
              <span className="flex items-center gap-1">
                <Briefcase className="h-4 w-4" /> {job.employmentType}
              </span>
            )}
          </div>
          {job.formalDescription && (
            <p className="text-sm mt-2 whitespace-pre-wrap">{job.formalDescription}</p>
          )}
        </div>

        {/* Apply form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <h2 className="text-lg font-semibold">Apply for this position</h2>

          {error && (
            <div className="alert alert-error text-sm py-2">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          <div className="form-control">
            <label className="label">
              <span className="label-text">Full name *</span>
            </label>
            <input
              type="text"
              className="input input-bordered input-sm w-full"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>

          <div className="form-control">
            <label className="label">
              <span className="label-text">Email *</span>
            </label>
            <input
              type="email"
              className="input input-bordered input-sm w-full"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </div>

          <div className="form-control">
            <label className="label">
              <span className="label-text">LinkedIn profile URL</span>
            </label>
            <input
              type="url"
              className="input input-bordered input-sm w-full"
              placeholder="https://linkedin.com/in/..."
              value={form.linkedinUrl}
              onChange={(e) => setForm({ ...form, linkedinUrl: e.target.value })}
            />
          </div>

          <div className="form-control">
            <label className="label">
              <span className="label-text">Resume / CV (.txt, .pdf — text content will be parsed)</span>
            </label>
            <input
              type="file"
              className="file-input file-input-bordered file-input-sm w-full"
              accept=".txt,.pdf,.doc,.docx"
              onChange={(e) => setResumeFile(e.target.files?.[0] || null)}
            />
          </div>

          <div className="form-control">
            <label className="label">
              <span className="label-text">Cover note</span>
            </label>
            <textarea
              className="textarea textarea-bordered textarea-sm w-full"
              rows={4}
              placeholder="Why are you a great fit for this role?"
              value={form.coverNote}
              onChange={(e) => setForm({ ...form, coverNote: e.target.value })}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-sm w-full gap-2"
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Submitting…
              </>
            ) : (
              <>
                <Send className="h-4 w-4" /> Submit Application
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
