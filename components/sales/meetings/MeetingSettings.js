"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Loader2, Plus, Save, Settings2, X } from "lucide-react";
import { WEEKDAY_LABELS } from "@/libs/sales/meetings/slots";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const ZONES = ["Asia/Karachi", "Asia/Dubai", "Asia/Riyadh", "Asia/Kolkata", "Europe/London", "Europe/Berlin", "America/New_York", "America/Chicago", "America/Los_Angeles", "Australia/Sydney", "UTC"];

/** How and when the agent books meetings, and how it follows up. */
export default function MeetingSettings({ onSaved }) {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/sales/settings").then((r) => r.json()).then((d) => d.settings && setForm(d.settings)).catch(() => toast.error("Could not load the settings"));
  }, []);

  if (!form) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const setWindow = (day, i, key, value) => set("availability", { ...form.availability, [day]: form.availability[day].map((w, j) => (j === i ? { ...w, [key]: value } : w)) });
  const addWindow = (day) => set("availability", { ...form.availability, [day]: [...(form.availability[day] || []), { start: "11:00", end: "17:00" }] });
  const removeWindow = (day, i) => set("availability", { ...form.availability, [day]: form.availability[day].filter((_, j) => j !== i) });

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/sales/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, followUpDays: String(form.followUpDaysText ?? form.followUpDays.join(", ")).split(/[,\s]+/).filter(Boolean).map(Number) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setForm(data.settings);
      toast.success("Saved");
      onSaved?.(data.settings);
    } catch (err) {
      toast.error(err.message || "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const fmt = (d) => new Date(d).toLocaleString("en-GB", { timeZone: form.timezone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  return (
    <section className="rounded-xl border border-base-300 bg-base-100 p-4 space-y-4">
      <h2 className="font-semibold flex items-center gap-2"><Settings2 className="h-4 w-4" /> Meeting and follow-up settings</h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="form-control">
          <span className="label-text text-xs mb-1">Company name (the agent writes as)</span>
          <input className="input input-bordered input-sm" placeholder="Your company" value={form.companyName || ""} onChange={(e) => set("companyName", e.target.value)} />
        </label>
        <label className="form-control">
          <span className="label-text text-xs mb-1">Time zone</span>
          <select className="select select-bordered select-sm" value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
            {[...new Set([form.timezone, ...ZONES])].map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </label>
        <label className="form-control">
          <span className="label-text text-xs mb-1">Meeting name</span>
          <input className="input input-bordered input-sm" value={form.meetingTitle || ""} onChange={(e) => set("meetingTitle", e.target.value)} />
        </label>
        <label className="form-control">
          <span className="label-text text-xs mb-1">Meeting link (Google Meet, Zoom, Teams)</span>
          <input className="input input-bordered input-sm" placeholder="https://meet.google.com/…" value={form.meetingLink || ""} onChange={(e) => set("meetingLink", e.target.value)} />
        </label>
      </div>

      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <label className="form-control">
          <span className="label-text text-xs mb-1">Length (minutes)</span>
          <input type="number" min={15} max={120} step={15} className="input input-bordered input-sm" value={form.meetingMinutes} onChange={(e) => set("meetingMinutes", e.target.value)} />
        </label>
        <label className="form-control">
          <span className="label-text text-xs mb-1">Gap between (minutes)</span>
          <input type="number" min={0} max={60} className="input input-bordered input-sm" value={form.bufferMinutes} onChange={(e) => set("bufferMinutes", e.target.value)} />
        </label>
        <label className="form-control">
          <span className="label-text text-xs mb-1">Notice (hours)</span>
          <input type="number" min={1} max={168} className="input input-bordered input-sm" value={form.minNoticeHours} onChange={(e) => set("minNoticeHours", e.target.value)} />
        </label>
        <label className="form-control">
          <span className="label-text text-xs mb-1">Follow up after (days)</span>
          <input className="input input-bordered input-sm" placeholder="3, 7" value={form.followUpDaysText ?? form.followUpDays.join(", ")} onChange={(e) => set("followUpDaysText", e.target.value)} />
        </label>
      </div>

      <div className="space-y-1.5">
        <span className="label-text text-xs">Hours you can take meetings</span>
        {DAYS.map((day) => (
          <div key={day} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-24">{WEEKDAY_LABELS[day]}</span>
            {(form.availability[day] || []).length === 0 && <span className="text-xs text-base-content/40">Not available</span>}
            {(form.availability[day] || []).map((w, i) => (
              <span key={i} className="flex items-center gap-1">
                <input type="time" step={1800} className="input input-bordered input-xs" value={w.start} onChange={(e) => setWindow(day, i, "start", e.target.value)} />
                –
                <input type="time" step={1800} className="input input-bordered input-xs" value={w.end} onChange={(e) => setWindow(day, i, "end", e.target.value)} />
                <button type="button" className="btn btn-ghost btn-xs btn-square" onClick={() => removeWindow(day, i)}><X className="h-3 w-3" /></button>
              </span>
            ))}
            <button type="button" className="btn btn-ghost btn-xs gap-1" onClick={() => addWindow(day)}><Plus className="h-3 w-3" /> hours</button>
          </div>
        ))}
      </div>

      {form.preview?.length > 0 && (
        <p className="text-xs text-base-content/60">The agent would offer next: {form.preview.map(fmt).join(" · ")}</p>
      )}

      <div className="flex justify-end">
        <button className="btn btn-primary btn-sm gap-1" disabled={busy} onClick={save}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save settings
        </button>
      </div>
    </section>
  );
}
