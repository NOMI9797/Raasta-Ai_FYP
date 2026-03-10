"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import AgentConfigForm from "./components/AgentConfigForm";
import AgentRunCard from "./components/AgentRunCard";
import toast from "react-hot-toast";
import {
  Bot,
  Plus,
  Play,
  Settings2,
  Trash2,
  Loader2,
  Zap,
  Users,
  Briefcase,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";

export default function AgentsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);

  const [configs, setConfigs] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editConfig, setEditConfig] = useState(null);
  const [launchingId, setLaunchingId] = useState(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/signin");
  }, [status, router]);

  const fetchData = useCallback(async () => {
    try {
      const [cfgRes, runRes] = await Promise.all([
        fetch("/api/agents/configs"),
        fetch("/api/agents/runs"),
      ]);
      const cfgData = await cfgRes.json();
      const runData = await runRes.json();
      if (cfgData.success) setConfigs(cfgData.configs);
      if (runData.success) setRuns(runData.runs);
    } catch (err) {
      console.error("Fetch agents data error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") fetchData();
  }, [status, fetchData]);

  const handleLaunch = async (config) => {
    setLaunchingId(config.id);
    try {
      const res = await fetch("/api/agents/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentConfigId: config.id }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Agent launched!");
        setRuns((prev) => [data.run, ...prev]);
      } else {
        toast.error(data.error || "Failed to launch");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setLaunchingId(null);
    }
  };

  const handleDeleteConfig = async (configId) => {
    if (!confirm("Delete this agent config?")) return;
    try {
      const res = await fetch(`/api/agents/configs/${configId}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        toast.success("Config deleted");
        setConfigs((prev) => prev.filter((c) => c.id !== configId));
      }
    } catch {
      toast.error("Network error");
    }
  };

  const handleToggleActive = async (config) => {
    try {
      const res = await fetch(`/api/agents/configs/${config.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !config.isActive }),
      });
      const data = await res.json();
      if (data.success) {
        setConfigs((prev) =>
          prev.map((c) => (c.id === config.id ? data.config : c))
        );
      }
    } catch {
      toast.error("Network error");
    }
  };

  const activeRuns = runs.filter((r) =>
    ["queued", "running", "paused_at_checkpoint"].includes(r.status)
  );
  const pastRuns = runs.filter((r) =>
    ["completed", "failed", "cancelled"].includes(r.status)
  );

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-base-200">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base-200 flex">
      <Sidebar collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} />
      <div className="flex-1 flex flex-col">
        <TopBar collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} />
        <main className="flex-1 p-4 md:p-6 max-w-6xl mx-auto w-full">
          {/* Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20">
                <Bot size={24} className="text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">AI Agents</h1>
                <p className="text-sm text-base-content/50">
                  Configure and run autonomous pipelines for recruiting & sales
                </p>
              </div>
            </div>
            <button className="btn btn-primary btn-sm gap-2" onClick={() => { setEditConfig(null); setShowForm(true); }}>
              <Plus size={16} /> New Agent
            </button>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div className="bg-base-100 rounded-xl border border-base-300 p-4">
              <p className="text-xs text-base-content/50 uppercase tracking-wide">Configs</p>
              <p className="text-2xl font-bold mt-1">{configs.length}</p>
            </div>
            <div className="bg-base-100 rounded-xl border border-base-300 p-4">
              <p className="text-xs text-base-content/50 uppercase tracking-wide">Active Runs</p>
              <p className="text-2xl font-bold mt-1 text-info">{activeRuns.length}</p>
            </div>
            <div className="bg-base-100 rounded-xl border border-base-300 p-4">
              <p className="text-xs text-base-content/50 uppercase tracking-wide">Completed</p>
              <p className="text-2xl font-bold mt-1 text-success">
                {runs.filter((r) => r.status === "completed").length}
              </p>
            </div>
            <div className="bg-base-100 rounded-xl border border-base-300 p-4">
              <p className="text-xs text-base-content/50 uppercase tracking-wide">Failed</p>
              <p className="text-2xl font-bold mt-1 text-error">
                {runs.filter((r) => r.status === "failed").length}
              </p>
            </div>
          </div>

          {/* Agent Configs */}
          <section className="mb-8">
            <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
              <Settings2 size={18} /> Agent Configurations
            </h2>
            {configs.length === 0 ? (
              <div className="bg-base-100 border border-dashed border-base-300 rounded-xl p-8 text-center">
                <Bot size={32} className="mx-auto text-base-content/20 mb-2" />
                <p className="text-base-content/50 text-sm">No agent configs yet. Create one to get started.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {configs.map((cfg) => {
                  const isRecruiter = cfg.pipelineType === "recruiter";
                  return (
                    <div
                      key={cfg.id}
                      className={`bg-base-100 border rounded-xl p-4 ${
                        cfg.isActive ? "border-base-300" : "border-base-300 opacity-60"
                      }`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          {isRecruiter ? (
                            <Users size={16} className="text-secondary" />
                          ) : (
                            <Briefcase size={16} className="text-accent" />
                          )}
                          <span className="font-semibold text-sm">{cfg.name}</span>
                        </div>
                        <button
                          onClick={() => handleToggleActive(cfg)}
                          className="text-base-content/40 hover:text-primary"
                        >
                          {cfg.isActive ? <ToggleRight size={20} className="text-success" /> : <ToggleLeft size={20} />}
                        </button>
                      </div>

                      <div className="flex gap-2 mb-3">
                        <span className="badge badge-sm badge-outline">{isRecruiter ? "Recruiter" : "Sales"}</span>
                        <span className="badge badge-sm badge-outline">
                          {cfg.mode === "full_auto" ? "Full-Auto" : "Semi-Auto"}
                        </span>
                      </div>

                      <div className="flex gap-2">
                        <button
                          className="btn btn-primary btn-xs flex-1 gap-1"
                          onClick={() => handleLaunch(cfg)}
                          disabled={launchingId === cfg.id || !cfg.isActive}
                        >
                          {launchingId === cfg.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Play size={12} />
                          )}
                          Launch
                        </button>
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={() => { setEditConfig(cfg); setShowForm(true); }}
                        >
                          <Settings2 size={12} />
                        </button>
                        <button
                          className="btn btn-ghost btn-xs text-error"
                          onClick={() => handleDeleteConfig(cfg.id)}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Active Runs */}
          {activeRuns.length > 0 && (
            <section className="mb-8">
              <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                <Zap size={18} className="text-info" /> Active Runs
              </h2>
              <div className="space-y-2">
                {activeRuns.map((run) => (
                  <AgentRunCard key={run.id} run={run} onRefresh={fetchData} />
                ))}
              </div>
            </section>
          )}

          {/* Run History */}
          <section>
            <h2 className="text-lg font-bold mb-3">Run History</h2>
            {pastRuns.length === 0 ? (
              <p className="text-sm text-base-content/40">No completed runs yet.</p>
            ) : (
              <div className="space-y-2">
                {pastRuns.map((run) => (
                  <AgentRunCard key={run.id} run={run} onRefresh={fetchData} />
                ))}
              </div>
            )}
          </section>
        </main>
      </div>

      {showForm && (
        <AgentConfigForm
          onClose={() => { setShowForm(false); setEditConfig(null); }}
          onCreated={(cfg) => {
            if (editConfig) {
              setConfigs((prev) => prev.map((c) => (c.id === cfg.id ? cfg : c)));
            } else {
              setConfigs((prev) => [cfg, ...prev]);
            }
          }}
          editConfig={editConfig}
        />
      )}
    </div>
  );
}
