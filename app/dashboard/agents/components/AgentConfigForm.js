"use client";

import { useState, useEffect } from "react";
import { X, Bot, Briefcase, Users, Loader2 } from "lucide-react";

const PIPELINE_OPTIONS = [
  { value: "recruiter", label: "Recruiter", icon: Users, description: "Job posting, candidate screening & shortlisting" },
  { value: "sales_operator", label: "Sales Operator", icon: Briefcase, description: "Campaign outreach, invites & messaging" },
];

export default function AgentConfigForm({ onClose, onCreated, editConfig }) {
  const [name, setName] = useState(editConfig?.name || "");
  const [pipelineType, setPipelineType] = useState(editConfig?.pipelineType || "");
  const [mode, setMode] = useState(editConfig?.mode || "semi_auto");
  const [saving, setSaving] = useState(false);

  // Sales-operator specific config
  const [campaignId, setCampaignId] = useState(editConfig?.config?.campaignId || "");
  const [accountId, setAccountId] = useState(editConfig?.config?.accountId || "");
  const [dailyInviteLimit, setDailyInviteLimit] = useState(editConfig?.config?.dailyInviteLimit || 10);
  const [waitMinutes, setWaitMinutes] = useState(editConfig?.config?.waitMinutes || 30);

  // Data for dropdowns
  const [campaignsList, setCampaignsList] = useState([]);
  const [accountsList, setAccountsList] = useState([]);
  const [loadingData, setLoadingData] = useState(false);

  useEffect(() => {
    if (pipelineType === "sales_operator") {
      setLoadingData(true);
      Promise.all([
        fetch("/api/campaigns").then((r) => r.json()),
        fetch("/api/linkedin/accounts").then((r) => r.json()),
      ])
        .then(([campData, accData]) => {
          if (campData.campaigns) setCampaignsList(campData.campaigns);
          else if (Array.isArray(campData)) setCampaignsList(campData);
          if (accData.accounts) setAccountsList(accData.accounts);
          else if (Array.isArray(accData)) setAccountsList(accData);
        })
        .catch((err) => console.error("Failed to load dropdown data:", err))
        .finally(() => setLoadingData(false));
    }
  }, [pipelineType]);

  const buildConfig = () => {
    if (pipelineType === "sales_operator") {
      return {
        campaignId,
        accountId,
        dailyInviteLimit: Number(dailyInviteLimit) || 10,
        waitMinutes: Number(waitMinutes) || 30,
      };
    }
    return {};
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !pipelineType) return;
    if (pipelineType === "sales_operator" && (!campaignId || !accountId)) return;
    setSaving(true);

    try {
      const url = editConfig
        ? `/api/agents/configs/${editConfig.id}`
        : "/api/agents/configs";
      const method = editConfig ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          pipelineType,
          mode,
          config: buildConfig(),
        }),
      });

      const data = await res.json();
      if (data.success) {
        onCreated(data.config);
        onClose();
      }
    } catch (err) {
      console.error("Save config error:", err);
    } finally {
      setSaving(false);
    }
  };

  const isSalesOp = pipelineType === "sales_operator";
  const canSubmit =
    name.trim() &&
    pipelineType &&
    (!isSalesOp || (campaignId && accountId));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 overflow-y-auto py-8">
      <div className="bg-base-100 rounded-2xl shadow-2xl w-full max-w-lg p-6 relative my-auto">
        <button onClick={onClose} className="absolute top-4 right-4 btn btn-ghost btn-sm btn-circle">
          <X size={18} />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-xl bg-primary/10">
            <Bot size={22} className="text-primary" />
          </div>
          <h2 className="text-xl font-bold">{editConfig ? "Edit Agent" : "New Agent Config"}</h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="text-sm font-medium mb-1 block">Name</label>
            <input
              type="text"
              className="input input-bordered w-full"
              placeholder="e.g. My Sales Agent"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          {!editConfig && (
            <div>
              <label className="text-sm font-medium mb-2 block">Pipeline Type</label>
              <div className="grid grid-cols-2 gap-3">
                {PIPELINE_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      className={`p-4 rounded-xl border-2 text-left transition-all ${
                        pipelineType === opt.value
                          ? "border-primary bg-primary/5"
                          : "border-base-300 hover:border-primary/40"
                      }`}
                      onClick={() => setPipelineType(opt.value)}
                    >
                      <Icon size={20} className={pipelineType === opt.value ? "text-primary" : "text-base-content/50"} />
                      <p className="font-semibold mt-2">{opt.label}</p>
                      <p className="text-xs text-base-content/60 mt-1">{opt.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Sales Operator specific fields */}
          {isSalesOp && (
            <div className="space-y-4 p-4 bg-base-200/50 rounded-xl border border-base-300">
              <p className="text-xs font-semibold text-base-content/60 uppercase tracking-wider">Pipeline Settings</p>

              {loadingData ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 size={18} className="animate-spin text-primary" />
                  <span className="ml-2 text-sm text-base-content/50">Loading campaigns & accounts...</span>
                </div>
              ) : (
                <>
                  {/* Campaign picker */}
                  <div>
                    <label className="text-sm font-medium mb-1 block">Campaign</label>
                    <select
                      className="select select-bordered w-full"
                      value={campaignId}
                      onChange={(e) => setCampaignId(e.target.value)}
                      required
                    >
                      <option value="">Select a campaign...</option>
                      {campaignsList.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.status || "draft"})
                        </option>
                      ))}
                    </select>
                    {campaignsList.length === 0 && (
                      <p className="text-xs text-warning mt-1">No campaigns found. Create one first.</p>
                    )}
                  </div>

                  {/* LinkedIn account picker */}
                  <div>
                    <label className="text-sm font-medium mb-1 block">LinkedIn Account</label>
                    <select
                      className="select select-bordered w-full"
                      value={accountId}
                      onChange={(e) => setAccountId(e.target.value)}
                      required
                    >
                      <option value="">Select an account...</option>
                      {accountsList.map((a) => (
                        <option key={a.dbId || a.id} value={a.dbId || a.id}>
                          {a.name || a.email} {a.isActive ? "" : "(inactive)"}
                        </option>
                      ))}
                    </select>
                    {accountsList.length === 0 && (
                      <p className="text-xs text-warning mt-1">No LinkedIn accounts connected.</p>
                    )}
                  </div>

                  {/* Daily invite limit */}
                  <div>
                    <label className="text-sm font-medium mb-1 block">
                      Daily Invite Limit <span className="text-base-content/40 font-normal">(10–30)</span>
                    </label>
                    <input
                      type="number"
                      className="input input-bordered w-full"
                      min={1}
                      max={30}
                      value={dailyInviteLimit}
                      onChange={(e) => setDailyInviteLimit(e.target.value)}
                    />
                  </div>

                  {/* Wait time */}
                  <div>
                    <label className="text-sm font-medium mb-1 block">
                      Wait Before Checking Connections <span className="text-base-content/40 font-normal">(minutes)</span>
                    </label>
                    <input
                      type="number"
                      className="input input-bordered w-full"
                      min={5}
                      max={120}
                      value={waitMinutes}
                      onChange={(e) => setWaitMinutes(e.target.value)}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          <div>
            <label className="text-sm font-medium mb-2 block">Autonomy Mode</label>
            <div className="flex gap-3">
              <button
                type="button"
                className={`flex-1 py-3 px-4 rounded-xl border-2 text-center transition-all ${
                  mode === "semi_auto" ? "border-primary bg-primary/5 font-semibold" : "border-base-300"
                }`}
                onClick={() => setMode("semi_auto")}
              >
                <p className="text-sm">Semi-Auto</p>
                <p className="text-xs text-base-content/50 mt-1">Pauses for your approval</p>
              </button>
              <button
                type="button"
                className={`flex-1 py-3 px-4 rounded-xl border-2 text-center transition-all ${
                  mode === "full_auto" ? "border-primary bg-primary/5 font-semibold" : "border-base-300"
                }`}
                onClick={() => setMode("full_auto")}
              >
                <p className="text-sm">Full-Auto</p>
                <p className="text-xs text-base-content/50 mt-1">Runs end-to-end autonomously</p>
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary w-full"
            disabled={saving || !canSubmit}
          >
            {saving ? <span className="loading loading-spinner loading-sm" /> : editConfig ? "Update" : "Create Agent"}
          </button>
        </form>
      </div>
    </div>
  );
}
