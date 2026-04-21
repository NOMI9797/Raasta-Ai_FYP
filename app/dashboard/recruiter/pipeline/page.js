"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Loader2, LayoutGrid } from "lucide-react";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";

const STAGES = [
  { value: "new", label: "New", accent: "border-info" },
  { value: "reviewed", label: "Reviewed", accent: "border-warning" },
  { value: "shortlisted", label: "Shortlisted", accent: "border-success" },
  { value: "rejected", label: "Rejected", accent: "border-error" },
];

export default function PipelinePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [rows, setRows] = useState([]);
  const [jobsMap, setJobsMap] = useState({});
  const [jobFilter, setJobFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [draggedId, setDraggedId] = useState(null);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/");
      return;
    }
    const modes = Array.isArray(session.user?.modes) ? session.user.modes : [];
    const isAdmin = session.user?.role === "admin";
    if (!isAdmin && !modes.includes("recruiter")) {
      router.replace("/dashboard/home");
    }
  }, [session, status, router]);

  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/hiring/candidates");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setRows(data.candidates || []);
        const map = {};
        (data.jobs || []).forEach((j) => (map[j.id] = j));
        setJobsMap(map);
      } catch (err) {
        toast.error(err.message || "Failed to load pipeline");
      } finally {
        setLoading(false);
      }
    })();
  }, [session]);

  const filtered = useMemo(
    () => (jobFilter === "all" ? rows : rows.filter((c) => c.jobId === jobFilter)),
    [rows, jobFilter]
  );

  const byStage = useMemo(() => {
    const grouped = Object.fromEntries(STAGES.map((s) => [s.value, []]));
    for (const c of filtered) {
      const key = STAGES.find((s) => s.value === c.status)?.value ?? "new";
      grouped[key].push(c);
    }
    return grouped;
  }, [filtered]);

  const moveCandidate = async (candidateId, newStatus) => {
    const prev = rows.find((r) => r.id === candidateId);
    if (!prev || prev.status === newStatus) return;
    setRows((rs) => rs.map((r) => (r.id === candidateId ? { ...r, status: newStatus } : r)));
    try {
      const res = await fetch(`/api/hiring/candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Failed to move candidate");
      setRows((rs) => rs.map((r) => (r.id === candidateId ? { ...r, status: prev.status } : r)));
    }
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center">
        <div className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }
  if (!session) return null;

  return (
    <div className="h-screen bg-base-100 flex overflow-hidden">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        activeSection="recruiter-pipeline"
      />
      <div
        className={`flex-1 transition-all duration-300 ${
          sidebarCollapsed ? "ml-16" : "ml-64"
        } flex flex-col h-full overflow-hidden`}
      >
        <TopBar title="Pipeline" />
        <main className="flex-1 p-6 flex flex-col gap-4 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <LayoutGrid className="h-6 w-6" /> Hiring Pipeline
              </h1>
              <p className="text-sm text-base-content/70 mt-1">
                Drag candidates between stages to update their status.
              </p>
            </div>
            <select
              className="select select-bordered select-sm"
              value={jobFilter}
              onChange={(e) => setJobFilter(e.target.value)}
            >
              <option value="all">All jobs</option>
              {Object.values(jobsMap).map((j) => (
                <option key={j.id} value={j.id}>{j.title}</option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 overflow-hidden">
              {STAGES.map((stage) => (
                <div
                  key={stage.value}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (draggedId) {
                      moveCandidate(draggedId, stage.value);
                      setDraggedId(null);
                    }
                  }}
                  className={`card bg-base-200 border-t-4 ${stage.accent} border-base-300 flex flex-col min-h-0`}
                >
                  <div className="p-3 border-b border-base-300 flex items-center justify-between">
                    <h3 className="font-semibold text-sm">{stage.label}</h3>
                    <span className="badge badge-ghost badge-sm">{byStage[stage.value].length}</span>
                  </div>
                  <div className="p-2 space-y-2 flex-1 overflow-y-auto">
                    {byStage[stage.value].length === 0 ? (
                      <p className="text-xs text-base-content/40 text-center py-4">
                        No candidates here
                      </p>
                    ) : (
                      byStage[stage.value].map((c) => {
                        const job = jobsMap[c.jobId];
                        return (
                          <div
                            key={c.id}
                            draggable
                            onDragStart={() => setDraggedId(c.id)}
                            onDragEnd={() => setDraggedId(null)}
                            className="bg-base-100 rounded-lg border border-base-300 p-3 cursor-move hover:border-primary transition-colors"
                          >
                            <div className="font-medium text-sm truncate">{c.name}</div>
                            <div className="text-xs text-base-content/60 truncate">{c.email}</div>
                            <div className="flex items-center gap-1 mt-2">
                              <span className="badge badge-outline badge-xs capitalize">
                                {c.source ?? "linkedin"}
                              </span>
                              {job && (
                                <span className="text-[10px] text-base-content/60 truncate">
                                  • {job.title}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
