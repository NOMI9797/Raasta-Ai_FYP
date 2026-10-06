"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bot, Loader2, Plus } from "lucide-react";
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

  return (
    <DashboardShell title="Sales agent" activeSection="sales-agent">
      <div className="p-4 md:p-6 space-y-5 max-w-5xl">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Bot className="h-6 w-6 text-primary" /> Sales agent</h1>
            <p className="text-sm text-base-content/70 mt-1 max-w-2xl">
              The agent works a campaign for you: it finds and researches leads, scores how well they fit, writes the messages and sends them.
              In Semi-auto it asks you before sending; in Auto it sends on its own within your daily limits.
            </p>
          </div>
          {!launchOpen && (
            <button className="btn btn-primary btn-sm gap-1" onClick={() => setShowLaunch(true)}><Plus className="h-4 w-4" /> Start on a campaign</button>
          )}
        </header>

        <div role="tablist" className="tabs tabs-boxed w-fit">
          <button role="tab" className={`tab ${tab === "runs" ? "tab-active" : ""}`} onClick={() => setTab("runs")}>Agent</button>
          <button role="tab" className={`tab gap-2 ${tab === "approvals" ? "tab-active" : ""}`} onClick={() => setTab("approvals")}>
            Approvals {pending > 0 && <span className="badge badge-warning badge-sm">{pending}</span>}
          </button>
        </div>

        {tab === "approvals" ? (
          <SalesApprovals onCountChange={setPending} />
        ) : (
          <div className="space-y-5">
            {launchOpen && (
              <LaunchSalesAgent
                setup={data.setup}
                policy={data.policy}
                defaults={data.defaults}
                onStarted={() => {
                  setShowLaunch(false);
                  load();
                }}
              />
            )}
            {active.length > 0 && (
              <section className="space-y-3">
                <h2 className="font-semibold">Working now</h2>
                {active.map((run) => (
                  <SalesRunCard key={run.id} run={run} stepLabels={data.stepLabels} onChanged={load} onOpenApprovals={() => setTab("approvals")} />
                ))}
              </section>
            )}
            {past.length > 0 && (
              <section className="space-y-3">
                <h2 className="font-semibold text-base-content/70">Earlier runs</h2>
                {past.map((run) => (
                  <SalesRunCard key={run.id} run={run} stepLabels={data.stepLabels} onChanged={load} />
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
