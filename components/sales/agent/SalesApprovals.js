"use client";

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, Building2, Check, Linkedin, Loader2, Mail, User, X } from "lucide-react";

const ACTION_ICON = { send_email: Mail, send_invite: Linkedin, send_linkedin_message: Linkedin };
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());

function ApprovalCard({ item, onDone }) {
  const { message } = item;
  const [draft, setDraft] = useState({ recipient: message?.recipient || "", subject: message?.subject || "", content: message?.content || "" });
  const [busy, setBusy] = useState(false);
  const isEmailAction = item.action === "send_email";
  const dirty = message && (draft.recipient !== (message.recipient || "") || draft.subject !== (message.subject || "") || draft.content !== (message.content || ""));
  const canApprove = draft.content.trim() && (!isEmailAction || isEmail(draft.recipient));
  const Icon = ACTION_ICON[item.action] || Mail;
  const LeadIcon = item.lead.source === "linkedin" ? User : Building2;

  const decide = async (decision) => {
    setBusy(true);
    try {
      // Edits go into the message first, so what is approved is exactly what gets sent
      if (decision === "approve" && dirty) {
        const res = await fetch(`/api/sales/messages/${message.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
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

      {message ? (
        <div className="space-y-2">
          <label className="form-control">
            <span className="label-text text-xs mb-1">{isEmailAction ? "To (email address)" : "To (LinkedIn profile)"}</span>
            <input className="input input-bordered input-sm" placeholder={isEmailAction ? "name@company.com" : ""} value={draft.recipient} onChange={(e) => setDraft({ ...draft, recipient: e.target.value })} />
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

      <div className="flex flex-wrap justify-end gap-2">
        <button className="btn btn-ghost btn-sm gap-1" disabled={busy} onClick={() => decide("reject")}><X className="h-4 w-4" /> Don&apos;t send</button>
        <button className="btn btn-success btn-sm gap-1" disabled={busy || !canApprove} onClick={() => decide("approve")} title={canApprove ? "" : "Add an email address first"}>
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
    onCountChange?.((data.items || []).length);
  }, [onCountChange]);

  useEffect(() => {
    load().catch(() => setItems([]));
  }, [load]);

  const removeItem = (id) =>
    setItems((prev) => {
      const next = prev.filter((i) => i.id !== id);
      onCountChange?.(next.length);
      return next;
    });

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
