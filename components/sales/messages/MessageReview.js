"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { Building2, Check, Linkedin, Loader2, Mail, RotateCcw, Save, Sparkles, User } from "lucide-react";
import { PLATFORM_KIND, stageHref } from "@/libs/sales/stages";
import { companyNameOf, jobsOf } from "@/libs/sales/companies";

const LINKEDIN_MAX = 600;

const STATE = {
  none: { label: "No message", dot: "bg-base-300", badge: "badge-ghost" },
  draft: { label: "Draft", dot: "bg-warning", badge: "badge-warning" },
  approved: { label: "Approved", dot: "bg-success", badge: "badge-success" },
  sent: { label: "Sent", dot: "bg-primary", badge: "badge-primary" },
};

const stateOf = (item) => (item.message ? STATE[item.message.status] ? item.message.status : "draft" : "none");

const FILTERS = [
  { value: "all", label: "All" },
  { value: "none", label: "No message" },
  { value: "draft", label: "Drafts" },
  { value: "approved", label: "Approved" },
  { value: "sent", label: "Sent" },
];

function leadLabel(lead, isCompany) {
  return isCompany ? companyNameOf(lead) || "Unknown company" : lead.name || "Profile not read yet";
}

function Editor({ item, isCompany, campaignId, busy, onGenerate, onSave }) {
  const { lead, message } = item;
  const [draft, setDraft] = useState({ content: "", subject: "", recipient: "" });
  const research = lead.sourceData?.research;

  useEffect(() => {
    setDraft({ content: message?.content || "", subject: message?.subject || "", recipient: message?.recipient || "" });
  }, [message]);

  const channel = message?.channel || "linkedin";
  const dirty =
    message && (draft.content !== (message.content || "") || draft.subject !== (message.subject || "") || draft.recipient !== (message.recipient || ""));
  const locked = message?.status === "sent";
  const notReady = !isCompany && lead.status !== "completed";
  const tooLong = channel === "linkedin" && draft.content.length > LINKEDIN_MAX;

  return (
    <div className="rounded-xl border border-base-300 bg-base-100 p-4 space-y-4">
      <header className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-[12rem]">
          <h3 className="font-semibold">{leadLabel(lead, isCompany)}</h3>
          <p className="text-xs text-base-content/60">
            {isCompany
              ? `Hiring for: ${jobsOf(lead).map((j) => j.title).filter(Boolean).slice(0, 4).join(", ") || "—"}`
              : [lead.title, lead.company].filter(Boolean).join(" · ") || lead.url}
          </p>
        </div>
        <span className={`badge badge-sm ${STATE[stateOf(item)].badge}`}>{STATE[stateOf(item)].label}</span>
      </header>

      {notReady ? (
        <p className="text-sm text-base-content/70">
          This person&apos;s profile hasn&apos;t been read yet, so there is nothing to personalise from.{" "}
          <Link href={stageHref("research", { campaignId, platform: "linkedin" })} className="link link-primary">Read it in Research</Link>.
        </p>
      ) : !message ? (
        <div className="text-sm text-base-content/70 space-y-3">
          {isCompany && !research && (
            <p>
              This company hasn&apos;t been researched, so the message can only use its job posts.{" "}
              <Link href={stageHref("research", { campaignId, platform: lead.source })} className="link link-primary">Research it first</Link> for a better message.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {isCompany ? (
              <>
                <button className="btn btn-primary btn-sm gap-1" disabled={busy} onClick={() => onGenerate(lead, "email")}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Write an email
                </button>
                <button className="btn btn-outline btn-sm gap-1" disabled={busy || !research?.decisionMakers?.length} onClick={() => onGenerate(lead, "linkedin")} title={research?.decisionMakers?.length ? "" : "No decision-maker found in Research"}>
                  <Linkedin className="h-4 w-4" /> Write a LinkedIn note
                </button>
              </>
            ) : (
              <button className="btn btn-primary btn-sm gap-1" disabled={busy} onClick={() => onGenerate(lead)}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Write message
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {isCompany && (
            <div className="flex flex-wrap items-end gap-3">
              <div role="tablist" className="join">
                {["email", "linkedin"].map((c) => (
                  <button
                    key={c}
                    role="tab"
                    aria-selected={channel === c}
                    className={`btn btn-xs join-item gap-1 ${channel === c ? "btn-primary" : "btn-ghost bg-base-200"}`}
                    disabled={busy || locked || channel === c || (c === "linkedin" && !research?.decisionMakers?.length)}
                    onClick={() => onGenerate(lead, c)}
                    title={c === "linkedin" && !research?.decisionMakers?.length ? "No decision-maker found in Research" : `Rewrite as ${c}`}
                  >
                    {c === "email" ? <Mail className="h-3 w-3" /> : <Linkedin className="h-3 w-3" />} {c === "email" ? "Email" : "LinkedIn"}
                  </button>
                ))}
              </div>
              <label className="form-control flex-1 min-w-[14rem]">
                <span className="label-text text-xs mb-1">{channel === "email" ? "To (email address)" : "To (LinkedIn profile)"}</span>
                <input
                  className="input input-bordered input-sm"
                  placeholder={channel === "email" ? "name@company.com" : "https://www.linkedin.com/in/…"}
                  value={draft.recipient}
                  disabled={locked}
                  onChange={(e) => setDraft({ ...draft, recipient: e.target.value })}
                />
              </label>
            </div>
          )}
          {channel === "email" && (
            <label className="form-control">
              <span className="label-text text-xs mb-1">Subject</span>
              <input className="input input-bordered input-sm" value={draft.subject} disabled={locked} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
            </label>
          )}
          <label className="form-control">
            <span className="label-text text-xs mb-1 flex justify-between">
              <span>Message</span>
              {channel === "linkedin" && (
                <span className={tooLong ? "text-error" : "text-base-content/50"}>
                  {draft.content.length}/{LINKEDIN_MAX}
                </span>
              )}
            </span>
            <textarea
              className="textarea textarea-bordered text-sm leading-relaxed min-h-[14rem]"
              value={draft.content}
              disabled={locked}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            />
          </label>
          {isCompany && channel === "email" && !draft.recipient && (
            <p className="text-xs text-warning">No email address was found for this company. Add one before approving.</p>
          )}
          {!locked && (
            <div className="flex flex-wrap justify-end gap-2">
              <button className="btn btn-ghost btn-sm gap-1" disabled={busy} onClick={() => onGenerate(lead, isCompany ? channel : undefined)}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Rewrite
              </button>
              {dirty && (
                <button className="btn btn-outline btn-sm gap-1" disabled={busy} onClick={() => onSave(message, draft)}>
                  <Save className="h-4 w-4" /> Save
                </button>
              )}
              {message.status === "approved" && !dirty ? (
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onSave(message, {}, "draft")}>
                  Back to draft
                </button>
              ) : (
                <button
                  className="btn btn-success btn-sm gap-1"
                  disabled={busy || tooLong || !draft.content.trim() || (isCompany && !draft.recipient.trim())}
                  onClick={() => onSave(message, dirty ? draft : {}, "approved")}
                >
                  <Check className="h-4 w-4" /> {dirty ? "Save & approve" : "Approve"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Messages step: one AI message per lead, reviewed and approved before anything is sent. */
export default function MessageReview({ campaignId, platform }) {
  const isCompany = PLATFORM_KIND[platform] === "company";
  const [items, setItems] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [filter, setFilter] = useState("all");
  const [busyIds, setBusyIds] = useState(new Set());
  const [batch, setBatch] = useState(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/sales/messages?campaignId=${campaignId}&platform=${platform}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setItems(data.items);
    setSelectedId((id) => id || data.items[0]?.lead.id || null);
  }, [campaignId, platform]);

  useEffect(() => {
    setItems(null);
    load().catch((err) => {
      toast.error(err.message || "Could not load messages");
      setItems([]);
    });
  }, [load]);

  const setBusy = (id, on) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const putMessage = (leadId, message) => setItems((prev) => prev.map((it) => (it.lead.id === leadId ? { ...it, message } : it)));

  const generate = async (lead, channel, { quiet = false } = {}) => {
    setBusy(lead.id, true);
    try {
      const res = await fetch("/api/sales/messages/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, channel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not write the message");
      putMessage(lead.id, data.message);
      return true;
    } catch (err) {
      if (!quiet) toast.error(err.message);
      return false;
    } finally {
      setBusy(lead.id, false);
    }
  };

  const save = async (message, changes, status) => {
    setBusy(message.leadId, true);
    try {
      const res = await fetch(`/api/sales/messages/${message.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...changes, ...(status ? { status } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save");
      putMessage(message.leadId, data.message);
      if (status === "approved") toast.success("Approved");
      return true;
    } catch (err) {
      toast.error(err.message);
      return false;
    } finally {
      setBusy(message.leadId, false);
    }
  };

  const runBatch = async (todo, action, doneText) => {
    if (!todo.length) return;
    setBatch({ done: 0, total: todo.length });
    let ok = 0;
    const queue = [...todo];
    const worker = async () => {
      while (queue.length) {
        if (await action(queue.shift())) ok++;
        setBatch((b) => b && { ...b, done: b.done + 1 });
      }
    };
    await Promise.all([worker(), worker()]);
    setBatch(null);
    toast.success(`${doneText}: ${ok} of ${todo.length}`);
  };

  const ready = (it) => isCompany || it.lead.status === "completed";
  const writeMissing = () => runBatch(items.filter((it) => !it.message && ready(it)), (it) => generate(it.lead, undefined, { quiet: true }), "Messages written");
  const approveDrafts = () =>
    runBatch(
      items.filter((it) => it.message?.status === "draft" && (!isCompany || it.message.recipient)),
      (it) => save(it.message, {}, "approved"),
      "Approved"
    );

  const counts = useMemo(() => {
    const c = { all: items?.length || 0, none: 0, draft: 0, approved: 0, sent: 0 };
    for (const it of items || []) c[stateOf(it)]++;
    return c;
  }, [items]);

  if (!items) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!items.length) {
    return <p className="text-sm text-base-content/60 rounded-lg border border-dashed border-base-300 p-6 text-center">No leads from this platform yet. Add some in step 2.</p>;
  }

  const visible = items.filter((it) => filter === "all" || stateOf(it) === filter);
  const selected = items.find((it) => it.lead.id === selectedId) || visible[0];
  const missingReady = items.filter((it) => !it.message && ready(it)).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button key={f.value} className={`btn btn-xs !normal-case ${filter === f.value ? "btn-primary" : "btn-ghost bg-base-200"}`} onClick={() => setFilter(f.value)}>
              {f.label} <span className="opacity-70">{counts[f.value]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-sm btn-outline gap-1" disabled={Boolean(batch) || !missingReady} onClick={writeMissing}>
            <Sparkles className="h-4 w-4" /> Write {missingReady || ""} missing
          </button>
          <button className="btn btn-sm btn-success gap-1" disabled={Boolean(batch) || !counts.draft} onClick={approveDrafts}>
            <Check className="h-4 w-4" /> Approve all drafts
          </button>
        </div>
      </div>
      {batch && (
        <div className="flex items-center gap-3 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-primary" /> {batch.done} of {batch.total}
          <progress className="progress progress-primary flex-1" value={batch.done} max={batch.total} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <ul className="rounded-xl border border-base-300 bg-base-100 divide-y divide-base-300 max-h-[70vh] overflow-y-auto">
          {visible.map((it) => {
            const active = selected?.lead.id === it.lead.id;
            const Icon = isCompany ? Building2 : User;
            return (
              <li key={it.lead.id}>
                <button
                  className={`w-full text-left px-3 py-2.5 flex items-center gap-2 hover:bg-base-200 ${active ? "bg-primary/10" : ""}`}
                  onClick={() => setSelectedId(it.lead.id)}
                  aria-current={active ? "true" : undefined}
                >
                  <Icon className="h-4 w-4 shrink-0 opacity-50" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm truncate font-medium">{leadLabel(it.lead, isCompany)}</span>
                    <span className="block text-xs text-base-content/50 truncate">
                      {it.message ? `${it.message.channel === "email" ? "Email" : "LinkedIn"} · ${STATE[stateOf(it)].label}` : STATE.none.label}
                    </span>
                  </span>
                  {busyIds.has(it.lead.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className={`h-2.5 w-2.5 rounded-full ${STATE[stateOf(it)].dot}`} />}
                </button>
              </li>
            );
          })}
          {!visible.length && <li className="p-4 text-sm text-base-content/50 text-center">Nothing here</li>}
        </ul>

        {selected && (
          <Editor
            key={selected.lead.id}
            item={selected}
            isCompany={isCompany}
            campaignId={campaignId}
            busy={busyIds.has(selected.lead.id)}
            onGenerate={generate}
            onSave={save}
          />
        )}
      </div>
    </div>
  );
}
