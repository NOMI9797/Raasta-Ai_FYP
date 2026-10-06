"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  AlertTriangle, Bot, CalendarCheck, Check, Clock, Inbox, Loader2, Mail, MailCheck, MessagesSquare, Pencil, Send, X,
} from "lucide-react";
import { useDialog } from "@/components/ui/DialogProvider";
import { OUTREACH_FILTERS, OUTREACH_STATUS } from "@/libs/sales/outreach-status";
import { stageHref } from "@/libs/sales/stages";

const STATUS_STYLE = {
  not_written: { label: "Not written", tone: "badge-ghost" },
  needs_address: { label: "Needs an address", tone: "badge-warning badge-outline" },
  not_approved: { label: "Draft", tone: "badge-ghost" },
  ready: { label: "Ready to send", tone: "badge-primary" },
  failed: { label: "Failed", tone: "badge-error" },
  waiting: { label: "Waiting for reply", tone: "badge-info badge-outline" },
  replied: { label: "Replied", tone: "badge-info" },
  meeting: { label: "Meeting booked", tone: "badge-success" },
  closed: { label: "Closed", tone: "badge-ghost" },
};
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
const day = (d, opts = {}) => (d ? new Date(d).toLocaleDateString([], { day: "numeric", month: "short", ...opts }) : "");

function Stat({ icon: Icon, label, value, sub, tone = "" }) {
  return (
    <div className="rounded-xl border border-base-300 bg-base-100 px-4 py-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-base-content/55"><Icon className="h-3.5 w-3.5" /> {label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-base-content/50">{sub}</p>}
    </div>
  );
}

/** The email address of one company, editable in place. */
function AddressCell({ row, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row.message?.recipient || row.foundEmails[0] || "");
  const [busy, setBusy] = useState(false);
  const sent = ["waiting", "replied", "meeting", "closed"].includes(row.status);

  if (!row.message || row.message.channel !== "email") return <span className="text-xs text-base-content/40">{row.message ? "LinkedIn message" : "—"}</span>;
  if (!editing) {
    return (
      <div className="group flex items-center gap-1 min-w-0">
        <span className={`truncate text-sm ${row.message.recipient ? "" : "text-warning"}`}>{row.message.recipient || "No address yet"}</span>
        {!sent && (
          <button className="btn btn-ghost btn-xs btn-square opacity-60 group-hover:opacity-100" title="Change the address" onClick={() => setEditing(true)}><Pencil className="h-3 w-3" /></button>
        )}
      </div>
    );
  }
  const save = async () => {
    if (!isEmail(value)) return toast.error("That isn't a valid email address");
    setBusy(true);
    try {
      // Keep an approved email approved when only the address changes
      const res = await fetch(`/api/sales/messages/${row.message.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: value.trim(), ...(row.message.status === "approved" ? { status: "approved" } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save");
      setEditing(false);
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-1">
      <input autoFocus list={`emails-${row.leadId}`} className="input input-bordered input-xs w-48" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
      {row.foundEmails.length > 0 && <datalist id={`emails-${row.leadId}`}>{row.foundEmails.map((e) => <option key={e} value={e} />)}</datalist>}
      <button className="btn btn-primary btn-xs btn-square" disabled={busy} onClick={save}>{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}</button>
      <button className="btn btn-ghost btn-xs btn-square" onClick={() => setEditing(false)}><X className="h-3 w-3" /></button>
    </div>
  );
}

function NextStep({ row, campaignId, platform }) {
  const messagesHref = stageHref("messages", { campaignId, platform });
  switch (row.status) {
    case "not_written":
      return <Link href={messagesHref} className="link link-primary text-xs">Write it in Messages</Link>;
    case "needs_address":
      return <span className="text-xs text-warning">Add an email address</span>;
    case "not_approved":
      return <Link href={messagesHref} className="link link-primary text-xs">Review in Messages</Link>;
    case "failed":
      return <span className="text-xs text-error" title={row.error}>{row.error?.slice(0, 60) || "Sending failed"}</span>;
    case "waiting":
      return row.nextFollowUpAt
        ? <span className="flex items-center gap-1 text-xs text-base-content/60"><Clock className="h-3 w-3" /> Follow-up {day(row.nextFollowUpAt)}</span>
        : <span className="text-xs text-base-content/50">No more follow-ups</span>;
    case "replied":
    case "closed":
      return <Link href={`/dashboard/sales/conversations?lead=${row.leadId}`} className="link link-primary text-xs inline-flex items-center gap-1"><MessagesSquare className="h-3 w-3" /> Open conversation</Link>;
    case "meeting":
      return (
        <Link href="/dashboard/sales/meetings" className="link link-success text-xs inline-flex items-center gap-1">
          <CalendarCheck className="h-3 w-3" />
          {row.meeting?.startAt ? new Date(row.meeting.startAt).toLocaleString("en-GB", { timeZone: row.meeting.timezone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "Meeting"}
        </Link>
      );
    default:
      return null;
  }
}

/** Outreach › Indeed / Rozee.pk: every company of the campaign, sending and tracking first emails. */
export default function CompanyOutreachBoard({ campaignId, platform }) {
  const { confirm } = useDialog();
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(new Set());
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/sales/outreach?campaign=${campaignId}&platform=${platform}`);
    const json = await res.json();
    if (res.ok) setData(json);
    else toast.error(json.error || "Could not load outreach");
  }, [campaignId, platform]);

  useEffect(() => {
    setData(null);
    setSelected(new Set());
    load();
  }, [load]);

  const companies = useMemo(() => data?.companies || [], [data]);
  const counts = useMemo(() => Object.fromEntries(OUTREACH_FILTERS.map((f) => [f.key, f.statuses ? companies.filter((c) => f.statuses.includes(c.status)).length : companies.length])), [companies]);
  const shown = useMemo(() => {
    const f = OUTREACH_FILTERS.find((x) => x.key === filter);
    return f?.statuses ? companies.filter((c) => f.statuses.includes(c.status)) : companies;
  }, [companies, filter]);
  const sendable = (c) => [OUTREACH_STATUS.READY, OUTREACH_STATUS.NOT_APPROVED, OUTREACH_STATUS.FAILED].includes(c.status) && c.message?.channel === "email" && isEmail(c.message?.recipient);
  const ready = companies.filter((c) => c.status === OUTREACH_STATUS.READY && isEmail(c.message?.recipient));

  const send = async (rows, { label }) => {
    if (!rows.length) return;
    const drafts = rows.filter((r) => r.status !== OUTREACH_STATUS.READY).length;
    const left = data.limit.left;
    const ok = await confirm({
      title: label,
      message: [
        `${rows.length} email${rows.length === 1 ? "" : "s"} will be sent now${drafts ? ` (${drafts} not approved yet: sending approves ${drafts === 1 ? "it" : "them"})` : ""}.`,
        rows.length > left ? `Only ${left} more can go today (daily limit ${data.limit.limit}); the rest stay ready for tomorrow.` : "",
        data.email?.testRecipient ? `Test mode: they all go to ${data.email.testRecipient}.` : "",
      ].filter(Boolean).join(" "),
      confirmText: "Send",
    });
    if (!ok) return;
    setSending(true);
    try {
      const res = await fetch("/api/sales/outreach/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, messageIds: rows.map((r) => r.message.id) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not send");
      const parts = [`${json.sent.length} sent`];
      if (json.deferred.length) parts.push(`${json.deferred.length} left for tomorrow (daily limit)`);
      if (json.failed.length) parts.push(`${json.failed.length} failed`);
      (json.failed.length ? toast.error : toast.success)(parts.join(" · "));
      setSelected(new Set());
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  };

  if (!data) return <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;

  const { stats, limit, agent, email } = data;
  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const shownSendable = shown.filter(sendable);
  const allShownSelected = shownSendable.length > 0 && shownSendable.every((c) => selected.has(c.leadId));
  const selectedRows = companies.filter((c) => selected.has(c.leadId) && sendable(c));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat icon={Send} label="Ready to send" value={stats.ready} tone={stats.ready ? "text-primary" : ""} />
        <Stat icon={Mail} label="Sent today" value={`${limit.sentToday} / ${limit.limit}`} sub={`${limit.left} left today`} />
        <Stat icon={Inbox} label="Waiting for reply" value={stats.waiting} />
        <Stat icon={MessagesSquare} label="Replied" value={stats.replied} sub={stats.sent ? `${Math.round((stats.replied / stats.sent) * 100)}% of ${stats.sent} sent` : null} />
        <Stat icon={CalendarCheck} label="Meetings" value={stats.meetings} tone={stats.meetings ? "text-success" : ""} />
      </div>

      {(email?.testRecipient || agent) && (
        <div className="space-y-2">
          {email?.testRecipient && (
            <div className="flex items-center gap-2 rounded-lg border border-info/30 bg-info/10 px-4 py-2 text-sm">
              <MailCheck className="h-4 w-4 text-info" /> <span><span className="font-semibold">Test mode:</span> every email goes to {email.testRecipient}, not to the companies.</span>
            </div>
          )}
          {agent && (
            <div className="flex items-center gap-2 rounded-lg border border-base-300 bg-base-200/50 px-4 py-2 text-sm">
              <Bot className="h-4 w-4 text-primary" />
              <span className="flex-1">The Sales agent is working this campaign ({agent.mode === "autopilot" ? "Auto" : "Semi-auto"}, {agent.status}). Its emails show here too; anything you send here, it won&apos;t send again.</span>
              <Link href="/dashboard/agents" className="link link-primary text-xs">Open agent</Link>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" className="flex flex-wrap gap-1">
          {OUTREACH_FILTERS.filter((f) => f.key === "all" || counts[f.key] > 0).map((f) => (
            <button
              key={f.key}
              role="tab"
              onClick={() => setFilter(f.key)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${filter === f.key ? "bg-primary text-primary-content" : "bg-base-200 text-base-content/70 hover:bg-base-300"}`}
            >
              {f.label} <span className="tabular-nums opacity-70">{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {selectedRows.length > 0 && (
            <button className="btn btn-outline btn-sm gap-1" disabled={sending} onClick={() => send(selectedRows, { label: `Send ${selectedRows.length} selected?` })}>
              <Send className="h-4 w-4" /> Send selected ({selectedRows.length})
            </button>
          )}
          <button className="btn btn-primary btn-sm gap-1" disabled={sending || !ready.length || !limit.left} onClick={() => send(ready, { label: `Send all ${ready.length} approved emails?` })} title={!limit.left ? "Today's email limit is used up" : ""}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send all approved{ready.length ? ` (${ready.length})` : ""}
          </button>
        </div>
      </div>

      {companies.length === 0 ? (
        <div className="rounded-xl border border-dashed border-base-300 p-10 text-center">
          <Mail className="mx-auto h-8 w-8 opacity-40" />
          <p className="mt-2 font-semibold">No companies yet</p>
          <p className="text-sm text-base-content/60">Find companies that are hiring, research them and write their emails first.</p>
          <Link href={stageHref("find", { campaignId, platform })} className="btn btn-sm btn-outline mt-4">Find leads</Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-base-300 bg-base-100">
          <table className="table table-sm">
            <thead>
              <tr className="text-xs text-base-content/60">
                <th className="w-8">
                  <input type="checkbox" className="checkbox checkbox-xs" disabled={!shownSendable.length} checked={allShownSelected}
                    onChange={() => setSelected(allShownSelected ? new Set() : new Set(shownSendable.map((c) => c.leadId)))} />
                </th>
                <th>Company</th>
                <th>Send to</th>
                <th>Subject</th>
                <th>Status</th>
                <th>Sent</th>
                <th>Next step</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-sm text-base-content/50">Nothing here.</td></tr>}
              {shown.map((row) => {
                const style = STATUS_STYLE[row.status] || { label: row.status, tone: "badge-ghost" };
                return (
                  <tr key={row.leadId} className="hover">
                    <td><input type="checkbox" className="checkbox checkbox-xs" disabled={!sendable(row)} checked={selected.has(row.leadId)} onChange={() => toggle(row.leadId)} /></td>
                    <td className="max-w-[14rem]">
                      <p className="truncate font-medium">{row.company}</p>
                      <p className="truncate text-xs text-base-content/50">
                        {row.jobTitle}{row.fit != null && <span className={`ml-1.5 ${row.fit >= 70 ? "text-success" : row.fit >= 50 ? "text-warning" : "text-error"}`}>· Fit {row.fit}</span>}
                      </p>
                    </td>
                    <td className="max-w-[15rem]"><AddressCell row={row} onSaved={load} /></td>
                    <td className="max-w-[16rem]"><p className="truncate text-sm text-base-content/80" title={row.message?.preview || ""}>{row.message?.subject || <span className="text-base-content/40">—</span>}</p></td>
                    <td>
                      <span className={`badge badge-sm whitespace-nowrap ${style.tone}`}>{style.label}</span>
                      {row.waitingForAgentApproval && <p className="mt-0.5 flex items-center gap-1 text-[11px] text-warning"><AlertTriangle className="h-3 w-3" /> Agent is asking you</p>}
                    </td>
                    <td className="whitespace-nowrap text-xs text-base-content/60">
                      {row.sentAt ? day(row.sentAt) : "—"}
                      {row.followUpsSent > 0 && <p className="text-[11px]">+{row.followUpsSent} follow-up{row.followUpsSent === 1 ? "" : "s"}</p>}
                    </td>
                    <td><NextStep row={row} campaignId={campaignId} platform={platform} /></td>
                    <td className="text-right">
                      {sendable(row) && (
                        <button className="btn btn-primary btn-xs gap-1" disabled={sending || !limit.left} onClick={() => send([row], { label: `Send to ${row.company}?` })}>
                          <Send className="h-3 w-3" /> Send
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
