"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Loader2, MessageSquare } from "lucide-react";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";

const STAGES = [
  { value: "pending", label: "Pending", accent: "border-base-content/30", match: (l) => !l.inviteSent },
  { value: "sent", label: "Sent", accent: "border-info", match: (l) => l.inviteSent && l.inviteStatus !== "accepted" && l.inviteStatus !== "failed" && l.inviteStatus !== "rejected" },
  { value: "accepted", label: "Accepted", accent: "border-success", match: (l) => l.inviteStatus === "accepted" },
  { value: "failed", label: "Failed / Rejected", accent: "border-error", match: (l) => l.inviteStatus === "failed" || l.inviteStatus === "rejected" },
];

export default function OutreachPipelinePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [rows, setRows] = useState([]);
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [loading, setLoading] = useState(true);

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
        const res = await fetch("/api/leads");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setRows(data.leads || []);
      } catch (err) {
        toast.error(err.message || "Failed to load outreach");
      } finally {
        setLoading(false);
      }
    })();
  }, [session]);

  const campaigns = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      if (r.campaignId) map.set(r.campaignId, r.campaignName ?? r.campaignId);
    }
    return Array.from(map.entries());
  }, [rows]);

  const sources = useMemo(
    () => Array.from(new Set(rows.map((r) => r.source ?? "linkedin"))),
    [rows]
  );

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (campaignFilter !== "all" && r.campaignId !== campaignFilter) return false;
        if (sourceFilter !== "all" && (r.source ?? "linkedin") !== sourceFilter) return false;
        return true;
      }),
    [rows, campaignFilter, sourceFilter]
  );

  const byStage = useMemo(() => {
    const grouped = Object.fromEntries(STAGES.map((s) => [s.value, []]));
    for (const lead of filtered) {
      const stage = STAGES.find((s) => s.match(lead));
      if (stage) grouped[stage.value].push(lead);
    }
    return grouped;
  }, [filtered]);

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
        activeSection="sales-outreach"
      />
      <div
        className={`flex-1 transition-all duration-300 ${
          sidebarCollapsed ? "ml-16" : "ml-64"
        } flex flex-col h-full overflow-hidden`}
      >
        <TopBar title="Outreach" />
        <main className="flex-1 p-6 flex flex-col gap-4 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <MessageSquare className="h-6 w-6" /> Outreach Pipeline
              </h1>
              <p className="text-sm text-base-content/70 mt-1">
                Track invite and message status across all campaigns.
              </p>
            </div>
            <div className="flex gap-2">
              <select
                className="select select-bordered select-sm"
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
              >
                <option value="all">All sources</option>
                {sources.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
                <option value="indeed" disabled>Indeed (Coming soon)</option>
              </select>
              <select
                className="select select-bordered select-sm"
                value={campaignFilter}
                onChange={(e) => setCampaignFilter(e.target.value)}
              >
                <option value="all">All campaigns</option>
                {campaigns.map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            </div>
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
                  className={`card bg-base-200 border-t-4 ${stage.accent} border-base-300 flex flex-col min-h-0`}
                >
                  <div className="p-3 border-b border-base-300 flex items-center justify-between">
                    <h3 className="font-semibold text-sm">{stage.label}</h3>
                    <span className="badge badge-ghost badge-sm">{byStage[stage.value].length}</span>
                  </div>
                  <div className="p-2 space-y-2 flex-1 overflow-y-auto">
                    {byStage[stage.value].length === 0 ? (
                      <p className="text-xs text-base-content/40 text-center py-4">
                        Empty
                      </p>
                    ) : (
                      byStage[stage.value].map((lead) => (
                        <div
                          key={lead.id}
                          className="bg-base-100 rounded-lg border border-base-300 p-3"
                        >
                          <div className="font-medium text-sm truncate">{lead.name ?? "—"}</div>
                          {lead.title && (
                            <div className="text-xs text-base-content/60 truncate">{lead.title}</div>
                          )}
                          <div className="flex items-center gap-1 mt-2 flex-wrap">
                            <span className="badge badge-outline badge-xs capitalize">
                              {lead.source ?? "linkedin"}
                            </span>
                            {lead.campaignName && (
                              <span className="text-[10px] text-base-content/60 truncate">
                                • {lead.campaignName}
                              </span>
                            )}
                          </div>
                        </div>
                      ))
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
