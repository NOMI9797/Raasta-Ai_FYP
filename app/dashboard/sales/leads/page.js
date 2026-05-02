"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  UserCheck,
  Search,
  Loader2,
  ExternalLink,
  Send,
  CheckCircle2,
  Clock,
  XCircle,
  Sparkles,
  MessageSquare,
} from "lucide-react";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";

export default function LeadsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [busyId, setBusyId] = useState(null);

  const reloadLeads = useCallback(async () => {
    const res = await fetch("/api/leads");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load leads");
    setRows(data.leads || []);
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/");
      return;
    }
    const modes = Array.isArray(session.user?.modes) ? session.user.modes : [];
    const isAdmin = session.user?.role === "admin";
    if (!isAdmin && !modes.includes("sales")) {
      router.replace("/dashboard/home");
    }
  }, [session, status, router]);

  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        setLoading(true);
        await reloadLeads();
      } catch (err) {
        toast.error(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [session, reloadLeads]);

  const campaigns = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      if (r.campaignId) map.set(r.campaignId, r.campaignName ?? r.campaignId);
    }
    return Array.from(map.entries());
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (sourceFilter !== "all" && (r.source ?? "linkedin") !== sourceFilter) return false;
      if (statusFilter !== "all") {
        if (statusFilter === "sent" && !r.inviteSent) return false;
        if (statusFilter === "not_sent" && r.inviteSent) return false;
        if (statusFilter === "accepted" && r.inviteStatus !== "accepted") return false;
        if (statusFilter === "failed" && r.inviteStatus !== "failed") return false;
      }
      if (campaignFilter !== "all" && r.campaignId !== campaignFilter) return false;
      if (!q) return true;
      return (
        r.name?.toLowerCase().includes(q) ||
        r.title?.toLowerCase().includes(q) ||
        r.company?.toLowerCase().includes(q)
      );
    });
  }, [rows, sourceFilter, statusFilter, campaignFilter, search]);

  const counts = useMemo(() => ({
    total: rows.length,
    sent: rows.filter((r) => r.inviteSent).length,
    accepted: rows.filter((r) => r.inviteStatus === "accepted").length,
    failed: rows.filter((r) => r.inviteStatus === "failed").length,
  }), [rows]);

  const sources = useMemo(
    () => Array.from(new Set(rows.map((r) => r.source ?? "linkedin"))),
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

  const handleEnrich = async (leadId) => {
    try {
      setBusyId(leadId);
      const res = await fetch(`/api/leads/${leadId}/enrich`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Enrich failed");
      toast.success("Job details saved — tier updated");
      await reloadLeads();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleDraftRozee = async (leadId) => {
    try {
      setBusyId(leadId);
      const res = await fetch("/api/messages/generate-rozee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, autoEnrich: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Draft failed");
      toast.success(
        data.suggestedChannel === "email"
          ? "Draft email saved — check Outreach"
          : "Draft message saved — check Outreach"
      );
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-screen bg-base-100 flex">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        activeSection="sales-leads"
      />
      <div className={`flex-1 transition-all duration-300 ${sidebarCollapsed ? "ml-16" : "ml-64"} flex flex-col`}>
        <TopBar title="Leads" />
        <main className="flex-1 p-6 space-y-6 overflow-auto">
          <div>
            <h1 className="text-2xl font-bold">Leads</h1>
            <p className="text-sm text-base-content/70 mt-1">
              Unified view across LinkedIn and Rozee.pk campaigns.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatTile icon={<UserCheck className="h-5 w-5 text-primary" />} label="Total leads" val={counts.total} />
            <StatTile icon={<Send className="h-5 w-5 text-info" />} label="Invites sent" val={counts.sent} />
            <StatTile icon={<CheckCircle2 className="h-5 w-5 text-success" />} label="Accepted" val={counts.accepted} />
            <StatTile icon={<XCircle className="h-5 w-5 text-error" />} label="Failed" val={counts.failed} />
          </div>

          <div className="flex flex-col md:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-base-content/40" />
              <input
                className="input input-bordered w-full pl-9"
                placeholder="Search name, title, or company"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select className="select select-bordered" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
              <option value="all">All sources</option>
              {sources.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
              <option value="indeed" disabled>Indeed (Coming soon)</option>
            </select>
            <select className="select select-bordered" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="not_sent">Not sent</option>
              <option value="sent">Sent</option>
              <option value="accepted">Accepted</option>
              <option value="failed">Failed</option>
            </select>
            <select className="select select-bordered" value={campaignFilter} onChange={(e) => setCampaignFilter(e.target.value)}>
              <option value="all">All campaigns</option>
              {campaigns.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20 text-base-content/60">
              <UserCheck className="h-12 w-12 mx-auto mb-3 opacity-40" />
              <p>No leads match your filters.</p>
            </div>
          ) : (
            <div className="card bg-base-200 border border-base-300 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Lead</th>
                      <th>Company</th>
                      <th>Campaign</th>
                      <th>Source</th>
                      <th>Tier</th>
                      <th>Outreach</th>
                      <th>Status</th>
                      <th>Added</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.id} className="hover">
                        <td>
                          <div className="font-medium">{r.name ?? "—"}</div>
                          <div className="text-xs text-base-content/60">{r.title ?? ""}</div>
                        </td>
                        <td className="text-sm">{r.company ?? "—"}</td>
                        <td className="text-sm">{r.campaignName ?? "—"}</td>
                        <td>
                          <span className="badge badge-outline badge-sm capitalize">
                            {r.source ?? "linkedin"}
                          </span>
                        </td>
                        <td>
                          {r.conversion?.tier ? (
                            <span
                              className={`badge badge-sm ${
                                r.conversion.tier === "A"
                                  ? "badge-primary"
                                  : r.conversion.tier === "B"
                                    ? "badge-warning"
                                    : "badge-ghost"
                              }`}
                            >
                              {r.conversion.tier}
                              {typeof r.conversion.score === "number"
                                ? ` · ${r.conversion.score}`
                                : ""}
                            </span>
                          ) : (
                            <span className="text-base-content/40 text-xs">—</span>
                          )}
                        </td>
                        <td className="text-xs text-base-content/70 capitalize">
                          {r.conversion?.primaryChannel ?? "—"}
                        </td>
                        <td>
                          <StatusBadge lead={r} />
                        </td>
                        <td className="text-xs text-base-content/60">
                          {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—"}
                        </td>
                        <td>
                          <div className="flex flex-col gap-1 items-end">
                            {r.url && (
                              <a
                                href={r.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-ghost btn-xs gap-1"
                              >
                                <ExternalLink className="h-3 w-3" />{" "}
                                {r.source === "rozee" ? "Job" : "Profile"}
                              </a>
                            )}
                            {r.source === "rozee" && (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-xs gap-1"
                                  disabled={busyId === r.id}
                                  onClick={() => handleEnrich(r.id)}
                                >
                                  {busyId === r.id ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Sparkles className="h-3 w-3" />
                                  )}
                                  Enrich
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-xs gap-1"
                                  disabled={busyId === r.id}
                                  onClick={() => handleDraftRozee(r.id)}
                                >
                                  <MessageSquare className="h-3 w-3" />
                                  Draft
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
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

function StatusBadge({ lead }) {
  if (lead.inviteStatus === "accepted") {
    return <span className="badge badge-success badge-sm gap-1"><CheckCircle2 className="h-3 w-3" /> Accepted</span>;
  }
  if (lead.inviteStatus === "failed") {
    return <span className="badge badge-error badge-sm gap-1"><XCircle className="h-3 w-3" /> Failed</span>;
  }
  if (lead.inviteSent) {
    return <span className="badge badge-info badge-sm gap-1"><Send className="h-3 w-3" /> Sent</span>;
  }
  return <span className="badge badge-ghost badge-sm gap-1"><Clock className="h-3 w-3" /> Not sent</span>;
}
