"use client";

import { useState } from "react";
import { X, Bot, Briefcase, Users } from "lucide-react";

const PIPELINE_OPTIONS = [
  { value: "recruiter", label: "Recruiter", icon: Users, description: "Job posting, candidate screening & shortlisting" },
  { value: "sales_operator", label: "Sales Operator", icon: Briefcase, description: "Campaign creation, lead outreach & messaging" },
];

export default function AgentConfigForm({ onClose, onCreated, editConfig }) {
  const [name, setName] = useState(editConfig?.name || "");
  const [pipelineType, setPipelineType] = useState(editConfig?.pipelineType || "");
  const [mode, setMode] = useState(editConfig?.mode || "semi_auto");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !pipelineType) return;
    setSaving(true);

    try {
      const url = editConfig
        ? `/api/agents/configs/${editConfig.id}`
        : "/api/agents/configs";
      const method = editConfig ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, pipelineType, mode, config: {} }),
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-base-100 rounded-2xl shadow-2xl w-full max-w-lg p-6 relative">
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
              placeholder="e.g. My Recruiter Agent"
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
            disabled={saving || !name.trim() || !pipelineType}
          >
            {saving ? <span className="loading loading-spinner loading-sm" /> : editConfig ? "Update" : "Create Agent"}
          </button>
        </form>
      </div>
    </div>
  );
}
