"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Settings2, ChevronDown, AlertTriangle, Loader2 } from "lucide-react";
import { getHiringConfig } from "@/libs/hiring/config";

const WEIGHT_LABELS = { resume: "Resume fit", interview: "Interview", communication: "Communication" };

const NUMBER_FIELDS = [
  { key: "minFitScore", label: "Min fit score", min: 0, max: 100, hint: "0–100" },
  { key: "maxShortlist", label: "Max shortlist", min: 1, max: 1000, hint: "Blank = no cap", optional: true },
  { key: "questionCount", label: "Interview questions", min: 3, max: 15, hint: "3–15" },
  { key: "interviewMaxMinutes", label: "Interview length (min)", min: 5, max: 60, hint: "5–60" },
  { key: "inviteExpiryHours", label: "Invite expiry (hours)", min: 1, max: 720 },
  { key: "finalThreshold", label: "Final threshold", min: 0, max: 100, hint: "0–100" },
];

const TOGGLES = [
  { key: "autoScreen", label: "Auto-screen", hint: "Score each application as it arrives" },
  { key: "autoInvite", label: "Auto-invite", hint: "Email the interview link when shortlisted" },
  { key: "recordVideo", label: "Record video", hint: "Record the camera during interviews" },
  { key: "trackBehavior", label: "Track behaviour", hint: "Measure eye contact, head movement and expressions from the camera (needs video)" },
  { key: "autoFinalize", label: "Auto-finalize", hint: "Apply final decisions without your approval" },
];

// Percentages that always add up to 100
function toPercents(weights) {
  const keys = Object.keys(WEIGHT_LABELS);
  const total = keys.reduce((sum, k) => sum + (weights[k] || 0), 0) || 1;
  const pct = Object.fromEntries(keys.map((k) => [k, Math.round(((weights[k] || 0) / total) * 100)]));
  pct[keys[0]] += 100 - keys.reduce((sum, k) => sum + pct[k], 0);
  return pct;
}

// Set one weight and rescale the others proportionally so the total stays 100
function rebalance(percents, changedKey, value) {
  const others = Object.keys(percents).filter((k) => k !== changedKey);
  const remaining = 100 - value;
  const othersTotal = others.reduce((sum, k) => sum + percents[k], 0);
  const next = { ...percents, [changedKey]: value };
  others.forEach((k, i) => {
    next[k] = othersTotal > 0
      ? Math.round((percents[k] / othersTotal) * remaining)
      : Math.round(remaining / others.length) + (i === 0 ? remaining % others.length : 0);
  });
  const drift = 100 - Object.values(next).reduce((a, b) => a + b, 0);
  next[others[0]] += drift;
  return next;
}

function toForm(job) {
  const config = getHiringConfig(job);
  return { ...config, finalWeights: toPercents(config.finalWeights) };
}

/**
 * "Hiring automation" card: edits jobs.hiring_config (docs/ai-hiring/12-recruiter-ui.md §2).
 */
export default function JobHiringSettings({ job, onSaved }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => toForm(job));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);

  const setNumber = (key, raw, optional) => {
    const value = raw === "" ? (optional ? null : "") : Number(raw);
    setForm((f) => ({ ...f, [key]: value }));
  };

  const save = async () => {
    setSaving(true);
    setErrors([]);
    try {
      const hiringConfig = {
        ...form,
        finalWeights: Object.fromEntries(
          Object.entries(form.finalWeights).map(([k, v]) => [k, v / 100])
        ),
      };
      const res = await fetch(`/api/hiring/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hiringConfig }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrors(data.details || [data.error || "Failed to save"]);
        throw new Error(data.error || "Failed to save");
      }
      setForm(toForm(data.job));
      onSaved?.(data.job);
      toast.success("Hiring settings saved");
    } catch (err) {
      toast.error(err.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-base-200 rounded-xl border border-base-300">
      <button
        className="w-full flex items-center gap-2 p-4 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <Settings2 className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <p className="font-medium text-sm">Hiring automation</p>
          <p className="text-xs text-base-content/60">
            Min fit {form.minFitScore} · {form.maxShortlist == null ? "no shortlist cap" : `top ${form.maxShortlist}`}
            {" · "}auto-screen {form.autoScreen ? "on" : "off"} · auto-invite {form.autoInvite ? "on" : "off"}
          </p>
        </div>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-base-300 p-4 space-y-5">
          <div className="grid sm:grid-cols-2 gap-3">
            {TOGGLES.map(({ key, label, hint }) => (
              <label key={key} className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className={`toggle toggle-sm mt-0.5 ${key === "autoFinalize" ? "toggle-warning" : "toggle-primary"}`}
                  checked={Boolean(form[key])}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))}
                />
                <span>
                  <span className="text-sm font-medium block">{label}</span>
                  <span className="text-xs text-base-content/60">{hint}</span>
                </span>
              </label>
            ))}
          </div>

          {form.autoFinalize && (
            <div className="alert alert-warning py-2 text-sm">
              <AlertTriangle className="h-4 w-4" />
              <span>Candidates will be rejected without your review.</span>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {NUMBER_FIELDS.map(({ key, label, min, max, hint, optional }) => (
              <label key={key} className="form-control">
                <span className="label-text text-xs mb-1">{label}</span>
                <input
                  type="number"
                  className="input input-bordered input-sm"
                  min={min}
                  max={max}
                  value={form[key] ?? ""}
                  placeholder={optional ? "No cap" : ""}
                  onChange={(e) => setNumber(key, e.target.value, optional)}
                />
                {hint && <span className="label-text-alt text-base-content/50 mt-0.5">{hint}</span>}
              </label>
            ))}
          </div>

          <div>
            <p className="text-xs font-medium mb-2">Final score weights</p>
            <div className="space-y-2">
              {Object.entries(WEIGHT_LABELS).map(([key, label]) => (
                <div key={key} className="flex items-center gap-3">
                  <span className="text-xs w-28">{label}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    className="range range-xs range-primary flex-1"
                    value={form.finalWeights[key]}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, finalWeights: rebalance(f.finalWeights, key, Number(e.target.value)) }))
                    }
                  />
                  <span className="text-xs w-10 text-right font-mono">{form.finalWeights[key]}%</span>
                </div>
              ))}
            </div>
          </div>

          {errors.length > 0 && (
            <ul className="text-xs text-error list-disc list-inside">
              {errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}

          <div className="flex justify-end gap-2">
            <button className="btn btn-ghost btn-sm" onClick={() => setForm(toForm(job))} disabled={saving}>
              Reset
            </button>
            <button className="btn btn-primary btn-sm gap-1" onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
