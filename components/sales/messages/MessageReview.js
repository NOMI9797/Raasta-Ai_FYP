"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { AlertTriangle, Building2, Check, Globe, Linkedin, Loader2, Mail, Phone, RotateCcw, Save, Sparkles, User, UserX } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { PLATFORM_KIND, stageHref } from "@/libs/sales/stages";
import { companyNameOf, jobsOf } from "@/libs/sales/companies";
import { CONTACT_ROUTE_LABELS, contactRoute } from "@/libs/sales/contact-route";

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

// Companies are sorted after research by how they can be reached (libs/sales/contact-route.js)
const SECTIONS = [
  { value: "email", label: "Email", icon: Mail, hint: "An email address was found" },
  { value: "linkedin", label: "LinkedIn", icon: Linkedin, hint: "No email, but a decision-maker on LinkedIn" },
  { value: "no_contact", label: "No contact", icon: UserX, hint: "Nothing found: no message is written until you add a contact" },
  { value: "unresearched", label: "Not researched", icon: AlertTriangle, hint: "Research them first (step 3)" },
];
const sectionOf = (item) => contactRoute(item.lead, item.message) || "unresearched";

/** A company with no email or LinkedIn contact: no message, just the way to move it to Email or LinkedIn. */
function NoContactPanel({ item, onMoved }) {
  const { lead } = item;
  const research = lead.sourceData?.research || {};
  const [channel, setChannel] = useState("email");
  const [form, setForm] = useState({ address: "", name: "", title: "" });
  const [busy, setBusy] = useState(false);

  const move = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/sales/companies/${lead.id}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, ...form }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not add the contact");
      toast.success(`Moved to ${CONTACT_ROUTE_LABELS[channel]}: the ${channel === "email" ? "email" : "LinkedIn message"} is written`);
      onMoved(data.lead, data.message, channel);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const searchName = encodeURIComponent(companyNameOf(lead) || "");
  return (
    <div className="rounded-xl border border-base-300 bg-base-100 p-4 space-y-4">
      <header>
        <h3 className="font-semibold flex items-center gap-2">{companyNameOf(lead)} <span className="badge badge-ghost badge-sm gap-1"><UserX className="h-3 w-3" /> No contact</span></h3>
        <p className="text-xs text-base-content/60">Hiring for: {jobsOf(lead).map((j) => j.title).filter(Boolean).slice(0, 4).join(", ") || "—"}</p>
      </header>

      <div className="rounded-lg bg-base-200/60 p-3 text-sm space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-base-content/50">What research found</p>
        {research.website ? (
          <a href={research.website} target="_blank" rel="noopener noreferrer" className="link link-primary flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" /> {research.website.replace(/^https?:\/\//, "")}</a>
        ) : <p className="flex items-center gap-1.5 text-base-content/60"><Globe className="h-3.5 w-3.5" /> No website</p>}
        {(research.phones || []).map((p) => <p key={p} className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" /> {p} <span className="text-xs text-base-content/50">(call or WhatsApp)</span></p>)}
        <p className="text-xs text-base-content/60">No email address and no one on LinkedIn, so nothing was written. Find a contact and move the company:</p>
        <p className="flex flex-wrap gap-3 text-xs">
          <a className="link" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/search?q=${searchName}+email+Pakistan`}>Search the web for its email</a>
          <a className="link" target="_blank" rel="noopener noreferrer" href={`https://www.linkedin.com/search/results/people/?keywords=${searchName}%20CEO%20OR%20HR`}>Find its people on LinkedIn</a>
        </p>
      </div>

      <div className="space-y-2">
        <div role="tablist" className="join">
          {["email", "linkedin"].map((c) => (
            <button key={c} role="tab" aria-selected={channel === c} className={`btn btn-sm join-item gap-1 ${channel === c ? "btn-primary" : "btn-ghost bg-base-200"}`} onClick={() => setChannel(c)} disabled={busy}>
              {c === "email" ? <Mail className="h-4 w-4" /> : <Linkedin className="h-4 w-4" />} Move to {CONTACT_ROUTE_LABELS[c]}
            </button>
          ))}
        </div>
        <label className="form-control">
          <span className="label-text text-xs mb-1">{channel === "email" ? "Email address" : "LinkedIn profile link"}</span>
          <input
            className="input input-bordered input-sm"
            placeholder={channel === "email" ? "hr@company.com" : "https://www.linkedin.com/in/name"}
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </label>
        {channel === "linkedin" && (
          <div className="grid gap-2 sm:grid-cols-2">
            <input className="input input-bordered input-sm" placeholder="Their name (optional)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="input input-bordered input-sm" placeholder="Their role, e.g. CEO (optional)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
        )}
        <div className="flex justify-end">
          <button className="btn btn-primary btn-sm gap-1" disabled={busy || !form.address.trim()} onClick={move}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Move and write the {channel === "email" ? "email" : "LinkedIn message"}
          </button>
        </div>
      </div>
    </div>
  );
}

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
  const searchParams = useSearchParams();
  const [section, setSection] = useState(SECTIONS.some((x) => x.value === searchParams.get("view")) ? searchParams.get("view") : "email");
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
      // Switched to the other channel by hand: follow the company to its new section
      if (!quiet && isCompany) {
        const next = contactRoute(lead, data.message);
        if (next) setSection(next);
      }
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

  // Companies with no contact aren't written to (they're moved to Email or LinkedIn by hand)
  const ready = (it) => (isCompany ? ["email", "linkedin"].includes(sectionOf(it)) : it.lead.status === "completed");
  const writeMissing = () => runBatch(items.filter((it) => !it.message && ready(it)), (it) => generate(it.lead, undefined, { quiet: true }), "Messages written");
  const approveDrafts = () =>
    runBatch(
      items.filter((it) => it.message?.status === "draft" && (!isCompany || it.message.recipient)),
      (it) => save(it.message, {}, "approved"),
      "Approved"
    );

  const counts = useMemo(() => {
    // Section totals over the campaign; the status chips count inside the section shown
    const c = { all: 0, none: 0, draft: 0, approved: 0, sent: 0 };
    for (const it of items || []) {
      const sec = sectionOf(it);
      c[`sec_${sec}`] = (c[`sec_${sec}`] || 0) + 1;
      if (isCompany && sec !== section) continue;
      c.all++;
      c[stateOf(it)]++;
    }
    return c;
  }, [items, isCompany, section]);

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

  const visible = items.filter((it) => (filter === "all" || stateOf(it) === filter) && (!isCompany || sectionOf(it) === section));
  const selected = visible.find((it) => it.lead.id === selectedId) || visible[0];
  const missingReady = items.filter((it) => !it.message && ready(it)).length;

  const moved = (lead, message, channel) => {
    setItems((prev) => prev.map((it) => (it.lead.id === lead.id ? { lead, message } : it)));
    setSection(channel);
    setSelectedId(lead.id);
  };

  return (
    <div className="space-y-4">
      {isCompany && (
        <div role="tablist" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SECTIONS.filter((x) => x.value !== "unresearched" || counts.sec_unresearched).map((x) => {
            const Icon = x.icon;
            const active = section === x.value;
            return (
              <button
                key={x.value}
                role="tab"
                aria-selected={active}
                onClick={() => { setSection(x.value); setSelectedId(null); }}
                title={x.hint}
                className={`rounded-xl border p-3 text-left transition-colors ${active ? "border-primary bg-primary/10" : "border-base-300 bg-base-100 hover:border-primary/40"}`}
              >
                <span className="flex items-center gap-1.5 text-xs font-medium text-base-content/60"><Icon className="h-3.5 w-3.5" /> {x.label}</span>
                <span className="mt-1 block text-2xl font-semibold tabular-nums">{counts[`sec_${x.value}`] || 0}</span>
                <span className="block text-[11px] leading-tight text-base-content/50">{x.hint}</span>
              </button>
            );
          })}
        </div>
      )}
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

        {selected && isCompany && sectionOf(selected) === "no_contact" ? (
          <NoContactPanel key={selected.lead.id} item={selected} onMoved={moved} />
        ) : selected && (
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
