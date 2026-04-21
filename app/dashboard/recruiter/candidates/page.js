"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  Users,
  Search,
  Loader2,
  ExternalLink,
  Star,
  XCircle,
  Eye,
} from "lucide-react";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";

const STATUS_OPTIONS = [
  { value: "new", label: "New", color: "badge-info" },
  { value: "reviewed", label: "Reviewed", color: "badge-warning" },
  { value: "shortlisted", label: "Shortlisted", color: "badge-success" },
  { value: "rejected", label: "Rejected", color: "badge-error" },
];

function statusBadge(status) {
  return STATUS_OPTIONS.find((o) => o.value === status) || STATUS_OPTIONS[0];
}

export default function UnifiedCandidatesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [jobsMap, setJobsMap] = useState({});
  const [jobFilter, setJobFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [updatingId, setUpdatingId] = useState(null);

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
        if (!res.ok) throw new Error(data.error || "Failed to load candidates");
        setRows(data.candidates || []);
        const map = {};
        (data.jobs || []).forEach((j) => (map[j.id] = j));
        setJobsMap(map);
      } catch (err) {
        toast.error(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [session]);

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
      setRows((prev) => prev.map((c) => (c.id === candidateId ? { ...c, status: newStatus } : c)));
      toast.success("Status updated");
    } catch (err) {
      toast.error(err.message || "Failed to update");
    } finally {
      setUpdatingId(null);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((c) => {
      if (jobFilter !== "all" && c.jobId !== jobFilter) return false;
      if (sourceFilter !== "all" && (c.source ?? "linkedin") !== sourceFilter) return false;
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (!q) return true;
      return (
        c.name?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q)
      );
    });
  }, [rows, jobFilter, sourceFilter, statusFilter, search]);

  const counts = useMemo(() => ({
    total: rows.length,
    shortlisted: rows.filter((c) => c.status === "shortlisted").length,
    new: rows.filter((c) => c.status === "new").length,
    rejected: rows.filter((c) => c.status === "rejected").length,
  }), [rows]);

  const uniqueSources = useMemo(
    () => Array.from(new Set(rows.map((c) => c.source ?? "linkedin"))),
    [rows]
  );

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center">
        <div className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }
  if (!session) return null;

  return (
    <div className="min-h-screen bg-base-100 flex">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        activeSection="recruiter-candidates"
      />
      <div className={`flex-1 transition-all duration-300 ${sidebarCollapsed ? "ml-16" : "ml-64"} flex flex-col`}>
        <TopBar title="Candidates" />
        <main className="flex-1 p-6 space-y-6 overflow-auto">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
            <div>
              <h1 className="text-2xl font-bold">Candidates</h1>
              <p className="text-sm text-base-content/70 mt-1">
                Unified view across LinkedIn, Rozee.pk, and direct apply.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatTile icon={<Users className="h-5 w-5 text-primary" />} label="Total" val={counts.total} />
            <StatTile icon={<Eye className="h-5 w-5 text-info" />} label="New" val={counts.new} />
            <StatTile icon={<Star className="h-5 w-5 text-success" />} label="Shortlisted" val={counts.shortlisted} />
            <StatTile icon={<XCircle className="h-5 w-5 text-error" />} label="Rejected" val={counts.rejected} />
          </div>

          <div className="flex flex-col md:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-base-content/40" />
              <input
                className="input input-bordered w-full pl-9"
                placeholder="Search by name or email"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              className="select select-bordered"
              value={jobFilter}
              onChange={(e) => setJobFilter(e.target.value)}
            >
              <option value="all">All jobs</option>
              {Object.values(jobsMap).map((j) => (
                <option key={j.id} value={j.id}>{j.title}</option>
              ))}
            </select>
            <select
              className="select select-bordered"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
            >
              <option value="all">All sources</option>
              {uniqueSources.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
              <option value="indeed" disabled>Indeed (Coming soon)</option>
            </select>
            <select
              className="select select-bordered"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All statuses</option>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20 text-base-content/60">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-40" />
              <p>No candidates match your filters.</p>
            </div>
          ) : (
            <div className="card bg-base-200 border border-base-300 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Candidate</th>
                      <th>Job</th>
                      <th>Source</th>
                      <th>Status</th>
                      <th>Applied</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((c) => {
                      const badge = statusBadge(c.status);
                      const job = jobsMap[c.jobId];
                      const source = c.source ?? "linkedin";
                      return (
                        <tr key={c.id} className="hover">
                          <td>
                            <div className="font-medium">{c.name}</div>
                            <div className="text-xs text-base-content/60">{c.email}</div>
                          </td>
                          <td className="text-sm">{job?.title ?? "—"}</td>
                          <td>
                            <span className="badge badge-outline badge-sm capitalize">{source}</span>
                          </td>
                          <td>
                            <select
                              className="select select-bordered select-xs w-32"
                              value={c.status}
                              onChange={(e) => handleStatusChange(c.id, e.target.value)}
                              disabled={updatingId === c.id}
                            >
                              {STATUS_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                            <span className={`ml-2 badge badge-xs ${badge.color}`}>{badge.label}</span>
                          </td>
                          <td className="text-xs text-base-content/60">
                            {c.appliedAt ? new Date(c.appliedAt).toLocaleDateString() : "—"}
                          </td>
                          <td>
                            {c.jobId && (
                              <button
                                className="btn btn-ghost btn-xs gap-1"
                                onClick={() =>
                                  router.push(`/dashboard/recruiter/jobs/${c.jobId}/candidates`)
                                }
                              >
                                <ExternalLink className="h-3 w-3" /> Open
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function StatTile({ icon, label, val }) {
  return (
    <div className="bg-base-200 rounded-lg p-3 text-center border border-base-300">
      <div className="flex justify-center mb-1">{icon}</div>
      <p className="text-lg font-bold">{val}</p>
      <p className="text-xs text-base-content/60">{label}</p>
    </div>
  );
}
