"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { Building2, Hand, Inbox, Loader2, MailCheck, RefreshCw, User } from "lucide-react";
import SalesStageShell from "@/components/sales/SalesStageShell";
import ConversationThread from "@/components/sales/conversations/ConversationThread";
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

const ago = (d) => {
  if (!d) return "";
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 60) return `${Math.max(1, m)}m`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
};

function Conversations({ campaigns }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selected = searchParams.get("lead");
  const campaignId = searchParams.get("campaign") || "";
  const [filter, setFilter] = useState("all");
  const [data, setData] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/sales/conversations${campaignId ? `?campaign=${campaignId}` : ""}`);
    const json = await res.json();
    if (res.ok) setData(json);
  }, [campaignId]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 20000); // replies arrive in the background
    return () => clearInterval(timer);
  }, [load]);

  const setQuery = (changes) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(changes).forEach(([k, v]) => (v ? params.set(k, v) : params.delete(k)));
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

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

  const list = useMemo(() => (data?.conversations || []).filter((c) => matches(c, filter)), [data, filter]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, (data?.conversations || []).filter((c) => matches(c, f.key)).length])), [data]);
  const inbox = data?.inbox;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select className="select select-bordered select-sm" value={campaignId} onChange={(e) => setQuery({ campaign: e.target.value, lead: null })}>
            <option value="">All campaigns</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div role="tablist" className="tabs tabs-boxed tabs-sm">
            {FILTERS.map((f) => (
              <button key={f.key} role="tab" className={`tab gap-1 ${filter === f.key ? "tab-active" : ""}`} onClick={() => setFilter(f.key)}>
                {f.label}{counts[f.key] > 0 && <span className={`badge badge-xs ${f.key === "needs_you" ? "badge-warning" : "badge-ghost"}`}>{counts[f.key]}</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-base-content/60">
          {inbox?.configured ? (
            <span className="flex items-center gap-1"><MailCheck className="h-3.5 w-3.5" /> Watching {inbox.address}{inbox.lastSyncAt && `, checked ${ago(inbox.lastSyncAt)} ago`}</span>
          ) : inbox ? (
            <span className="text-warning">No mailbox set up: replies can&apos;t be read (SENDER_EMAIL / SENDER_PASSWORD)</span>
          ) : null}
          <button className="btn btn-outline btn-xs gap-1" disabled={syncing || inbox?.configured === false} onClick={sync}>
            {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Check now
          </button>
        </div>
      </div>

      {!data ? (
        <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
      ) : !data.conversations.length ? (
        <div className="rounded-xl border border-dashed border-base-300 p-10 text-center">
          <Inbox className="h-8 w-8 mx-auto opacity-40" />
          <p className="font-semibold mt-2">No conversations yet</p>
          <p className="text-sm text-base-content/60">Once a lead has been emailed, its thread shows up here, and their replies arrive within a couple of minutes.</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[22rem_1fr] items-start">
          <ul className="rounded-xl border border-base-300 bg-base-100 divide-y divide-base-300 max-h-[75vh] overflow-y-auto">
            {list.length === 0 && <li className="p-4 text-sm text-base-content/60">Nothing here.</li>}
            {list.map((c) => {
              const s = conversationLabel(c.status);
              const Icon = c.source === "linkedin" ? User : Building2;
              return (
                <li key={c.leadId}>
                  <button className={`w-full text-left p-3 hover:bg-base-200 ${selected === c.leadId ? "bg-primary/5 border-l-4 border-primary" : ""}`} onClick={() => setQuery({ lead: c.leadId })}>
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 opacity-50 shrink-0" />
                      <span className="font-medium text-sm truncate flex-1">{c.company || c.name}</span>
                      {c.needsYou && <Hand className="h-3.5 w-3.5 text-warning shrink-0" title="Needs you" />}
                      <span className="text-xs text-base-content/50">{ago(c.lastMessage?.at)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <span className={`badge badge-xs ${s.tone}`}>{s.label}</span>
                      {c.intent && <span className="badge badge-xs badge-outline">{INTENT_LABELS[c.intent] || c.intent}</span>}
                    </div>
                    {c.lastMessage && (
                      <p className="text-xs text-base-content/60 mt-1 line-clamp-2">
                        {c.lastMessage.status === "draft" ? "Draft: " : c.lastMessage.direction === "out" ? "You: " : ""}{c.lastMessage.preview}
                      </p>
                    )}
                    {!campaignId && <p className="text-[11px] text-base-content/40 mt-0.5 truncate">{c.campaignName}</p>}
                  </button>
                </li>
              );
            })}
          </ul>
          <section className="rounded-xl border border-base-300 bg-base-100 p-4 min-h-[20rem]">
            {selected ? (
              <ConversationThread leadId={selected} onChanged={load} />
            ) : (
              <div className="flex flex-col items-center justify-center text-center py-16 text-base-content/60">
                <Inbox className="h-8 w-8 opacity-40" />
                <p className="text-sm mt-2">Choose a conversation.</p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

// Step 6: replies from leads, answered from the knowledge base
export default function ConversationsPage() {
  return (
    <SalesStageShell stageKey="conversations" requireCampaign={false}>
      {() => <ConversationsWithCampaigns />}
    </SalesStageShell>
  );
}

function ConversationsWithCampaigns() {
  const [campaigns, setCampaigns] = useState([]);
  useEffect(() => {
    fetch("/api/campaigns").then((r) => r.json()).then((d) => setCampaigns(d.campaigns || [])).catch(() => {});
  }, []);
  return <Conversations campaigns={campaigns} />;
}
