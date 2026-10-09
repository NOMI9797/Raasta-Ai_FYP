"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { CalendarCheck, Hand, Inbox, Loader2, MailCheck, MessagesSquare, RefreshCw, Search, Send } from "lucide-react";
import SalesStageShell from "@/components/sales/SalesStageShell";
import ConversationThread, { Avatar } from "@/components/sales/conversations/ConversationThread";
import SourceTag from "@/components/sales/SourceTag";
import { CLOSED_STATUSES, CONVERSATION_STATUS, INTENT_LABELS, conversationLabel } from "@/libs/sales/conversation/status";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "needs_you", label: "Needs you" },
  { key: "replied", label: "Replied" },
  { key: "meetings", label: "Meetings" },
  { key: "waiting", label: "Waiting" },
  { key: "closed", label: "Closed" },
];

function matches(c, filter) {
  if (filter === "needs_you") return c.needsYou;
  if (filter === "replied") return ![CONVERSATION_STATUS.AWAITING_REPLY, CONVERSATION_STATUS.NO_RESPONSE].includes(c.status);
  if (filter === "meetings") return [CONVERSATION_STATUS.MEETING_PROPOSED, CONVERSATION_STATUS.MEETING_BOOKED].includes(c.status);
  if (filter === "waiting") return c.status === CONVERSATION_STATUS.AWAITING_REPLY;
  if (filter === "closed") return CLOSED_STATUSES.includes(c.status) && c.status !== CONVERSATION_STATUS.MEETING_BOOKED;
  return true;
}

const STATUS_DOT = {
  awaiting_reply: "bg-base-content/30",
  replied: "bg-info",
  in_conversation: "bg-info",
  meeting_proposed: "bg-warning",
  meeting_booked: "bg-success",
  not_interested: "bg-base-content/20",
  unsubscribed: "bg-base-content/20",
  no_response: "bg-base-content/20",
};

function ago(d) {
  if (!d) return "";
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h`;
  if (m < 60 * 24 * 7) return `${Math.round(m / 1440)}d`;
  return new Date(d).toLocaleDateString([], { day: "numeric", month: "short" });
}

function Stat({ icon: Icon, label, value, tone = "", active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border bg-base-100 px-4 py-3 text-left transition-colors ${active ? "border-primary ring-1 ring-primary/30" : "border-base-300 hover:border-primary/40"}`}
    >
      <p className="flex items-center gap-1.5 text-xs font-medium text-base-content/55"><Icon className="h-3.5 w-3.5" /> {label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</p>
    </button>
  );
}

function ConversationItem({ c, selected, showCampaign, onSelect }) {
  const s = conversationLabel(c.status);
  const name = c.company || c.name || "Unknown";
  const preview = c.lastMessage
    ? `${c.lastMessage.status === "draft" ? "Draft: " : c.lastMessage.direction === "out" ? "You: " : ""}${c.lastMessage.preview.replace(/\s+/g, " ")}`
    : "";
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`relative flex w-full gap-3 px-4 py-3 text-left transition-colors ${selected ? "bg-primary/[0.07]" : "hover:bg-base-200/60"}`}
      >
        {selected && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" aria-hidden />}
        <Avatar name={name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className={`flex-1 truncate text-sm ${c.needsYou ? "font-semibold" : "font-medium"}`}>{name}</span>
            <span className="shrink-0 text-[11px] text-base-content/45">{ago(c.lastMessage?.at)}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-base-content/60">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[c.status] || "bg-base-content/30"}`} />
            <span className="truncate">{s.label}{c.intent ? ` · ${INTENT_LABELS[c.intent] || c.intent}` : ""}</span>
          </div>
          <p className={`mt-1 truncate text-xs ${c.needsYou ? "text-base-content/80" : "text-base-content/50"}`}>{preview}</p>
          <div className="mt-1 flex min-w-0 items-center gap-2">
            <SourceTag source={c.source} channel={c.channel} />
            {showCampaign && <span className="truncate text-[10px] uppercase tracking-wide text-base-content/35">{c.campaignName}</span>}
          </div>
        </div>
        {c.needsYou && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-warning" title="Needs you" />}
      </button>
    </li>
  );
}

function Conversations({ campaigns }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selected = searchParams.get("lead");
  const campaignId = searchParams.get("campaign") || "";
  const [filter, setFilter] = useState("all");
  const [query, setQueryText] = useState("");
  const [data, setData] = useState(null);
  const [syncing, setSyncing] = useState(false);

  // Also runs every 20 s in the background: a failed refresh (server restarting, network blip) is
  // skipped quietly and the next one tries again, instead of showing a runtime error
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/sales/conversations${campaignId ? `?campaign=${campaignId}` : ""}`);
      const json = await res.json();
      if (res.ok) setData(json);
    } catch {
      // keep what's on screen
    }
  }, [campaignId]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 20000); // replies arrive in the background
    return () => clearInterval(timer);
  }, [load]);

  const setQuery = useCallback((changes) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(changes).forEach(([k, v]) => (v ? params.set(k, v) : params.delete(k)));
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router, searchParams]);

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/sales/conversations/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast.success(json.skipped ? `Not checked: ${json.skipped}` : json.replies ? `${json.replies} new repl${json.replies === 1 ? "y" : "ies"}` : "No new replies");
      await load();
    } catch (err) {
      toast.error(err.message || "Could not check the mailbox");
    } finally {
      setSyncing(false);
    }
  };

  const all = useMemo(() => data?.conversations || [], [data]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, all.filter((c) => matches(c, f.key)).length])), [all]);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((c) => matches(c, filter)).filter((c) => !q || [c.company, c.name, c.lastMessage?.preview, c.campaignName].some((v) => String(v || "").toLowerCase().includes(q)));
  }, [all, filter, query]);

  // Open the first conversation (the one that needs you, if any) instead of an empty pane
  useEffect(() => {
    if (!data || selected || !all.length) return;
    const first = all.find((c) => c.needsYou) || all[0];
    setQuery({ lead: first.leadId });
  }, [data, selected, all, setQuery]);

  const inbox = data?.inbox;
  const sentCount = all.length;
  const repliedCount = counts.replied;

  return (
    <div className="space-y-5">
      {/* Overview: each tile filters the inbox */}
      {data && <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={Send} label="Contacted" value={sentCount} active={filter === "all"} onClick={() => setFilter("all")} />
        <Stat icon={Hand} label="Needs you" value={counts.needs_you} tone={counts.needs_you ? "text-warning" : ""} active={filter === "needs_you"} onClick={() => setFilter("needs_you")} />
        <Stat icon={MessagesSquare} label="Replied" value={sentCount ? `${repliedCount} · ${Math.round((repliedCount / sentCount) * 100)}%` : 0} active={filter === "replied"} onClick={() => setFilter("replied")} />
        <Stat icon={CalendarCheck} label="Meetings" value={counts.meetings} tone={counts.meetings ? "text-success" : ""} active={filter === "meetings"} onClick={() => setFilter("meetings")} />
      </div>}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <select className="select select-bordered select-sm w-full sm:w-64" value={campaignId} onChange={(e) => setQuery({ campaign: e.target.value, lead: null })}>
          <option value="">All campaigns</option>
          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="input input-bordered input-sm flex flex-1 items-center gap-2 sm:max-w-xs">
          <Search className="h-3.5 w-3.5 opacity-50" />
          <input className="grow" placeholder="Search company or message" value={query} onChange={(e) => setQueryText(e.target.value)} />
        </label>
        <div className="ml-auto flex items-center gap-2">
          {inbox?.configured ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-base-300 bg-base-100 px-3 py-1 text-xs text-base-content/65" title={`Replies are read from ${inbox.address} every 2 minutes`}>
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              <MailCheck className="h-3.5 w-3.5" /> {inbox.address}
              {inbox.lastSyncAt && <span className="text-base-content/45">· checked {ago(inbox.lastSyncAt) === "now" ? "just now" : `${ago(inbox.lastSyncAt)} ago`}</span>}
            </span>
          ) : inbox ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-xs text-warning">No mailbox set up: replies can&apos;t be read</span>
          ) : null}
          <button className="btn btn-ghost btn-sm btn-square" title="Check for replies now" disabled={syncing || inbox?.configured === false} onClick={sync}>
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {!data ? (
        <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
      ) : !all.length ? (
        <div className="rounded-xl border border-dashed border-base-300 p-12 text-center">
          <Inbox className="mx-auto h-9 w-9 opacity-40" />
          <p className="mt-3 font-semibold">No conversations yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-base-content/60">Once a company has been emailed, its thread shows up here. Their replies arrive within a couple of minutes, and the agent answers them from your knowledge base.</p>
        </div>
      ) : (
        <div className="grid overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-sm lg:h-[calc(100vh-17rem)] lg:min-h-[34rem] lg:grid-cols-[22rem_1fr]">
          {/* List */}
          <aside className="flex min-h-0 flex-col border-b border-base-300 lg:border-b-0 lg:border-r">
            <div className="flex gap-4 overflow-x-auto border-b border-base-300 px-4">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={`-mb-px flex shrink-0 items-center gap-1 border-b-2 py-2.5 text-xs font-medium transition-colors ${filter === f.key ? "border-primary text-primary" : "border-transparent text-base-content/55 hover:text-base-content"}`}
                >
                  {f.label}
                  {counts[f.key] > 0 && <span className={`tabular-nums ${f.key === "needs_you" && filter !== f.key ? "text-warning" : "opacity-60"}`}>{counts[f.key]}</span>}
                </button>
              ))}
            </div>
            <ul className="min-h-0 flex-1 divide-y divide-base-200 overflow-y-auto max-lg:max-h-80">
              {list.length === 0 && <li className="p-6 text-center text-sm text-base-content/50">{query ? "No match." : "Nothing here."}</li>}
              {list.map((c) => (
                <ConversationItem key={c.leadId} c={c} selected={selected === c.leadId} showCampaign={!campaignId} onSelect={() => setQuery({ lead: c.leadId })} />
              ))}
            </ul>
          </aside>

          {/* Thread */}
          <section className="flex min-h-[28rem] min-w-0 flex-col lg:min-h-0">
            {selected ? (
              <ConversationThread key={selected} leadId={selected} onChanged={load} />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center text-center text-base-content/50">
                <MessagesSquare className="h-9 w-9 opacity-40" />
                <p className="mt-2 text-sm">Choose a conversation.</p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function ConversationsWithCampaigns() {
  const [campaigns, setCampaigns] = useState([]);
  useEffect(() => {
    fetch("/api/campaigns").then((r) => r.json()).then((d) => setCampaigns(d.campaigns || [])).catch(() => {});
  }, []);
  return <Conversations campaigns={campaigns} />;
}

// Step 6: replies from leads, answered from the knowledge base
export default function ConversationsPage() {
  return (
    <SalesStageShell stageKey="conversations" requireCampaign={false}>
      {() => <ConversationsWithCampaigns />}
    </SalesStageShell>
  );
}
