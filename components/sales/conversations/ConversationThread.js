"use client";

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  AlertTriangle, BookOpen, Building2, CalendarCheck, CalendarClock, Clock, ExternalLink, Loader2, Send, Sparkles, Trash2, User,
} from "lucide-react";
import { useDialog } from "@/components/ui/DialogProvider";
import { CONVERSATION_STATUS, INTENT_LABELS, conversationLabel } from "@/libs/sales/conversation/status";
import { REPLY_ESCALATION_LABELS } from "@/libs/sales/conversation/decide";

const KIND_LABEL = { outreach: "First email", reply: "Reply", follow_up: "Follow-up", inbound: "" };
const when = (d) => (d ? new Date(d).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");

function Draft({ draft, onChanged }) {
  const { confirm } = useDialog();
  const [form, setForm] = useState({ toAddress: draft.toAddress || "", subject: draft.subject || "", body: draft.body });
  const [busy, setBusy] = useState(null);
  const dirty = form.toAddress !== (draft.toAddress || "") || form.subject !== (draft.subject || "") || form.body !== draft.body;
  const meta = draft.meta || {};
  const escalations = (meta.escalations || []).filter((e) => REPLY_ESCALATION_LABELS[e]);

  const save = async () => {
    const res = await fetch(`/api/sales/conversations/drafts/${draft.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not save");
  };

  const send = async () => {
    setBusy("send");
    try {
      if (dirty) await save();
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
    <div className="rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 p-3 space-y-2 ml-auto w-full md:w-[90%]">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="badge badge-primary badge-sm">Draft {draft.kind === "follow_up" ? `follow-up ${meta.number || ""}` : "reply"}</span>
        <span className="text-base-content/60">Not sent yet: check it, edit if you like, then send.</span>
      </div>
      {escalations.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {escalations.map((e) => <span key={e} className="badge badge-warning badge-sm gap-1"><AlertTriangle className="h-3 w-3" /> {REPLY_ESCALATION_LABELS[e]}</span>)}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <input className="input input-bordered input-sm" placeholder="name@company.com" value={form.toAddress} onChange={(e) => setForm({ ...form, toAddress: e.target.value })} />
        <input className="input input-bordered input-sm" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
      </div>
      <textarea className="textarea textarea-bordered w-full text-sm leading-relaxed min-h-[11rem]" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
      {meta.passages?.length > 0 && (
        <p className="text-xs text-base-content/60 flex items-center gap-1"><BookOpen className="h-3.5 w-3.5" /> From your knowledge base: {meta.passages.map((p) => p.title).join(", ")}</p>
      )}
      {meta.plan === "confirm" && <p className="text-xs text-success flex items-center gap-1"><CalendarCheck className="h-3.5 w-3.5" /> Sending books the meeting and attaches a calendar invite.</p>}
      {meta.plan === "offer" && meta.slots?.length > 0 && <p className="text-xs text-base-content/60 flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> Offers {meta.slots.length} times from your meeting hours.</p>}
      <div className="flex justify-end gap-2">
        <button className="btn btn-ghost btn-sm gap-1" disabled={Boolean(busy)} onClick={discard}><Trash2 className="h-4 w-4" /> Discard</button>
        <button className="btn btn-primary btn-sm gap-1" disabled={Boolean(busy) || !form.body.trim() || !form.toAddress.trim()} onClick={send}>
          {busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {dirty ? "Save & send" : "Send"}
        </button>
      </div>
    </div>
  );
}

function Bubble({ m }) {
  const mine = m.direction === "out";
  const reading = m.meta?.reading;
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[90%] md:max-w-[80%] rounded-2xl px-4 py-3 space-y-1.5 ${mine ? "bg-primary/10 rounded-br-sm" : "bg-base-200 rounded-bl-sm"}`}>
        <div className="flex flex-wrap items-center gap-2 text-xs text-base-content/60">
          <span className="font-semibold text-base-content/80">{mine ? (m.meta?.writtenBy === "user" ? "You" : KIND_LABEL[m.kind] || "Us") : m.meta?.fromName || m.fromAddress}</span>
          {mine && m.kind === "follow_up" && m.meta?.number && <span>{m.meta.number} of {m.meta.total}</span>}
          {!mine && m.intent && <span className="badge badge-info badge-xs">{INTENT_LABELS[m.intent] || m.intent}</span>}
          <time>{when(m.sentAt || m.receivedAt || m.createdAt)}</time>
          {mine && m.meta?.testRedirectedTo && <span title="Test mode redirected this email">test → {m.meta.testRedirectedTo}</span>}
        </div>
        {m.subject && m.kind === "outreach" && <p className="text-sm font-medium">{m.subject}</p>}
        <p className="text-sm whitespace-pre-line leading-relaxed">{m.body}</p>
        {!mine && reading?.questions?.length > 0 && (
          <p className="text-xs text-base-content/60">Asked: {reading.questions.join(" · ")}</p>
        )}
        {!mine && m.meta?.note && <p className="text-xs text-base-content/50">{m.meta.note}</p>}
      </div>
    </div>
  );
}

function MeetingNote({ meeting, timeZone }) {
  if (!meeting) return null;
  const tz = meeting.timezone || timeZone;
  const fmt = (d) => new Date(d).toLocaleString("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return (
    <div className={`rounded-lg p-3 text-sm flex items-start gap-2 ${meeting.status === "confirmed" ? "bg-success/10" : "bg-warning/10"}`}>
      <CalendarCheck className="h-4 w-4 mt-0.5 shrink-0" />
      <div>
        {meeting.status === "confirmed" ? (
          <p><span className="font-semibold">Meeting booked:</span> {fmt(meeting.startAt)} ({tz})</p>
        ) : meeting.status === "proposed" ? (
          <p><span className="font-semibold">Times offered:</span> {(meeting.proposedSlots || []).map((s) => fmt(s.start)).join(" · ")}</p>
        ) : (
          <p><span className="font-semibold">Meeting {meeting.status.replace("_", " ")}</span>{meeting.startAt && `: ${fmt(meeting.startAt)}`}</p>
        )}
        <a href="/dashboard/sales/meetings" className="link link-primary text-xs">Open meetings</a>
      </div>
    </div>
  );
}

/** One lead's whole email thread, with drafts to send and ways to answer. */
export default function ConversationThread({ leadId, onChanged }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const [own, setOwn] = useState("");
  const [showOwn, setShowOwn] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/sales/conversations/${leadId}`);
    const json = await res.json();
    if (res.ok) setData(json);
    else toast.error(json.error || "Could not load the conversation");
  }, [leadId]);

  useEffect(() => {
    setData(null);
    setOwn("");
    setShowOwn(false);
    load();
  }, [load]);

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
      const res = await fetch(`/api/sales/conversations/${leadId}/send`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: own }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not send");
      toast.success("Sent");
      setOwn("");
      setShowOwn(false);
      changed();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const setStatus = async (status) => {
    const res = await fetch(`/api/sales/conversations/${leadId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    });
    if (res.ok) changed();
    else toast.error("Could not update it");
  };

  if (!data) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  const { lead, thread, meetings = [] } = data;
  const sent = thread.filter((m) => m.status !== "draft");
  const drafts = thread.filter((m) => m.status === "draft");
  const lastIn = [...sent].reverse().find((m) => m.direction === "in");
  const lastIsTheirs = sent.length && sent[sent.length - 1].direction === "in";
  const status = conversationLabel(lead.status);
  const openMeeting = meetings.find((m) => ["proposed", "confirmed"].includes(m.status)) || meetings[0];
  const closed = [CONVERSATION_STATUS.NOT_INTERESTED, CONVERSATION_STATUS.UNSUBSCRIBED, CONVERSATION_STATUS.NO_RESPONSE].includes(lead.status);
  const LeadIcon = lead.source === "linkedin" ? User : Building2;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start gap-3 border-b border-base-300 pb-3">
        <LeadIcon className="h-5 w-5 mt-1 opacity-50" />
        <div className="flex-1 min-w-[12rem]">
          <h2 className="font-semibold text-lg flex flex-wrap items-center gap-2">
            {lead.company || lead.name}
            <span className={`badge badge-sm ${status.tone}`}>{status.label}</span>
            {lead.fit?.score != null && <span className="badge badge-ghost badge-sm">Fit {lead.fit.score}</span>}
          </h2>
          <p className="text-xs text-base-content/60">
            {lead.campaignName}
            {lead.website && <> · <a href={lead.website} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-0.5">website <ExternalLink className="h-3 w-3" /></a></>}
          </p>
          {lead.nextFollowUpAt && !closed && (
            <p className="text-xs text-base-content/60 flex items-center gap-1 mt-1"><Clock className="h-3 w-3" /> Next follow-up if they stay quiet: {when(lead.nextFollowUpAt)}</p>
          )}
        </div>
        <select className="select select-bordered select-xs" value="" onChange={(e) => e.target.value && setStatus(e.target.value)}>
          <option value="">Change status…</option>
          {closed && <option value={CONVERSATION_STATUS.IN_CONVERSATION}>Re-open the conversation</option>}
          {!closed && <option value={CONVERSATION_STATUS.NOT_INTERESTED}>Mark not interested (stop emails)</option>}
          {!closed && <option value={CONVERSATION_STATUS.NO_RESPONSE}>Stop following up</option>}
          <option value={CONVERSATION_STATUS.UNSUBSCRIBED}>They asked us to stop</option>
        </select>
      </header>

      <MeetingNote meeting={openMeeting} />

      <div className="space-y-3">
        {sent.map((m) => <Bubble key={m.id} m={m} />)}
        {drafts.map((d) => <Draft key={d.id} draft={d} onChanged={changed} />)}
      </div>

      {lastIsTheirs && !drafts.length && lead.status !== CONVERSATION_STATUS.UNSUBSCRIBED && (
        <div className="rounded-xl border border-base-300 p-3 space-y-2">
          <p className="text-sm">
            {lastIn?.handledAt ? "This reply hasn't been answered." : "The agent answers this on its next run. Or answer it now:"}
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary btn-sm gap-1" disabled={Boolean(busy)} onClick={draftWithAi}>
              {busy === "ai" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Write a reply with AI
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowOwn((v) => !v)}>Write my own</button>
          </div>
        </div>
      )}
      {(showOwn || (!lastIsTheirs && !drafts.length)) && (
        <details className="rounded-xl border border-base-300 p-3" open={showOwn}>
          <summary className="cursor-pointer text-sm font-medium">Write to them yourself</summary>
          <div className="mt-2 space-y-2">
            <textarea className="textarea textarea-bordered w-full text-sm min-h-[8rem]" placeholder="Your message. It goes in the same email thread." value={own} onChange={(e) => setOwn(e.target.value)} />
            <div className="flex justify-end">
              <button className="btn btn-primary btn-sm gap-1" disabled={busy === "own" || !own.trim()} onClick={sendOwn}>
                {busy === "own" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
              </button>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
