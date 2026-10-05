"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Bot, Loader2, Play, Plus, Settings2, ToggleLeft, ToggleRight, Trash2, Zap } from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";
import { useDialog } from "@/components/ui/DialogProvider";
import GuidanceStrip from "@/components/system/GuidanceStrip";
import { useServiceGuard } from "@/components/system/useServiceGuard";
import AgentRunCard from "@/app/dashboard/agents/components/AgentRunCard";
import HiringAgentForm from "./components/HiringAgentForm";

const MODE_LABELS = { assisted: "Assisted", autopilot: "Autopilot" };
const ACTIVE_RUN = ["queued", "running", "waiting", "paused_at_checkpoint", "paused"];
const PAST_RUN = ["completed", "failed", "cancelled"];

// The hiring agent works one job from the post to the final shortlist. It is separate from the sales agent.
export default function HiringAgentPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { confirm } = useDialog();
  const { ensure } = useServiceGuard();

  const [configs, setConfigs] = useState([]);
  const [runs, setRuns] = useState([]);
  const [jobTitles, setJobTitles] = useState({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editConfig, setEditConfig] = useState(null);
  const [launchingId, setLaunchingId] = useState(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/signin");
    if (status !== "authenticated") return;
    const modes = Array.isArray(session.user?.modes) ? session.user.modes : [];
    if (session.user?.role !== "admin" && !modes.includes("recruiter")) router.replace("/dashboard/home");
  }, [session, status, router]);

  const load = useCallback(async () => {
    try {
      const [cfgRes, runRes, jobRes] = await Promise.all([
        fetch("/api/agents/configs?pipeline=recruiter"),
        fetch("/api/agents/runs?pipeline=recruiter"),
        fetch("/api/hiring/jobs"),
      ]);
      const [cfg, run, job] = await Promise.all([cfgRes.json(), runRes.json(), jobRes.json()]);
      if (cfg.success) setConfigs(cfg.configs);
      if (run.success) setRuns(run.runs);
      if (job.success) setJobTitles(Object.fromEntries(job.jobs.map((j) => [j.id, j.title])));
    } catch (error) {
      console.error("Load hiring agent data:", error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") load();
  }, [status, load]);

  // A run changes by itself (queued, working, waiting for you): keep the cards current without a refresh
  const hasActiveRun = runs.some((r) => ACTIVE_RUN.includes(r.status));
  useEffect(() => {
    if (!hasActiveRun) return undefined;
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [hasActiveRun, load]);

  const launch = async (config) => {
    // The agent runs inside the hiring worker: offer to start it rather than let the run sit idle
    if (!(await ensure("agent"))) return;
    setLaunchingId(config.id);
    try {
      const res = await fetch("/api/agents/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentConfigId: config.id }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Could not start the agent");
      toast.success("Agent started. It tells you here and in Decisions when it needs you.");
      setRuns((prev) => [data.run, ...prev]);
      load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLaunchingId(null);
    }
  };

  const remove = async (config) => {
    const ok = await confirm({
      title: "Delete this agent?",
      message: "Its saved settings are removed. Runs that already happened stay in the history.",
      confirmText: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/agents/configs/${config.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Could not delete the agent");
      setConfigs((prev) => prev.filter((c) => c.id !== config.id));
      toast.success("Agent deleted");
    } catch (error) {
      toast.error(error.message);
    }
  };

  const toggle = async (config) => {
    try {
      const res = await fetch(`/api/agents/configs/${config.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !config.isActive }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Could not update the agent");
      setConfigs((prev) => prev.map((c) => (c.id === config.id ? data.config : c)));
    } catch (error) {
      toast.error(error.message);
    }
  };

  const activeRuns = runs.filter((r) => ACTIVE_RUN.includes(r.status));
  const pastRuns = runs.filter((r) => PAST_RUN.includes(r.status));

  if (status === "loading" || loading) {
    return (
      <DashboardShell title="Hiring agent" activeSection="recruiter-agent">
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-primary" size={28} /></div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell title="Hiring agent" activeSection="recruiter-agent">
      <div className="p-6 space-y-6 max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Hiring agent</h1>
            <p className="text-sm text-base-content/70 mt-1 max-w-2xl">
              Works one job from the post to the final shortlist: writes a post for each platform, publishes it, screens applicants, shortlists, sends interview invites and prepares the final list.
              It asks you before anything that affects a candidate.
            </p>
          </div>
          <button type="button" className="btn btn-primary btn-sm gap-2" onClick={() => { setEditConfig(null); setShowForm(true); }}>
            <Plus size={16} /> New hiring agent
          </button>
        </div>

        <GuidanceStrip feature="agent" />

        <section aria-label="Agents">
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2"><Settings2 size={16} className="text-base-content/60" /> Your agents</h2>
          {configs.length === 0 ? (
            <div className="bg-base-200 border border-dashed border-base-300 rounded-xl p-10 text-center">
              <Bot size={28} className="mx-auto text-base-content/20 mb-2" />
              <p className="text-base-content/60 text-sm">No hiring agent yet. Create one for a job to get started.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {configs.map((cfg) => (
                <div key={cfg.id} className={`bg-base-200 border border-base-300 rounded-xl p-4 shadow-sm ${cfg.isActive ? "" : "opacity-60"}`}>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="font-semibold text-sm">{cfg.name}</span>
                    <button type="button" onClick={() => toggle(cfg)} className="text-base-content/40 hover:text-primary" aria-label={cfg.isActive ? "Switch off" : "Switch on"}>
                      {cfg.isActive ? <ToggleRight size={20} className="text-success" /> : <ToggleLeft size={20} />}
                    </button>
                  </div>
                  <p className="text-xs text-base-content/60 mb-3 truncate">{jobTitles[cfg.config?.jobId] || "Job removed"}</p>
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    <span className="badge badge-xs badge-outline">{MODE_LABELS[cfg.mode] || cfg.mode}</span>
                    <span className={`badge badge-xs ${cfg.config?.accountId ? "badge-success" : "badge-ghost"}`}>LinkedIn</span>
                    <span className={`badge badge-xs ${cfg.config?.rozeeAccountId ? "badge-success" : "badge-ghost"}`}>Rozee.pk</span>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className="btn btn-primary btn-xs flex-1 gap-1" onClick={() => launch(cfg)} disabled={launchingId === cfg.id || !cfg.isActive}>
                      {launchingId === cfg.id ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />} Start
                    </button>
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => { setEditConfig(cfg); setShowForm(true); }} aria-label="Edit agent">
                      <Settings2 size={12} />
                    </button>
                    <button type="button" className="btn btn-ghost btn-xs text-error hover:bg-error/10" onClick={() => remove(cfg)} aria-label="Delete agent">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {activeRuns.length > 0 && (
          <section aria-label="Active runs">
            <h2 className="text-base font-semibold mb-3 flex items-center gap-2"><Zap size={16} className="text-info" /> Working now</h2>
            <div className="space-y-2">{activeRuns.map((run) => <AgentRunCard key={run.id} run={run} onRefresh={load} />)}</div>
          </section>
        )}

        <section aria-label="History">
          <h2 className="text-base font-semibold mb-3">History</h2>
          {pastRuns.length === 0 ? (
            <p className="text-sm text-base-content/50">Nothing has finished yet.</p>
          ) : (
            <div className="space-y-2">{pastRuns.map((run) => <AgentRunCard key={run.id} run={run} onRefresh={load} />)}</div>
          )}
        </section>
      </div>

      {showForm && (
        <HiringAgentForm
          editConfig={editConfig}
          onClose={() => { setShowForm(false); setEditConfig(null); }}
          onSaved={(cfg) => setConfigs((prev) => (editConfig ? prev.map((c) => (c.id === cfg.id ? cfg : c)) : [cfg, ...prev]))}
        />
      )}
    </DashboardShell>
  );
}
