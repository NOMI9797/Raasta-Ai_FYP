"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, BookOpen, Building2, CalendarClock, Check, Linkedin, Loader2, Mail, MessageSquareReply, RefreshCw, User, X } from "lucide-react";
import { INTENT_LABELS } from "@/libs/sales/conversation/status";

const ACTION_ICON = { send_email: Mail, send_invite: Linkedin, send_linkedin_message: Linkedin, send_reply: MessageSquareReply, send_follow_up: Mail };
const EMAIL_ACTIONS = ["send_email", "send_reply", "send_follow_up"];
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());

function ApprovalCard({ item, onDone }) {
  const { message } = item;
  const [draft, setDraft] = useState({ recipient: message?.recipient || "", subject: message?.subject || "", content: message?.content || "" });
  const [saved, setSaved] = useState(message); // what the database holds (changes when regenerated)
  const [busy, setBusy] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [needsAddress, setNeedsAddress] = useState(false);
  const recipientRef = useRef(null);
  // A reply or follow-up in a LinkedIn conversation goes to their profile, not an email address
  const isEmailAction = EMAIL_ACTIONS.includes(item.action) && message?.channel !== "linkedin";
  const isConversation = message?.kind === "conversation";
  const dirty = saved && (draft.recipient !== (saved.recipient || "") || draft.subject !== (saved.subject || "") || draft.content !== (saved.content || ""));
  const missingAddress = isEmailAction && !isEmail(draft.recipient);
  // First messages can be rewritten; replies and follow-ups carry the meeting times offered, so they're edited by hand
  const canRegenerate = Boolean(message) && !isConversation && Boolean(item.lead?.id);
  const Icon = ACTION_ICON[item.action] || Mail;
  const LeadIcon = item.lead.source === "linkedin" ? User : Building2;

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const res = await fetch("/api/sales/messages/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: item.lead.id, channel: saved?.channel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not rewrite the message");
      const m = data.message;
      setSaved({ ...saved, recipient: m.recipient, subject: m.subject, content: m.content });
      // An address you typed is kept when the AI still has none
      setDraft((d) => ({ recipient: m.recipient || d.recipient, subject: m.subject || "", content: m.content || "" }));
      toast.success("Rewritten: check it, then approve");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRegenerating(false);
    }
  };

  const decide = async (decision) => {
    if (decision === "approve" && missingAddress) {
      setNeedsAddress(true);
      recipientRef.current?.focus();
      toast.error("Add the email address to send it to, then approve");
      return;
    }
    if (decision === "approve" && !draft.content.trim()) {
      toast.error("The message is empty");
      return;
    }
    setBusy(true);
    try {
      // Edits go into the message first, so what is approved is exactly what gets sent
      if (decision === "approve" && dirty) {
        // Replies and follow-ups live in the lead's thread; first emails on the Messages step
        const res = await fetch(isConversation ? `/api/sales/conversations/drafts/${message.id}` : `/api/sales/messages/${message.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(isConversation ? { toAddress: draft.recipient, subject: draft.subject, body: draft.content } : draft),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not save the message");
      }
      const res = await fetch(`/api/agents/actions/${item.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save your decision");
      toast.success(decision === "approve" ? "Approved: the agent sends it in a moment" : "Rejected: it won't be sent");
      onDone(item.id);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-xl border border-base-300 bg-base-100 p-4 space-y-3">
      <header className="flex flex-wrap items-start gap-3">
        <LeadIcon className="h-5 w-5 mt-0.5 opacity-50 shrink-0" />
        <div className="flex-1 min-w-[12rem]">
          <h3 className="font-semibold flex items-center gap-2">
            {item.lead.source === "linkedin" ? item.lead.name : item.lead.company || item.lead.name}
            <span className="badge badge-ghost badge-sm gap-1 font-normal"><Icon className="h-3 w-3" /> {item.actionLabel}</span>
          </h3>
          <p className="text-xs text-base-content/60">{item.campaignName}</p>
        </div>
        {item.fit && (
          <div className="text-right max-w-xs">
            <span className={`badge badge-sm ${item.fit.score >= 70 ? "badge-success" : item.fit.score >= 50 ? "badge-warning" : "badge-error"}`}>Fit {item.fit.score}</span>
            {item.fit.reason && <p className="text-xs text-base-content/60 mt-1">{item.fit.reason}</p>}
          </div>
        )}
      </header>

      {item.escalations.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {item.escalations.map((e) => (
            <span key={e.key} className="badge badge-warning badge-sm gap-1"><AlertTriangle className="h-3 w-3" /> {e.label}</span>
          ))}
        </div>
      )}

      {item.conversation?.theyWrote && (
        <div className="rounded-lg bg-base-200/70 p-3 text-sm space-y-1">
          <p className="text-xs font-semibold text-base-content/60">
            They wrote{item.conversation.intent && <span className="badge badge-ghost badge-xs ml-2">{INTENT_LABELS[item.conversation.intent] || item.conversation.intent}</span>}
          </p>
          <p className="whitespace-pre-line line-clamp-6">{item.conversation.theyWrote}</p>
        </div>
      )}
      {item.conversation?.slots?.length > 0 && (
        <p className="text-xs text-base-content/60 flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> Offers {item.conversation.slots.length} meeting times; the meeting is listed once they pick one.</p>
      )}
      {item.conversation?.plan === "confirm" && (
        <p className="text-xs text-success flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> Approving books the meeting and sends a calendar invite.</p>
      )}

      {message ? (
        <div className="space-y-2">
          <label className="form-control">
            <span className="label-text text-xs mb-1">{isEmailAction ? "To (email address)" : "To (LinkedIn profile)"}</span>
            <input
              ref={recipientRef}
              className={`input input-bordered input-sm ${needsAddress && missingAddress ? "input-error" : ""}`}
              placeholder={isEmailAction ? "name@company.com" : ""}
              value={draft.recipient}
              onChange={(e) => setDraft({ ...draft, recipient: e.target.value })}
            />
            {needsAddress && missingAddress && <span className="label-text-alt text-error mt-1">Type the address this email goes to</span>}
          </label>
          {isEmailAction && (
            <label className="form-control">
              <span className="label-text text-xs mb-1">Subject</span>
              <input className="input input-bordered input-sm" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
            </label>
          )}
          <textarea className="textarea textarea-bordered w-full text-sm leading-relaxed min-h-[10rem]" value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
        </div>
      ) : (
        <p className="text-sm text-base-content/60">{item.summary}</p>
      )}

      {item.conversation?.passages?.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-base-content/60 flex items-center gap-1"><BookOpen className="h-3.5 w-3.5" /> From your knowledge base: {item.conversation.passages.map((p) => p.title).join(", ")}</summary>
          <ul className="mt-2 space-y-1.5">
            {item.conversation.passages.map((p) => (
              <li key={p.id} className="rounded border border-base-300 p-2"><span className="font-medium">{p.title}</span><p className="text-base-content/70 whitespace-pre-line">{p.excerpt}</p></li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {canRegenerate && (
          <button className="btn btn-ghost btn-sm gap-1 mr-auto" disabled={busy || regenerating} onClick={regenerate} title="Ask the AI to write this message again">
            {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Regenerate
          </button>
        )}
        <button className="btn btn-ghost btn-sm gap-1" disabled={busy || regenerating} onClick={() => decide("reject")}><X className="h-4 w-4" /> Don&apos;t send</button>
        <button className="btn btn-success btn-sm gap-1" disabled={busy || regenerating} onClick={() => decide("approve")} title={missingAddress ? "Add an email address first" : ""}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {dirty ? "Save & approve" : "Approve"}
        </button>
      </div>
    </article>
  );
}

/** The sales agent's requests waiting for a decision. */
export default function SalesApprovals({ onCountChange }) {
  const [items, setItems] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/sales/agent/inbox");
    const data = await res.json();
    setItems(data.items || []);
  }, []);

  useEffect(() => {
    load().catch(() => setItems([]));
  }, [load]);

  // The page's tab badge follows the list (told after rendering, not while updating the list)
  useEffect(() => {
    if (items) onCountChange?.(items.length);
  }, [items, onCountChange]);

  const removeItem = (id) => setItems((prev) => prev.filter((i) => i.id !== id));

  const clean = (items || []).filter((i) => i.escalations.length === 0);
  const approveClean = async () => {
    setBulkBusy(true);
    try {
      const res = await fetch("/api/agents/actions/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: clean.map((i) => i.id), decision: "approve" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Approved ${data.decided}`);
      await load();
    } catch (err) {
      toast.error(err.message || "Could not approve");
    } finally {
      setBulkBusy(false);
    }
  };

  if (!items) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }
  if (!items.length) {
    return (
      <div className="rounded-xl border border-dashed border-base-300 p-10 text-center">
        <Check className="h-8 w-8 mx-auto text-success" />
        <p className="font-semibold mt-2">Nothing waiting for you</p>
        <p className="text-sm text-base-content/60">When the agent wants to send something in Semi-auto, or something needs a look, it shows up here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          <span className="font-semibold">{items.length}</span> waiting for you. Check each message, edit it if you like, then approve or skip it.
        </p>
        {clean.length > 0 && (
          <button className="btn btn-success btn-sm gap-1" disabled={bulkBusy} onClick={approveClean}>
            {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve {clean.length} without warnings
          </button>
        )}
      </div>
      {items.map((item) => <ApprovalCard key={item.id} item={item} onDone={removeItem} />)}
    </div>
  );
}
