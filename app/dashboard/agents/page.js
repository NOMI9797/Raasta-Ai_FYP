"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Activity, Bot, CalendarCheck, Hand, Loader2, MailCheck, MessagesSquare, Plus, X } from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";
import LaunchSalesAgent from "@/components/sales/agent/LaunchSalesAgent";
import SalesRunCard from "@/components/sales/agent/SalesRunCard";
import SalesApprovals from "@/components/sales/agent/SalesApprovals";

const ACTIVE = ["queued", "running", "waiting", "paused", "paused_at_checkpoint"];

function SalesAgentPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") === "approvals" ? "approvals" : "runs";

  const [data, setData] = useState(null);
  const [pending, setPending] = useState(0);
  const [showLaunch, setShowLaunch] = useState(false);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/signin");
      return;
    }
    const modes = Array.isArray(session.user?.modes) ? session.user.modes : [];
    if (session.user?.role !== "admin" && !modes.includes("sales")) router.replace("/dashboard/home");
  }, [session, status, router]);

  const load = useCallback(async () => {
    const res = await fetch("/api/sales/agent");
    const json = await res.json();
    if (res.ok) {
      setData(json);
      setPending(json.runs.reduce((n, r) => n + (ACTIVE.includes(r.status) ? r.results?.pendingApprovals || 0 : 0), 0));
    }
  }, []);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  // Follow the agent while it works
  const anyActive = data?.runs.some((r) => ACTIVE.includes(r.status));
  useEffect(() => {
    if (!anyActive) return;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [anyActive, load]);

  const setTab = (t) => router.replace(t === "approvals" ? `${pathname}?tab=approvals` : pathname, { scroll: false });

  if (status === "loading" || !session || !data) {
    return (
      <DashboardShell title="Sales agent" activeSection="sales-agent">
        <div className="flex justify-center py-20"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
      </DashboardShell>
    );
  }

  const active = data.runs.filter((r) => ACTIVE.includes(r.status));
  const past = data.runs.filter((r) => !ACTIVE.includes(r.status));
  const launchOpen = showLaunch || data.runs.length === 0;
  const sum = (fn) => data.runs.reduce((n, r) => n + (fn(r) || 0), 0);
  const totals = [
    { icon: Activity, label: "Agents working", value: active.length, tone: active.length ? "text-primary" : "" },
    { icon: Hand, label: "Awaiting you", value: pending, tone: pending ? "text-warning" : "", onClick: pending ? () => setTab("approvals") : null },
    { icon: MailCheck, label: "Contacted", value: sum((r) => r.results?.counts?.done) },
    { icon: MessagesSquare, label: "Replies", value: sum((r) => r.results?.conversations?.replied) },
    { icon: CalendarCheck, label: "Meetings booked", value: sum((r) => r.results?.conversations?.meetings), tone: "text-success" },
  ];

  return (
    <DashboardShell title="Sales agent" activeSection="sales-agent">
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><Bot className="h-6 w-6" /></span>
            <div>
              <h1 className="text-2xl font-bold leading-tight">Sales agent</h1>
              <p className="text-sm text-base-content/60">Finds, researches and contacts leads, answers their replies and books meetings.</p>
            </div>
          </div>
          {!launchOpen && (
            <button className="btn btn-primary btn-sm gap-1" onClick={() => setShowLaunch(true)}><Plus className="h-4 w-4" /> New agent run</button>
          )}
        </header>

        {data.runs.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {totals.map((t) => {
              const Tag = t.onClick ? "button" : "div";
              return (
                <Tag key={t.label} onClick={t.onClick || undefined} className={`rounded-xl border border-base-300 bg-base-100 px-4 py-3 text-left ${t.onClick ? "transition-colors hover:border-warning" : ""}`}>
                  <p className="flex items-center gap-1.5 text-xs font-medium text-base-content/55"><t.icon className="h-3.5 w-3.5" /> {t.label}</p>
                  <p className={`mt-1 text-2xl font-semibold tabular-nums ${t.tone}`}>{t.value}</p>
                </Tag>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between border-b border-base-300">
          <div role="tablist" className="flex gap-6">
            {[
              { key: "runs", label: "Runs" },
              { key: "approvals", label: "Approvals", badge: pending },
            ].map((t) => (
              <button
                key={t.key}
                role="tab"
                onClick={() => setTab(t.key)}
                className={`-mb-px flex items-center gap-2 border-b-2 px-1 pb-2.5 text-sm font-medium transition-colors ${tab === t.key ? "border-primary text-primary" : "border-transparent text-base-content/60 hover:text-base-content"}`}
              >
                {t.label}
                {t.badge > 0 && <span className="rounded-full bg-warning px-1.5 py-0.5 text-[11px] font-semibold leading-none text-warning-content">{t.badge}</span>}
              </button>
            ))}
          </div>
        </div>

        {tab === "approvals" ? (
          <SalesApprovals onCountChange={setPending} />
        ) : (
          <div className="space-y-6">
            {launchOpen && (
              <div className="relative">
                {data.runs.length > 0 && (
                  <button className="btn btn-ghost btn-xs btn-circle absolute right-3 top-3 z-10" title="Close" onClick={() => setShowLaunch(false)}><X className="h-4 w-4" /></button>
                )}
                <LaunchSalesAgent
                  setup={data.setup}
                  policy={data.policy}
                  defaults={data.defaults}
                  onStarted={() => {
                    setShowLaunch(false);
                    load();
                  }}
                />
              </div>
            )}
            {active.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-base-content/50">Working now</h2>
                {active.map((run) => (
                  <SalesRunCard key={run.id} run={run} stepLabels={data.stepLabels} onChanged={load} onOpenApprovals={() => setTab("approvals")} />
                ))}
              </section>
            )}
            {past.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-base-content/50">Earlier runs</h2>
                {past.map((run) => (
                  <SalesRunCard key={run.id} run={run} stepLabels={data.stepLabels} onChanged={load} compact />
                ))}
              </section>
            )}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SalesAgentPage />
    </Suspense>
  );
}
