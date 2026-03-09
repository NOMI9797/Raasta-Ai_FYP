"use client";

import { useState } from "react";
import { X, Plus, Loader2 } from "lucide-react";

const LOCATION_TYPES = [
  { value: "remote", label: "Remote" },
  { value: "onsite", label: "On-site" },
  { value: "hybrid", label: "Hybrid" },
];

const EMPLOYMENT_TYPES = [
  { value: "full-time", label: "Full-time" },
  { value: "part-time", label: "Part-time" },
  { value: "contract", label: "Contract" },
];

export default function CreateJobModal({ open, onClose, onSubmit, isSubmitting }) {
  const [form, setForm] = useState({
    title: "",
    requiredSkills: "",
    experienceRange: "",
    techStack: "",
    salaryMin: "",
    salaryMax: "",
    salaryCurrency: "USD",
    location: "",
    locationType: "remote",
    employmentType: "full-time",
  });

  const handleChange = (field, value) =>
    setForm((p) => ({ ...p, [field]: value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;

    const payload = {
      title: form.title.trim(),
      requiredSkills: form.requiredSkills
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      experienceRange: form.experienceRange || null,
      techStack: form.techStack
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      salaryMin: form.salaryMin ? Number(form.salaryMin) : null,
      salaryMax: form.salaryMax ? Number(form.salaryMax) : null,
      salaryCurrency: form.salaryCurrency,
      location: form.location || null,
      locationType: form.locationType,
      employmentType: form.employmentType,
    };

    onSubmit(payload);
  };

  if (!open) return null;

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-lg relative">
        <button
          className="btn btn-sm btn-circle btn-ghost absolute right-3 top-3"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>

        <h3 className="font-bold text-lg mb-4">Create new job</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div className="form-control">
            <label className="label">
              <span className="label-text font-medium">Job title *</span>
            </label>
            <input
              className="input input-bordered input-sm w-full"
              placeholder="e.g. Senior React Developer"
              value={form.title}
              onChange={(e) => handleChange("title", e.target.value)}
              required
            />
          </div>

          {/* Skills + Stack */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="form-control">
              <label className="label">
                <span className="label-text text-xs">Required skills (comma-separated)</span>
              </label>
              <input
                className="input input-bordered input-sm w-full"
                placeholder="React, Node.js, TypeScript"
                value={form.requiredSkills}
                onChange={(e) => handleChange("requiredSkills", e.target.value)}
              />
            </div>
            <div className="form-control">
              <label className="label">
                <span className="label-text text-xs">Tech stack (comma-separated)</span>
              </label>
              <input
                className="input input-bordered input-sm w-full"
                placeholder="Next.js, PostgreSQL, AWS"
                value={form.techStack}
                onChange={(e) => handleChange("techStack", e.target.value)}
              />
            </div>
          </div>

          {/* Experience + Location */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="form-control">
              <label className="label">
                <span className="label-text text-xs">Experience range</span>
              </label>
              <input
                className="input input-bordered input-sm w-full"
                placeholder="3-5 years"
                value={form.experienceRange}
                onChange={(e) => handleChange("experienceRange", e.target.value)}
              />
            </div>
            <div className="form-control">
              <label className="label">
                <span className="label-text text-xs">Location</span>
              </label>
              <input
                className="input input-bordered input-sm w-full"
                placeholder="San Francisco, CA"
                value={form.location}
                onChange={(e) => handleChange("location", e.target.value)}
              />
            </div>
          </div>

          {/* Location type + Employment type */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="form-control">
              <label className="label">
                <span className="label-text text-xs">Location type</span>
              </label>
              <select
                className="select select-bordered select-sm w-full"
                value={form.locationType}
                onChange={(e) => handleChange("locationType", e.target.value)}
              >
                {LOCATION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-control">
              <label className="label">
                <span className="label-text text-xs">Employment type</span>
              </label>
              <select
                className="select select-bordered select-sm w-full"
                value={form.employmentType}
                onChange={(e) => handleChange("employmentType", e.target.value)}
              >
                {EMPLOYMENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Salary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="form-control">
              <label className="label">
                <span className="label-text text-xs">Min salary</span>
              </label>
              <input
                className="input input-bordered input-sm w-full"
                type="number"
                placeholder="80000"
                value={form.salaryMin}
                onChange={(e) => handleChange("salaryMin", e.target.value)}
              />
            </div>
            <div className="form-control">
              <label className="label">
                <span className="label-text text-xs">Max salary</span>
              </label>
              <input
                className="input input-bordered input-sm w-full"
                type="number"
                placeholder="120000"
                value={form.salaryMax}
                onChange={(e) => handleChange("salaryMax", e.target.value)}
              />
            </div>
            <div className="form-control">
              <label className="label">
                <span className="label-text text-xs">Currency</span>
              </label>
              <select
                className="select select-bordered select-sm w-full"
                value={form.salaryCurrency}
                onChange={(e) => handleChange("salaryCurrency", e.target.value)}
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="PKR">PKR</option>
              </select>
            </div>
          </div>

          {/* Submit */}
          <div className="modal-action">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={isSubmitting || !form.title.trim()}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Creating…
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" /> Create job
                </>
              )}
            </button>
          </div>
        </form>
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </div>
  );
}
