"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BarChart3, CalendarCheck, Clock, Loader2, MailCheck, MessagesSquare, Repeat, Users } from "lucide-react";
import SalesStageShell from "@/components/sales/SalesStageShell";
import { CONVERSATION_LABELS, INTENT_LABELS } from "@/libs/sales/conversation/status";
import { PLATFORM_META } from "@/libs/platforms/meta";
import { stageHref } from "@/libs/sales/stages";

const OUTCOME_TONE = {
  meeting_booked: "bg-emerald-500",
  in_conversation: "bg-sky-500",
  replied: "bg-sky-400",
  meeting_proposed: "bg-amber-400",
  awaiting_reply: "bg-slate-300",
  no_response: "bg-slate-400",
  not_interested: "bg-rose-300",
  unsubscribed: "bg-rose-500",
};
const INTENT_TONE = {
  meeting: "bg-emerald-500", pick_slot: "bg-emerald-400", interested: "bg-indigo-500", question: "bg-sky-500", reschedule: "bg-amber-400",
  not_now: "bg-slate-400", not_interested: "bg-rose-300", unsubscribe: "bg-rose-500", out_of_office: "bg-slate-300", other: "bg-slate-300",
};

// Lead-quality buckets from libs/sales/results.js (class names live here so Tailwind sees them)
const FIT_TONE = { strong: "bg-emerald-500", possible: "bg-amber-400", poor: "bg-rose-400" };

const fmtPct = (v) => `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
function fmtHours(h) {
  if (h == null) return "—";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}

function Card({ title, subtitle, children, className = "" }) {
  return (
    <section className={`rounded-xl border border-base-300 bg-base-100 p-5 shadow-sm ${className}`}>
      <header className="mb-4">
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-base-content/55">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

function Kpi({ icon: Icon, label, value, sub, tone = "" }) {
  return (
    <div className="rounded-xl border border-base-300 bg-base-100 px-4 py-3.5 shadow-sm">
      <p className="flex items-center gap-1.5 text-xs font-medium text-base-content/55"><Icon className="h-3.5 w-3.5" /> {label}</p>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-base-content/50">{sub}</p>}
    </div>
  );
}

function Funnel({ stages }) {
  const top = stages[0]?.count || 0;
  return (
    <ol className="space-y-2.5">
      {stages.map((s, i) => (
        <li key={s.key} className="grid grid-cols-[7.5rem_1fr_4.5rem] items-center gap-3 sm:grid-cols-[9rem_1fr_7rem]">
          <span className="truncate text-sm">{s.label}</span>
          <div className="relative h-8 overflow-hidden rounded-md bg-base-200">
            <div className="h-full rounded-md bg-primary transition-all" style={{ width: `${top ? Math.max(s.count ? 2 : 0, (s.count / top) * 100) : 0}%`, opacity: 1 - i * 0.09 }} />
            <span className={`absolute inset-y-0 left-2.5 flex items-center text-xs font-semibold tabular-nums ${top && s.count / top > 0.12 ? "text-primary-content" : "text-base-content/70"}`}>{s.count}</span>
          </div>
          <span className="text-right text-xs tabular-nums">
            <span className="font-medium">{fmtPct(s.ofTotal)}</span>
            {i > 0 && <span className="block text-[11px] text-base-content/45">{fmtPct(s.ofPrevious)} of previous</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Activity({ series }) {
  const max = Math.max(1, ...series.map((d) => Math.max(d.sent, d.replies)));
  const total = series.reduce((a, d) => ({ sent: a.sent + d.sent, replies: a.replies + d.replies }), { sent: 0, replies: 0 });
  return (
    <div>
      <div className="mb-3 flex gap-4 text-xs text-base-content/60">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-primary" /> Emails sent ({total.sent})</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-success" /> Replies ({total.replies})</span>
      </div>
      <div className="flex h-40 items-end gap-1 border-b border-base-300">
        {series.map((d) => (
          <div key={d.day} className="group relative flex h-full flex-1 items-end justify-center gap-0.5" title={`${new Date(d.day).toLocaleDateString([], { day: "numeric", month: "short" })}: ${d.sent} sent, ${d.replies} replies`}>
            <div className="w-1/2 max-w-[0.9rem] rounded-t bg-primary/85 transition-colors group-hover:bg-primary" style={{ height: `${(d.sent / max) * 100}%`, minHeight: d.sent ? 3 : 0 }} />
            <div className="w-1/2 max-w-[0.9rem] rounded-t bg-success/85 transition-colors group-hover:bg-success" style={{ height: `${(d.replies / max) * 100}%`, minHeight: d.replies ? 3 : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-base-content/45">
        <span>{new Date(series[0].day).toLocaleDateString([], { day: "numeric", month: "short" })}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

function Bars({ items, empty }) {
  const total = items.reduce((a, i) => a + i.count, 0);
  if (!total) return <p className="py-6 text-center text-sm text-base-content/50">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {items.filter((i) => i.count).sort((a, b) => b.count - a.count).map((i) => (
        <li key={i.key}>
          <div className="mb-1 flex justify-between text-xs">
            <span>{i.label}</span>
            <span className="tabular-nums text-base-content/60">{i.count} · {fmtPct(Math.round((i.count / total) * 1000) / 10)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-base-200"><div className={`h-full rounded-full ${i.tone}`} style={{ width: `${(i.count / total) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

function StackedBar({ items }) {
  const total = items.reduce((a, i) => a + i.count, 0);
  if (!total) return <p className="py-6 text-center text-sm text-base-content/50">No one contacted yet.</p>;
  return (
    <div className="space-y-3">
      <div className="flex h-3 overflow-hidden rounded-full bg-base-200">
        {items.filter((i) => i.count).map((i) => <div key={i.key} className={i.tone} style={{ width: `${(i.count / total) * 100}%` }} title={`${i.label}: ${i.count}`} />)}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {items.filter((i) => i.count).map((i) => (
          <li key={i.key} className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${i.tone}`} />
            <span className="flex-1 truncate">{i.label}</span>
            <span className="tabular-nums text-base-content/60">{i.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Results({ campaign, platform }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/api/sales/results?campaign=${campaign.id}`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => !cancelled && (ok ? setData(j) : setError(j.error || "Could not load results")))
      .catch(() => !cancelled && setError("Could not load results"));
    return () => {
      cancelled = true;
    };
  }, [campaign.id]);

  if (error) return <div role="alert" className="alert alert-error text-sm">{error}</div>;
  if (!data) return <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;

  const r = data.platforms[platform];
  if (!r) {
    return (
      <div className="rounded-xl border border-dashed border-base-300 p-12 text-center">
        <BarChart3 className="mx-auto h-9 w-9 opacity-40" />
        <p className="mt-3 font-semibold">No {PLATFORM_META[platform]?.label || platform} leads yet</p>
        <p className="mt-1 text-sm text-base-content/60">Results appear once leads are added and contacted.</p>
        <Link href={stageHref("find", { campaignId: campaign.id, platform })} className="btn btn-outline btn-sm mt-4">Find leads</Link>
      </div>
    );
  }
  const k = r.kpis;
  const isCompany = r.kind === "company";

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi icon={Users} label={isCompany ? "Companies" : "People"} value={k.leads} />
        <Kpi icon={MailCheck} label="Contacted" value={k.contacted} sub={`${fmtPct(k.contactRate)} of leads`} />
        <Kpi icon={MessagesSquare} label="Reply rate" value={fmtPct(k.replyRate)} sub={`${k.replied} of ${k.contacted} replied`} tone={k.replied ? "text-info" : ""} />
        <Kpi icon={CalendarCheck} label="Meetings" value={k.meetings} sub={`${fmtPct(k.meetingRate)} of contacted`} tone={k.meetings ? "text-success" : ""} />
        <Kpi icon={Clock} label="Time to reply" value={fmtHours(k.medianHoursToReply)} sub="median, first reply" />
        <Kpi icon={Repeat} label="Follow-ups sent" value={k.followUps} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[3fr_2fr]">
        <Card title="Funnel" subtitle="How far leads got. The right column shows the share of all leads, and of the step before.">
          <Funnel stages={r.funnel} />
        </Card>
        <Card title="Activity" subtitle="Last 14 days">
          <Activity series={r.series} />
        </Card>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <Card title="What replies said" subtitle="How the agent read each reply">
          <Bars items={Object.entries(r.intents).map(([key, count]) => ({ key, count, label: INTENT_LABELS[key] || key, tone: INTENT_TONE[key] || "bg-slate-300" }))} empty="No replies yet." />
        </Card>
        <Card title="Where contacted leads stand" subtitle="Every lead that was sent a message">
          <StackedBar items={Object.entries(r.outcomes).map(([key, count]) => ({ key, count, label: CONVERSATION_LABELS[key]?.label || key, tone: OUTCOME_TONE[key] || "bg-slate-300" }))} />
        </Card>
        <Card title="Lead quality" subtitle={r.fit.scored ? `${r.fit.scored} scored by the AI · average fit ${r.fit.average}` : "Fit scores from the AI"}>
          <Bars items={r.fit.buckets.map((b) => ({ key: b.label, label: b.label, count: b.count, tone: FIT_TONE[b.tone] || "bg-slate-300" }))} empty="No leads scored yet." />
        </Card>
      </div>

      {data.comparison.length > 1 && (
        <Card title="All platforms in this campaign">
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr className="text-xs text-base-content/60">
                  <th>Platform</th><th className="text-right">Leads</th><th className="text-right">Contacted</th><th className="text-right">Replied</th><th className="text-right">Reply rate</th><th className="text-right">Meetings</th>
                </tr>
              </thead>
              <tbody>
                {data.comparison.map((c) => (
                  <tr key={c.platform} className={c.platform === platform ? "bg-primary/5" : ""}>
                    <td className="font-medium">{PLATFORM_META[c.platform]?.label || c.platform}</td>
                    <td className="text-right tabular-nums">{c.leads}</td>
                    <td className="text-right tabular-nums">{c.contacted}</td>
                    <td className="text-right tabular-nums">{c.replied}</td>
                    <td className="text-right tabular-nums">{fmtPct(c.replyRate)}</td>
                    <td className="text-right tabular-nums">{c.meetings}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// Step 8: what worked.
export default function ResultsPage() {
  return (
    <SalesStageShell stageKey="results">
      {({ campaign, platform }) => <Results key={campaign.id} campaign={campaign} platform={platform} />}
    </SalesStageShell>
  );
}

