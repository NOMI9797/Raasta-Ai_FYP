"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  ArrowRight, BarChart3, Bot, CalendarCheck, Edit, Loader2, MailCheck, MessagesSquare, MoreHorizontal, Plus, Search, Target, Trash2, Users,
} from "lucide-react";
import { useDialog } from "@/components/ui/DialogProvider";
import CreateCampaignModal from "@/app/dashboard/campaigns/components/CreateCampaignModal";
import EditCampaignModal from "@/app/dashboard/campaigns/components/EditCampaignModal";
import { useCampaigns } from "@/app/dashboard/campaigns/hooks/useCampaigns";
import { PLATFORM_META } from "@/libs/platforms/meta";
import { stageHref } from "@/libs/sales/stages";

const STATUS = {
  draft: { label: "Draft", dot: "bg-slate-400", text: "text-base-content/60" },
  active: { label: "Active", dot: "bg-emerald-500", text: "text-emerald-600" },
  paused: { label: "Paused", dot: "bg-amber-400", text: "text-amber-600" },
  completed: { label: "Completed", dot: "bg-sky-500", text: "text-sky-600" },
};
const FILTERS = ["all", "active", "draft", "paused", "completed"];
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function Stat({ icon: Icon, label, value, sub, tone = "" }) {
  return (
    <div className="rounded-xl border border-base-300 bg-base-100 px-4 py-3 shadow-sm">
      <p className="flex items-center gap-1.5 text-xs font-medium text-base-content/55"><Icon className="h-3.5 w-3.5" /> {label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-base-content/50">{sub}</p>}
    </div>
  );
}

function PlatformChips({ sources, byPlatform }) {
  const list = [...new Set([...(sources || []), ...Object.keys(byPlatform || {})])];
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((p) => {
        const meta = PLATFORM_META[p];
        if (!meta) return null;
        return (
          <span key={p} className="inline-flex items-center gap-1.5 rounded-full border border-base-300 py-0.5 pl-0.5 pr-2 text-xs">
            <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-white ${meta.accent}`}>{meta.initials}</span>
            {meta.shortLabel || meta.label}
            {byPlatform?.[p] ? <span className="tabular-nums text-base-content/50">{byPlatform[p]}</span> : null}
          </span>
        );
      })}
    </div>
  );
}

function CampaignCard({ campaign, numbers, onOpen, onEdit, onDelete, deleting }) {
  const [menu, setMenu] = useState(false);
  const status = STATUS[campaign.status] || STATUS.draft;
  const n = numbers || { leads: Number(campaign.leadsCount) || 0, contacted: 0, replied: 0, meetings: 0, byPlatform: {} };
  const progress = pct(n.contacted, n.leads);

  return (
    <article
      className="group flex cursor-pointer flex-col rounded-xl border border-base-300 bg-base-100 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
      onClick={() => onOpen(campaign)}
    >
      <div className="flex-1 space-y-4 p-5">
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${status.text}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} /> {status.label}
            </span>
            <h3 className="mt-1 line-clamp-2 text-base font-semibold leading-snug group-hover:text-primary">{campaign.name}</h3>
            {campaign.description && <p className="mt-1 line-clamp-2 text-sm text-base-content/60">{campaign.description}</p>}
          </div>
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <button className="btn btn-ghost btn-sm btn-square" aria-label="Campaign options" onClick={() => setMenu((v) => !v)}><MoreHorizontal className="h-4 w-4" /></button>
            {menu && (
              <>
                <button className="fixed inset-0 z-10 cursor-default" aria-label="Close menu" onClick={() => setMenu(false)} />
                <ul className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-base-300 bg-base-100 py-1 text-sm shadow-lg">
                  <li><button className="flex w-full items-center gap-2 px-3 py-2 hover:bg-base-200" onClick={() => { setMenu(false); onEdit(campaign); }}><Edit className="h-3.5 w-3.5" /> Edit</button></li>
                  <li><Link className="flex items-center gap-2 px-3 py-2 hover:bg-base-200" href={stageHref("results", { campaignId: campaign.id })}><BarChart3 className="h-3.5 w-3.5" /> Results</Link></li>
                  <li><Link className="flex items-center gap-2 px-3 py-2 hover:bg-base-200" href="/dashboard/agents"><Bot className="h-3.5 w-3.5" /> Sales agent</Link></li>
                  <li className="my-1 border-t border-base-200" />
                  <li>
                    <button className="flex w-full items-center gap-2 px-3 py-2 text-error hover:bg-error/10" disabled={deleting} onClick={() => { setMenu(false); onDelete(campaign); }}>
                      {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete
                    </button>
                  </li>
                </ul>
              </>
            )}
          </div>
        </header>

        <PlatformChips sources={campaign.sources} byPlatform={n.byPlatform} />

        <dl className="grid grid-cols-4 divide-x divide-base-200 rounded-lg bg-base-200/50 py-2 text-center">
          {[
            ["Leads", n.leads, ""],
            ["Contacted", n.contacted, ""],
            ["Replied", n.replied, n.replied ? "text-sky-600" : ""],
            ["Meetings", n.meetings, n.meetings ? "text-emerald-600" : ""],
          ].map(([label, value, tone]) => (
            <div key={label} className="px-1">
              <dt className="text-[10px] font-medium uppercase tracking-wide text-base-content/50">{label}</dt>
              <dd className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</dd>
            </div>
          ))}
        </dl>

        <div>
          <div className="mb-1 flex justify-between text-xs text-base-content/55">
            <span>Outreach</span>
            <span className="tabular-nums">{n.leads ? `${n.contacted} of ${n.leads} contacted` : "No leads yet"}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-base-200"><div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} /></div>
        </div>
      </div>

      <footer className="flex items-center gap-3 border-t border-base-200 px-5 py-2.5 text-xs text-base-content/55">
        {n.agent ? (
          <span className="inline-flex items-center gap-1.5 text-primary"><Bot className="h-3.5 w-3.5" /> Agent {n.agent.mode === "autopilot" ? "Auto" : "Semi-auto"} · {n.agent.status === "paused" ? "paused" : "working"}</span>
        ) : (
          <span>Created {new Date(campaign.createdAt).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}</span>
        )}
        <span className="flex-1" />
        <span className="inline-flex items-center gap-1 font-medium text-base-content/70 group-hover:text-primary">{n.leads ? "Continue" : "Find leads"} <ArrowRight className="h-3.5 w-3.5" /></span>
      </footer>
    </article>
  );
}

/** Step 1: every campaign with its real numbers; opening one continues at the right step. */
export default function SalesCampaignsList() {
  const router = useRouter();
  const { confirm } = useDialog();
  const { campaigns, loading, error, createCampaign, updateCampaign, deleteCampaign, refreshCampaigns } = useCampaigns();
  const [overview, setOverview] = useState(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/sales/campaigns/overview").then((r) => r.json()).then((d) => setOverview(d.overview || {})).catch(() => setOverview({}));
  }, [campaigns]);

  const open = (campaign) => {
    const leadCount = overview?.[campaign.id]?.leads ?? Number(campaign.leadsCount);
    router.push(stageHref(leadCount > 0 ? "research" : "find", { campaignId: campaign.id }));
  };

  const remove = async (campaign) => {
    const ok = await confirm({
      title: `Delete "${campaign.name}"?`,
      message: "This permanently deletes the campaign and everything in it. It cannot be undone.",
      items: ["The campaign", "All its leads and messages", "Its conversations and meetings"],
      confirmText: "Delete campaign",
      tone: "danger",
    });
    if (!ok) return;
    setDeletingId(campaign.id);
    try {
      await deleteCampaign(campaign.id, campaign.name);
    } catch {
      toast.error("Could not delete the campaign");
    } finally {
      setDeletingId(null);
    }
  };

  const totals = useMemo(() => {
    const all = Object.values(overview || {});
    const sum = (k) => all.reduce((a, o) => a + (o[k] || 0), 0);
    return { leads: sum("leads"), contacted: sum("contacted"), replied: sum("replied"), meetings: sum("meetings"), agents: all.filter((o) => o.agent).length };
  }, [overview]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f, f === "all" ? campaigns.length : campaigns.filter((c) => c.status === f).length])), [campaigns]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return campaigns
      .filter((c) => filter === "all" || c.status === filter)
      .filter((c) => !q || [c.name, c.description].some((v) => String(v || "").toLowerCase().includes(q)));
  }, [campaigns, filter, query]);

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-5">
      {campaigns.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Stat icon={Target} label="Campaigns" value={campaigns.length} sub={`${counts.active} active${totals.agents ? ` · ${totals.agents} with an agent` : ""}`} />
          <Stat icon={Users} label="Leads" value={totals.leads} />
          <Stat icon={MailCheck} label="Contacted" value={totals.contacted} sub={totals.leads ? `${pct(totals.contacted, totals.leads)}% of leads` : null} />
          <Stat icon={MessagesSquare} label="Replied" value={totals.replied} sub={totals.contacted ? `${pct(totals.replied, totals.contacted)}% reply rate` : null} tone={totals.replied ? "text-sky-600" : ""} />
          <Stat icon={CalendarCheck} label="Meetings" value={totals.meetings} tone={totals.meetings ? "text-emerald-600" : ""} />
        </div>
      )}

      {error && (
        <div role="alert" className="alert alert-error text-sm">
          <span className="flex-1">{error.message || String(error)}</span>
          <button className="btn btn-ghost btn-sm" onClick={refreshCampaigns}>Try again</button>
        </div>
      )}

      {campaigns.length === 0 ? (
        <div className="rounded-xl border border-dashed border-base-300 bg-base-100 p-12 text-center">
          <Target className="mx-auto h-10 w-10 opacity-30" />
          <p className="mt-3 text-lg font-semibold">Create your first campaign</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-base-content/60">A campaign is who you want to reach and where: people on LinkedIn, or companies that are hiring on Indeed and Rozee.pk.</p>
          <button className="btn btn-primary btn-sm mt-5 gap-1" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New campaign</button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div role="tablist" className="flex flex-wrap gap-1">
              {FILTERS.filter((f) => f === "all" || counts[f]).map((f) => (
                <button key={f} role="tab" onClick={() => setFilter(f)}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${filter === f ? "bg-primary text-primary-content" : "bg-base-200 text-base-content/70 hover:bg-base-300"}`}>
                  {f} <span className="tabular-nums opacity-70">{counts[f]}</span>
                </button>
              ))}
            </div>
            <span className="flex-1" />
            <label className="input input-bordered input-sm flex w-full items-center gap-2 sm:w-60">
              <Search className="h-3.5 w-3.5 opacity-50" />
              <input className="grow" placeholder="Search campaigns" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <button className="btn btn-primary btn-sm gap-1" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New campaign</button>
          </div>

          {shown.length === 0 ? (
            <p className="rounded-xl border border-dashed border-base-300 p-8 text-center text-sm text-base-content/55">No campaign matches.</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {shown.map((c) => (
                <CampaignCard key={c.id} campaign={c} numbers={overview?.[c.id]} onOpen={open} onEdit={setEditing} onDelete={remove} deleting={deletingId === c.id} />
              ))}
              <button type="button" onClick={() => setCreating(true)}
                className="flex min-h-[14rem] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-base-300 text-sm text-base-content/55 transition-colors hover:border-primary/50 hover:text-primary">
                <Plus className="h-6 w-6" /> New campaign
              </button>
            </div>
          )}
        </>
      )}

      <CreateCampaignModal
        open={creating}
        onClose={() => setCreating(false)}
        onSubmit={async (data) => {
          try {
            const created = await createCampaign(data);
            setCreating(false);
            open(created);
          } catch {
            // the hook already showed the error
          }
        }}
      />
      <EditCampaignModal
        open={Boolean(editing)}
        campaign={editing}
        onClose={() => setEditing(null)}
        onSubmit={async (id, data) => {
          try {
            await updateCampaign(id, data);
            setEditing(null);
          } catch {
            // the hook already showed the error
          }
        }}
      />
    </div>
  );
}
