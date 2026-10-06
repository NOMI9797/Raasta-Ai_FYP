"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { Building2, CalendarCheck, CalendarClock, CalendarX, CheckCircle2, ExternalLink, Loader2, MessagesSquare, Settings2, User } from "lucide-react";
import SalesStageShell from "@/components/sales/SalesStageShell";
import MeetingSettings from "@/components/sales/meetings/MeetingSettings";
import { useDialog } from "@/components/ui/DialogProvider";

const STATUS = {
  proposed: ["Times offered", "badge-warning"],
  confirmed: ["Booked", "badge-success"],
  completed: ["Held", "badge-info"],
  no_show: ["No-show", "badge-ghost"],
  cancelled: ["Cancelled", "badge-ghost"],
};

function fmt(d, tz) {
  return new Date(d).toLocaleString("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function MeetingCard({ meeting, onChanged }) {
  const { confirm } = useDialog();
  const [notes, setNotes] = useState(meeting.notes || "");
  const [busy, setBusy] = useState(false);
  const [badge, tone] = STATUS[meeting.status] || [meeting.status, "badge-ghost"];
  const past = meeting.endAt && new Date(meeting.endAt) < new Date();
  const Icon = meeting.lead?.source === "linkedin" ? User : Building2;

  const update = async (changes, success) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/sales/meetings/${meeting.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(data.emailed ? `${success}; the client was told${data.emailed.redirected ? ` (test: sent to ${data.emailed.to})` : ""}` : success);
      onChanged();
    } catch (err) {
      toast.error(err.message || "Could not update the meeting");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    const tell = meeting.status === "confirmed";
    const ok = await confirm({
      title: "Cancel this meeting?",
      message: tell ? "The client gets a short email in the same thread and the calendar invite is withdrawn." : "The offered times are withdrawn.",
      confirmText: "Cancel meeting",
      tone: "warning",
    });
    if (!ok) return;
    const message = tell
      ? `Hi${meeting.attendeeName ? ` ${meeting.attendeeName}` : ""},\n\nUnfortunately I need to cancel our call on ${fmt(meeting.startAt, meeting.timezone)}. Sorry for the change; I'll be in touch shortly to find another time that works.\n\nThanks for understanding.`
      : "";
    update({ status: "cancelled", message }, "Meeting cancelled");
  };

  return (
    <article className="rounded-xl border border-base-300 bg-base-100 p-4 space-y-3">
      <header className="flex flex-wrap items-start gap-3">
        <Icon className="h-5 w-5 mt-0.5 opacity-50" />
        <div className="flex-1 min-w-[12rem]">
          <h3 className="font-semibold flex flex-wrap items-center gap-2">{meeting.lead?.company || meeting.lead?.name || meeting.title} <span className={`badge badge-sm ${tone}`}>{badge}</span></h3>
          <p className="text-xs text-base-content/60">{meeting.title} · {meeting.campaignName}</p>
        </div>
        {meeting.lead && (
          <Link href={`/dashboard/sales/conversations?lead=${meeting.lead.id}`} className="btn btn-ghost btn-xs gap-1"><MessagesSquare className="h-3.5 w-3.5" /> Conversation</Link>
        )}
      </header>

      {meeting.startAt && meeting.status !== "proposed" ? (
        <p className="text-sm flex items-center gap-2"><CalendarCheck className="h-4 w-4 text-success" /> {fmt(meeting.startAt, meeting.timezone)} <span className="text-xs text-base-content/50">({meeting.timezone})</span></p>
      ) : (
        <div className="text-sm space-y-1">
          <p className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-warning" /> Waiting for them to pick one of:</p>
          <ul className="text-xs text-base-content/70 pl-6 list-disc">
            {(meeting.proposedSlots || []).map((s) => <li key={s.start}>{fmt(s.start, meeting.timezone)}</li>)}
          </ul>
        </div>
      )}
      <div className="text-xs text-base-content/60 flex flex-wrap gap-x-4 gap-y-1">
        {meeting.attendeeEmail && <span>With {meeting.attendeeName ? `${meeting.attendeeName} · ` : ""}{meeting.attendeeEmail}</span>}
        {meeting.location && <a href={meeting.location} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-0.5">Meeting link <ExternalLink className="h-3 w-3" /></a>}
        <span>Booked by {meeting.bookedBy === "agent" ? "the agent" : "you"}</span>
        {meeting.outcome && <span>{meeting.outcome}</span>}
      </div>

      {["confirmed", "completed", "no_show"].includes(meeting.status) && (
        <div className="space-y-2">
          <textarea className="textarea textarea-bordered textarea-sm w-full text-sm" rows={2} placeholder="Notes from the call: what they need, next steps…" value={notes} onChange={(e) => setNotes(e.target.value)} />
          {notes !== (meeting.notes || "") && <button className="btn btn-xs" disabled={busy} onClick={() => update({ notes }, "Notes saved")}>Save notes</button>}
        </div>
      )}

      {["proposed", "confirmed"].includes(meeting.status) && (
        <div className="flex flex-wrap justify-end gap-2">
          {meeting.status === "confirmed" && past && (
            <>
              <button className="btn btn-ghost btn-sm gap-1" disabled={busy} onClick={() => update({ status: "no_show" }, "Marked as no-show")}><CalendarX className="h-4 w-4" /> They didn&apos;t show</button>
              <button className="btn btn-success btn-sm gap-1" disabled={busy} onClick={() => update({ status: "completed" }, "Marked as held")}><CheckCircle2 className="h-4 w-4" /> Meeting held</button>
            </>
          )}
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={cancel}>Cancel meeting</button>
        </div>
      )}
    </article>
  );
}

function Meetings() {
  const [data, setData] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/sales/meetings");
    const json = await res.json();
    if (res.ok) setData(json);
    else toast.error(json.error || "Could not load meetings");
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) return <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;

  const now = new Date();
  const upcoming = data.meetings.filter((m) => m.status === "confirmed" && new Date(m.endAt) >= now).sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  const toConfirm = data.meetings.filter((m) => m.status === "confirmed" && new Date(m.endAt) < now);
  const offered = data.meetings.filter((m) => m.status === "proposed");
  const past = data.meetings.filter((m) => ["completed", "no_show", "cancelled"].includes(m.status));
  const s = data.settings;

  const section = (title, list, hint) => list.length > 0 && (
    <section className="space-y-3">
      <h2 className="font-semibold">{title} <span className="font-normal text-base-content/50">({list.length})</span></h2>
      {hint && <p className="text-xs text-base-content/60 -mt-2">{hint}</p>}
      <div className="grid gap-3 lg:grid-cols-2">{list.map((m) => <MeetingCard key={m.id} meeting={m} onChanged={load} />)}</div>
    </section>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-base-300 bg-base-100 p-3 text-sm">
        <p className="text-base-content/70">
          The agent offers times in your meeting hours ({s.meetingMinutes} minutes, {s.timezone}){s.meetingLink ? " and sends your meeting link" : ""}.
          {!s.meetingLink && <span className="text-warning"> Add a meeting link so confirmations include it.</span>}
        </p>
        <button className="btn btn-outline btn-sm gap-1" onClick={() => setShowSettings((v) => !v)}><Settings2 className="h-4 w-4" /> {showSettings ? "Hide settings" : "Meeting settings"}</button>
      </div>
      {showSettings && <MeetingSettings onSaved={load} />}

      {data.meetings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-base-300 p-10 text-center">
          <CalendarCheck className="h-8 w-8 mx-auto opacity-40" />
          <p className="font-semibold mt-2">No meetings yet</p>
          <p className="text-sm text-base-content/60">When a lead wants to talk, the agent offers your free times and books the one they pick. It shows up here.</p>
        </div>
      ) : (
        <>
          {section("Upcoming", upcoming)}
          {section("How did it go?", toConfirm, "These meetings are over: mark whether they happened and add notes.")}
          {section("Times offered", offered, "Waiting for the client to choose a time.")}
          {section("Past", past)}
        </>
      )}
    </div>
  );
}

// Step 7: meetings leads agreed to
export default function MeetingsPage() {
  return (
    <SalesStageShell stageKey="meetings" requireCampaign={false}>
      {() => <Meetings />}
    </SalesStageShell>
  );
}
