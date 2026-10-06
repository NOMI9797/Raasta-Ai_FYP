"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  AlertTriangle, BookOpen, CalendarCheck, CalendarClock, Clock, ExternalLink, Globe, Loader2, MoreHorizontal, Send, Sparkles, Trash2,
} from "lucide-react";
import { useDialog } from "@/components/ui/DialogProvider";
import { CONVERSATION_STATUS, INTENT_LABELS, conversationLabel } from "@/libs/sales/conversation/status";
import { REPLY_ESCALATION_LABELS } from "@/libs/sales/conversation/decide";

const KIND_LABEL = { outreach: "First email", reply: "Reply", follow_up: "Follow-up" };
const AVATAR_TONES = ["bg-indigo-100 text-indigo-700", "bg-sky-100 text-sky-700", "bg-emerald-100 text-emerald-700", "bg-amber-100 text-amber-800", "bg-rose-100 text-rose-700", "bg-violet-100 text-violet-700", "bg-teal-100 text-teal-700"];

/** Initials in a coloured circle; the colour is stable per name. */
export function Avatar({ name, size = "h-9 w-9 text-xs", tone }) {
  const clean = String(name || "?").replace(/[^A-Za-z0-9 ]/g, " ").trim();
  const initials = clean.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  const hash = [...String(name || "")].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  return <span className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${size} ${tone || AVATAR_TONES[hash % AVATAR_TONES.length]}`}>{initials}</span>;
}

const time = (d) => (d ? new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) : "");
const dayLabel = (d) => {
  const date = new Date(d);
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
};
const when = (d) => (d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }) : "");

function Message({ m, leadName, ourName }) {
  const mine = m.direction === "out";
  const reading = m.meta?.reading;
  const sender = mine ? (m.meta?.writtenBy === "user" ? "You" : ourName) : m.meta?.fromName || m.fromAddress || leadName;
  return (
    <article className={`rounded-xl border px-4 py-3 ${mine ? "ml-8 border-primary/15 bg-primary/[0.04]" : "mr-8 border-base-300 bg-base-100"}`}>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Avatar name={mine ? ourName : leadName} size="h-7 w-7 text-[10px]" tone={mine ? "bg-primary text-primary-content" : undefined} />
        <span className="text-sm font-semibold">{sender}</span>
        {mine && KIND_LABEL[m.kind] && (
          <span className="rounded bg-base-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-base-content/60">
            {KIND_LABEL[m.kind]}{m.kind === "follow_up" && m.meta?.number ? ` ${m.meta.number}/${m.meta.total}` : ""}
          </span>
        )}
        {!mine && m.intent && <span className="rounded bg-info/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-info">{INTENT_LABELS[m.intent] || m.intent}</span>}
        <span className="flex-1" />
        <time className="text-xs text-base-content/45" title={when(m.sentAt || m.receivedAt || m.createdAt)}>{time(m.sentAt || m.receivedAt || m.createdAt)}</time>
      </header>
      <p className="mt-0.5 pl-9 text-xs text-base-content/45">
        {mine ? `to ${m.toAddress || "—"}` : `from ${m.fromAddress || "—"}`}
        {mine && m.meta?.testRedirectedTo && <span className="ml-1.5 rounded bg-info/10 px-1 text-info">test → {m.meta.testRedirectedTo}</span>}
      </p>
      {m.kind === "outreach" && m.subject && <p className="mt-2 pl-9 text-sm font-medium">{m.subject}</p>}
      <div className="mt-2 whitespace-pre-line pl-9 text-sm leading-relaxed text-base-content/90">{m.body}</div>
      {!mine && reading?.questions?.length > 0 && (
        <p className="mt-2 pl-9 text-xs text-base-content/55"><span className="font-medium">Asked:</span> {reading.questions.join(" · ")}</p>
      )}
      {!mine && m.meta?.note && <p className="mt-1 pl-9 text-xs text-base-content/45">{m.meta.note}</p>}
    </article>
  );
}

function Draft({ draft, onChanged }) {
  const { confirm } = useDialog();
  const [form, setForm] = useState({ toAddress: draft.toAddress || "", subject: draft.subject || "", body: draft.body });
  const [busy, setBusy] = useState(null);
  const dirty = form.toAddress !== (draft.toAddress || "") || form.subject !== (draft.subject || "") || form.body !== draft.body;
  const meta = draft.meta || {};
  const escalations = (meta.escalations || []).filter((e) => REPLY_ESCALATION_LABELS[e]);

  const send = async () => {
    setBusy("send");
    try {
      if (dirty) {
        const res = await fetch(`/api/sales/conversations/drafts/${draft.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not save");
      }
      const res = await fetch(`/api/sales/conversations/drafts/${draft.id}/send`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not send");
      toast.success(data.queued ? "Approved: the agent sends it in a moment" : data.meetingId ? "Sent, and the meeting is booked" : "Sent");
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    const ok = await confirm({ title: "Discard this draft?", message: "It won't be sent. You can ask the AI for a new one or write your own.", confirmText: "Discard", tone: "warning" });
    if (!ok) return;
    setBusy("discard");
    const res = await fetch(`/api/sales/conversations/drafts/${draft.id}`, { method: "DELETE" });
    setBusy(null);
    if (res.ok) onChanged();
    else toast.error("Could not discard it");
  };

  return (
    <article className="ml-8 overflow-hidden rounded-xl border border-primary/40 bg-base-100 shadow-sm">
      <header className="flex flex-wrap items-center gap-2 border-b border-primary/20 bg-primary/[0.06] px-4 py-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Draft {draft.kind === "follow_up" ? `follow-up${meta.number ? ` ${meta.number}/${meta.total}` : ""}` : "reply"}</span>
        <span className="text-xs text-base-content/55">· written by the agent, not sent yet</span>
      </header>
      <div className="space-y-2 px-4 py-3">
        {escalations.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {escalations.map((e) => <span key={e} className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-2 py-0.5 text-xs text-warning"><AlertTriangle className="h-3 w-3" /> {REPLY_ESCALATION_LABELS[e]}</span>)}
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-[auto_1fr] sm:items-center">
          <span className="text-xs text-base-content/50">To</span>
          <input className="input input-bordered input-sm" placeholder="name@company.com" value={form.toAddress} onChange={(e) => setForm({ ...form, toAddress: e.target.value })} />
          <span className="text-xs text-base-content/50">Subject</span>
          <input className="input input-bordered input-sm" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
        </div>
        <textarea className="textarea textarea-bordered min-h-[11rem] w-full text-sm leading-relaxed" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-base-content/55">
          {meta.passages?.length > 0 && <span className="inline-flex items-center gap-1"><BookOpen className="h-3.5 w-3.5" /> From your knowledge base: {meta.passages.map((p) => p.title).join(", ")}</span>}
          {meta.plan === "confirm" && <span className="inline-flex items-center gap-1 text-success"><CalendarCheck className="h-3.5 w-3.5" /> Sending books the meeting and attaches a calendar invite</span>}
          {meta.plan === "offer" && meta.slots?.length > 0 && <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> Offers {meta.slots.length} times from your meeting hours</span>}
        </div>
      </div>
      <footer className="flex justify-end gap-2 border-t border-base-200 bg-base-200/30 px-4 py-2">
        <button className="btn btn-ghost btn-sm gap-1" disabled={Boolean(busy)} onClick={discard}><Trash2 className="h-4 w-4" /> Discard</button>
        <button className="btn btn-primary btn-sm gap-1" disabled={Boolean(busy) || !form.body.trim() || !form.toAddress.trim()} onClick={send}>
          {busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {dirty ? "Save & send" : "Send"}
        </button>
      </footer>
    </article>
  );
}

function MeetingBanner({ meeting }) {
  if (!meeting) return null;
  const tz = meeting.timezone;
  const fmt = (d) => new Date(d).toLocaleString("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const confirmed = meeting.status === "confirmed";
  return (
    <a href="/dashboard/sales/meetings" className={`flex items-center gap-3 border-b px-5 py-2.5 text-sm transition-colors ${confirmed ? "border-success/20 bg-success/[0.07] hover:bg-success/10" : "border-warning/20 bg-warning/[0.07] hover:bg-warning/10"}`}>
      <CalendarCheck className={`h-4 w-4 ${confirmed ? "text-success" : "text-warning"}`} />
      <span className="flex-1">
        {confirmed ? <><span className="font-semibold">Meeting booked</span> · {fmt(meeting.startAt)} ({tz})</>
          : meeting.status === "proposed" ? <><span className="font-semibold">Times offered</span> · {(meeting.proposedSlots || []).map((s) => fmt(s.start)).join(" · ")}</>
          : <><span className="font-semibold">Meeting {meeting.status.replace("_", " ")}</span>{meeting.startAt && ` · ${fmt(meeting.startAt)}`}</>}
      </span>
      <span className="text-xs text-base-content/50">Meetings →</span>
    </a>
  );
}

/** One lead's whole email thread, with drafts to send and a reply box. */
export default function ConversationThread({ leadId, onChanged }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const [own, setOwn] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const scroller = useRef(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/sales/conversations/${leadId}`);
    const json = await res.json();
    if (res.ok) setData(json);
    else toast.error(json.error || "Could not load the conversation");
  }, [leadId]);

  useEffect(() => {
    load();
  }, [load]);

  // Newest at the bottom, like an inbox thread
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [data]);

  const changed = () => {
    load();
    onChanged?.();
  };

  const draftWithAi = async () => {
    setBusy("ai");
    try {
      const res = await fetch(`/api/sales/conversations/${leadId}/draft`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not write a reply");
      if (!json.draft) toast(json.note || "Nothing to answer", { icon: "ℹ️" });
      changed();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const sendOwn = async () => {
    setBusy("own");
    try {
      const res = await fetch(`/api/sales/conversations/${leadId}/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: own }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not send");
      toast.success("Sent");
      setOwn("");
      changed();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const setStatus = async (status) => {
    setMenuOpen(false);
    const res = await fetch(`/api/sales/conversations/${leadId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    if (res.ok) changed();
    else toast.error("Could not update it");
  };

  if (!data) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  const { lead, thread, meetings = [] } = data;
  const name = lead.company || lead.name || "Unknown";
  const sent = thread.filter((m) => m.status !== "draft");
  const drafts = thread.filter((m) => m.status === "draft");
  const lastIn = [...sent].reverse().find((m) => m.direction === "in");
  const lastIsTheirs = sent.length > 0 && sent[sent.length - 1].direction === "in";
  const status = conversationLabel(lead.status);
  const openMeeting = meetings.find((m) => ["proposed", "confirmed"].includes(m.status)) || meetings[0];
  const closed = [CONVERSATION_STATUS.NOT_INTERESTED, CONVERSATION_STATUS.UNSUBSCRIBED, CONVERSATION_STATUS.NO_RESPONSE].includes(lead.status);
  const unsubscribed = lead.status === CONVERSATION_STATUS.UNSUBSCRIBED;
  const ourName = "You";
  const statusOptions = closed
    ? [[CONVERSATION_STATUS.IN_CONVERSATION, "Re-open the conversation"]]
    : [[CONVERSATION_STATUS.NOT_INTERESTED, "Mark as not interested"], [CONVERSATION_STATUS.NO_RESPONSE, "Stop following up"], [CONVERSATION_STATUS.UNSUBSCRIBED, "They asked us to stop"]];

  // Group messages by day for separators
  let lastDay = null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-3 border-b border-base-300 px-5 py-3">
        <Avatar name={name} size="h-10 w-10 text-sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-semibold">{name}</h2>
            <span className={`badge badge-sm ${status.tone}`}>{status.label}</span>
            {lead.fit?.score != null && <span className="badge badge-ghost badge-sm">Fit {lead.fit.score}</span>}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-base-content/55">
            <span>{lead.campaignName}</span>
            {lead.website && <a href={lead.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-primary"><Globe className="h-3 w-3" /> Website <ExternalLink className="h-2.5 w-2.5" /></a>}
            {lead.nextFollowUpAt && !closed && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> Follow-up {when(lead.nextFollowUpAt)} if no reply</span>}
          </p>
        </div>
        <div className="relative">
          <button className="btn btn-ghost btn-sm btn-square" title="More" onClick={() => setMenuOpen((v) => !v)}><MoreHorizontal className="h-4 w-4" /></button>
          {menuOpen && (
            <>
              <button className="fixed inset-0 z-10 cursor-default" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
              <ul className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-lg border border-base-300 bg-base-100 py-1 text-sm shadow-lg">
                {statusOptions.map(([value, label]) => (
                  <li key={value}><button className="w-full px-3 py-2 text-left hover:bg-base-200" onClick={() => setStatus(value)}>{label}</button></li>
                ))}
              </ul>
            </>
          )}
        </div>
      </header>

      <MeetingBanner meeting={openMeeting} />

      {/* Messages */}
      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-base-200/30 px-5 py-4">
        {sent.map((m) => {
          const day = dayLabel(m.sentAt || m.receivedAt || m.createdAt);
          const separator = day !== lastDay;
          lastDay = day;
          return (
            <div key={m.id} className="space-y-3">
              {separator && (
                <div className="flex items-center gap-3 py-1 text-[11px] font-medium uppercase tracking-wide text-base-content/40">
                  <span className="h-px flex-1 bg-base-300" /> {day} <span className="h-px flex-1 bg-base-300" />
                </div>
              )}
              <Message m={m} leadName={name} ourName={ourName} />
            </div>
          );
        })}
        {drafts.map((d) => <Draft key={d.id} draft={d} onChanged={changed} />)}
      </div>

      {/* Reply box */}
      {!drafts.length && !unsubscribed && (
        <footer className="shrink-0 border-t border-base-300 bg-base-100 px-5 py-3">
          {lastIsTheirs && (
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 text-warning"><AlertTriangle className="h-3.5 w-3.5" /> {lastIn?.handledAt ? "Their reply hasn't been answered" : "The agent answers this on its next run, or answer now"}</span>
              <span className="flex-1" />
              <button className="btn btn-primary btn-xs gap-1" disabled={Boolean(busy)} onClick={draftWithAi}>
                {busy === "ai" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Write a reply with AI
              </button>
            </div>
          )}
          <div className="flex items-end gap-2 rounded-xl border border-base-300 bg-base-100 p-2 focus-within:border-primary/50">
            <textarea
              className="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
              rows={own.split("\n").length > 2 ? 4 : 2}
              placeholder={`Write to ${name}… (sent in the same email thread)`}
              value={own}
              onChange={(e) => setOwn(e.target.value)}
            />
            <button className="btn btn-primary btn-sm gap-1" disabled={busy === "own" || !own.trim()} onClick={sendOwn}>
              {busy === "own" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
            </button>
          </div>
        </footer>
      )}
      {unsubscribed && (
        <footer className="shrink-0 border-t border-base-300 bg-base-200/40 px-5 py-3 text-xs text-base-content/60">They asked not to be emailed again. Re-open the conversation from the ⋯ menu if they write to you.</footer>
      )}
    </div>
  );
}
