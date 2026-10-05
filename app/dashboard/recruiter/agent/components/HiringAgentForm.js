"use client";

import { useEffect, useState } from "react";
import { Bot, Eye, Loader2, ShieldCheck, X } from "lucide-react";

// The hiring agent is a supervised agent (libs/agent/policy.js): it works one job from post to final shortlist
const MODES = [
  {
    value: "assisted",
    label: "Assisted",
    description: "Screens and prepares everything, then asks you before publishing, shortlisting, inviting or deciding.",
  },
  {
    value: "autopilot",
    label: "Autopilot",
    description: "Publishes, shortlists clear matches and sends invites on its own. Still asks you before anyone is held back or given a final decision.",
  },
];
const ALWAYS_ASKS = "In both modes the agent never rejects or hires anyone by itself, and close calls are always sent to you.";
const ROUTE_LABEL = { auto: "does it", ask: "asks you", human: "you do it" };
const TONES = [
  ["professional", "Professional"],
  ["casual", "Casual / friendly"],
  ["enthusiastic", "Enthusiastic"],
  ["formal", "Formal"],
];

async function getJson(url) {
  try {
    const res = await fetch(url);
    return await res.json();
  } catch {
    return {};
  }
}

function AccountSelect({ id, label, value, onChange, accounts, empty }) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium mb-1 block">{label}</label>
      <select id={id} className="select select-bordered w-full" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Do not post here</option>
        {accounts.map((a) => (
          <option key={a.dbId || a.id} value={a.dbId || a.id}>
            {a.name || a.email}{a.isActive ? "" : " (switched off)"}
          </option>
        ))}
      </select>
      {accounts.length === 0 && <p className="text-xs text-base-content/50 mt-1">{empty}</p>}
    </div>
  );
}

export default function HiringAgentForm({ onClose, onSaved, editConfig }) {
  const saved = editConfig?.config || {};
  const [name, setName] = useState(editConfig?.name || "");
  const [mode, setMode] = useState(editConfig?.mode === "autopilot" ? "autopilot" : "assisted");
  const [jobId, setJobId] = useState(saved.jobId || "");
  const [postTone, setPostTone] = useState(saved.postTone || "professional");
  const [linkedinAccountId, setLinkedinAccountId] = useState(saved.accountId || "");
  const [rozeeAccountId, setRozeeAccountId] = useState(saved.rozeeAccountId || "");
  const [dailyInviteCap, setDailyInviteCap] = useState(saved.dailyInviteCap || 20);
  // These two live on the job (hiringConfig), so the agent and the job settings never disagree
  const [minFitScore, setMinFitScore] = useState(70);
  const [maxShortlist, setMaxShortlist] = useState(20);

  const [jobs, setJobs] = useState([]);
  const [linkedinAccounts, setLinkedinAccounts] = useState([]);
  const [rozeeAccounts, setRozeeAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getJson("/api/hiring/jobs"), getJson("/api/linkedin/accounts"), getJson("/api/rozee/accounts")]).then(([j, l, r]) => {
      if (cancelled) return;
      setJobs((j.jobs || []).filter((job) => job.status !== "closed" || job.id === saved.jobId));
      setLinkedinAccounts(l.accounts || []);
      setRozeeAccounts(r.accounts || []);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the selected job's shortlist settings
  useEffect(() => {
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;
    setMinFitScore(job.hiringConfig?.minFitScore ?? 70);
    setMaxShortlist(job.hiringConfig?.maxShortlist ?? 20);
    setPreview(null);
  }, [jobId, jobs]);

  const runPreview = async () => {
    if (!jobId) return;
    setPreviewing(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ jobId, mode, dailyInviteCap: String(dailyInviteCap) });
      const res = await fetch(`/api/agents/preview?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Preview failed");
      setPreview(data.preview);
    } catch (err) {
      setError(err.message);
    } finally {
      setPreviewing(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !jobId) return;
    setSaving(true);
    setError(null);
    try {
      // Shortlist settings are the job's own; save them there
      const jobRes = await fetch(`/api/hiring/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hiringConfig: { minFitScore: Number(minFitScore), maxShortlist: maxShortlist === "" ? null : Number(maxShortlist) } }),
      });
      const jobData = await jobRes.json().catch(() => ({}));
      if (!jobRes.ok) throw new Error(jobData.error || (jobData.details || []).join(", ") || "Could not save the job shortlist settings");

      const res = await fetch(editConfig ? `/api/agents/configs/${editConfig.id}` : "/api/agents/configs", {
        method: editConfig ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          pipelineType: "recruiter",
          mode,
          config: {
            jobId,
            accountId: linkedinAccountId || null,
            rozeeAccountId: rozeeAccountId || null,
            postTone,
            dailyInviteCap: Number(dailyInviteCap) || 20,
          },
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Could not save the agent");
      onSaved(data.config);
      onClose();
    } catch (err) {
      setError(err.message || "Could not save the agent");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 overflow-y-auto py-8" role="dialog" aria-modal="true" aria-labelledby="hiring-agent-title">
      <div className="bg-base-100 rounded-2xl shadow-2xl w-full max-w-lg p-6 relative my-auto">
        <button type="button" onClick={onClose} className="absolute top-4 right-4 btn btn-ghost btn-sm btn-circle" aria-label="Close">
          <X size={18} />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-xl bg-primary/10"><Bot size={22} className="text-primary" /></div>
          <h2 id="hiring-agent-title" className="text-xl font-bold">{editConfig ? "Edit hiring agent" : "New hiring agent"}</h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="agent-name" className="text-sm font-medium mb-1 block">Name</label>
            <input id="agent-name" type="text" className="input input-bordered w-full" placeholder="e.g. Backend engineer hiring" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          <div className="space-y-4 p-4 bg-base-200/50 rounded-xl border border-base-300">
            <p className="text-xs font-semibold text-base-content/60 uppercase tracking-wider">The job</p>
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 size={18} className="animate-spin text-primary" />
                <span className="ml-2 text-sm text-base-content/50">Loading jobs and connected platforms...</span>
              </div>
            ) : (
              <>
                <div>
                  <label htmlFor="agent-job" className="text-sm font-medium mb-1 block">Job to work on</label>
                  <select id="agent-job" className="select select-bordered w-full" value={jobId} onChange={(e) => setJobId(e.target.value)} required>
                    <option value="">Select a job...</option>
                    {jobs.map((j) => <option key={j.id} value={j.id}>{j.title} ({j.status || "draft"})</option>)}
                  </select>
                  {jobs.length === 0 && <p className="text-xs text-warning mt-1">No jobs yet. Create one under Recruiter, Jobs first.</p>}
                </div>

                <div>
                  <label htmlFor="agent-tone" className="text-sm font-medium mb-1 block">Tone of the job posts</label>
                  <select id="agent-tone" className="select select-bordered w-full" value={postTone} onChange={(e) => setPostTone(e.target.value)}>
                    {TONES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="agent-min-fit" className="text-sm font-medium mb-1 block">Min fit score</label>
                    <input id="agent-min-fit" type="number" min={0} max={100} className="input input-bordered w-full" value={minFitScore} onChange={(e) => setMinFitScore(e.target.value)} />
                  </div>
                  <div>
                    <label htmlFor="agent-max-shortlist" className="text-sm font-medium mb-1 block">Max shortlist</label>
                    <input id="agent-max-shortlist" type="number" min={1} className="input input-bordered w-full" value={maxShortlist ?? ""} placeholder="No cap" onChange={(e) => setMaxShortlist(e.target.value)} />
                  </div>
                  <div>
                    <label htmlFor="agent-invite-cap" className="text-sm font-medium mb-1 block">Invites / day</label>
                    <input id="agent-invite-cap" type="number" min={1} max={200} className="input input-bordered w-full" value={dailyInviteCap} onChange={(e) => setDailyInviteCap(e.target.value)} />
                  </div>
                </div>
                <p className="text-xs text-base-content/50">Min fit score and max shortlist are saved on the job. The daily limit caps how many interview invites the agent sends on its own.</p>
              </>
            )}
          </div>

          <div className="space-y-4 p-4 bg-base-200/50 rounded-xl border border-base-300">
            <p className="text-xs font-semibold text-base-content/60 uppercase tracking-wider">Where it posts the job</p>
            <AccountSelect id="agent-linkedin" label="LinkedIn account" value={linkedinAccountId} onChange={setLinkedinAccountId} accounts={linkedinAccounts} empty="No LinkedIn account connected. Connect one under Platforms." />
            <AccountSelect id="agent-rozee" label="Rozee.pk account" value={rozeeAccountId} onChange={setRozeeAccountId} accounts={rozeeAccounts} empty="No Rozee.pk account connected. Connect one under Platforms." />
            <p className="text-xs text-base-content/50">
              Each platform gets its own post. Automatic posting is limited per account and stops at the first sign-in or security check, so you may be asked to post by hand.
              The job always goes live on Raasta-AI so candidates can apply.
            </p>
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">How much should the agent do on its own?</label>
            <div className="grid grid-cols-2 gap-3">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  className={`p-3 rounded-xl border-2 text-left transition-all ${mode === m.value ? "border-primary bg-primary/5" : "border-base-300"}`}
                  onClick={() => { setMode(m.value); setPreview(null); }}
                  aria-pressed={mode === m.value}
                >
                  <p className="text-sm font-semibold">{m.label}</p>
                  <p className="text-xs text-base-content/60 mt-1">{m.description}</p>
                </button>
              ))}
            </div>
            <p className="text-xs text-base-content/60 mt-2 flex gap-1.5"><ShieldCheck size={14} className="text-success shrink-0 mt-px" />{ALWAYS_ASKS}</p>

            <button type="button" className="btn btn-ghost btn-sm gap-1 mt-2" onClick={runPreview} disabled={!jobId || previewing}>
              {previewing ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} Preview what it would do now
            </button>
            {preview && (
              <div className="mt-2 p-3 rounded-xl bg-base-200 border border-base-300 text-xs space-y-1">
                <p className="font-semibold text-sm">If started now in {preview.mode === "autopilot" ? "Autopilot" : "Assisted"} mode:</p>
                <p>Job post: {preview.publish === "already_published" ? "already published" : preview.publish === "auto" ? "published automatically" : "waits for your approval"}</p>
                <p>Screening: {preview.screening.toQueue.length} to screen, {preview.screening.pending} in progress</p>
                <p>Shortlist: {preview.shortlist.auto} automatically, {preview.shortlist.ask} for your approval</p>
                <p>Not shortlisted: {preview.holdBack.ask} for your approval (never automatic)</p>
                <p>Invites: {preview.invites.auto} automatically, {preview.invites.ask} for your approval{preview.invites.deferred ? `, ${preview.invites.deferred} wait for the daily limit` : ""}</p>
                <p>Final decisions: {preview.finalDecisions.ask} for your approval</p>
                <details className="pt-1">
                  <summary className="cursor-pointer text-base-content/60">Full policy</summary>
                  <ul className="mt-1 space-y-0.5">
                    {Object.entries(preview.policy).map(([key, p]) => (
                      <li key={key}>{p.label}: <span className="font-semibold">{ROUTE_LABEL[p.route] || p.route}</span></li>
                    ))}
                  </ul>
                </details>
              </div>
            )}
          </div>

          {error && <div className="alert alert-error py-2 text-sm">{error}</div>}

          <button type="submit" className="btn btn-primary w-full" disabled={saving || !name.trim() || !jobId}>
            {saving ? <span className="loading loading-spinner loading-sm" /> : editConfig ? "Update agent" : "Create agent"}
          </button>
        </form>
      </div>
    </div>
  );
}
