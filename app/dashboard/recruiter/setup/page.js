"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { CheckCircle2, Info, Loader2, Play, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";
import { useDialog } from "@/components/ui/DialogProvider";
import { START_ORDER, sentenceName } from "@/libs/system/features";
import { controlService, refreshSystem, useSystemStatus } from "@/components/system/useSystem";
import { useServiceGuard } from "@/components/system/useServiceGuard";
import ProgramCard from "./components/ProgramCard";
import Checklist from "./components/Checklist";

const OVERALL = {
  ready: { className: "alert-success", icon: CheckCircle2 },
  degraded: { className: "alert-warning", icon: Info },
  blocked: { className: "alert-error", icon: ShieldAlert },
};

// What stopping one of them costs, in words (shown before it is stopped)
function stopWarning(service) {
  if (service.id === "engine" && service.activeSessions > 0) {
    const n = service.activeSessions;
    return { tone: "danger", message: `${n} interview${n === 1 ? " is" : "s are"} in progress. Stopping ends ${n === 1 ? "it" : "them"} for the candidate.` };
  }
  if (service.id === "engine") return { tone: "warning", message: "Candidates cannot start an interview until it is running again." };
  if (service.id === "worker") return { tone: "warning", message: "Screening, invites and the Hiring agent pause until you start it again (the web server will not restart it by itself). Jobs it was in the middle of are picked up again after a few minutes." };
  return { tone: "warning", message: "Questions are not spoken and recordings cannot be analysed until it runs again." };
}

export default function SetupPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { confirm } = useDialog();
  const { startPrograms } = useServiceGuard();
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    if (authStatus === "unauthenticated") router.push("/signin");
    if (authStatus !== "authenticated") return;
    const modes = Array.isArray(session.user?.modes) ? session.user.modes : [];
    if (session.user?.role !== "admin" && !modes.includes("recruiter")) router.replace("/dashboard/home");
  }, [session, authStatus, router]);

  // Poll quickly while something is starting, slowly otherwise
  const { data, isLoading, isFetching, refetch } = useSystemStatus({
    guidance: true,
    interval: (query) => (query.state.data?.status?.services?.some((s) => s.state === "starting") ? 2000 : 8000),
    enabled: authStatus === "authenticated",
  });
  const status = data?.status;
  const guidance = data?.guidance;
  const refresh = () => refreshSystem(queryClient).catch(() => {});

  const act = async (id, action) => {
    const service = status.services.find((s) => s.id === id);
    if (action === "stop" || action === "restart") {
      const warning = stopWarning(service);
      const ok = await confirm({
        title: `${action === "stop" ? "Stop" : "Restart"} the ${sentenceName(service.label)}?`,
        message: warning.message,
        confirmText: action === "stop" ? "Stop it" : "Restart",
        tone: warning.tone,
      });
      if (!ok) return;
    }
    setBusy(id);
    try {
      await controlService(id, action);
      toast.success(action === "stop" ? `${service.label} stopped` : `${service.label} is starting`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const startAll = async () => {
    const ids = START_ORDER.filter((id) => status.services.find((s) => s.id === id)?.canStart);
    setBusy("all");
    try {
      await startPrograms(ids);
    } finally {
      setBusy(null);
      refresh();
    }
  };

  if (authStatus === "loading" || isLoading || !status) {
    return (
      <DashboardShell title="Setup guide" activeSection="recruiter-setup">
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-primary" size={28} /></div>
      </DashboardShell>
    );
  }

  const overall = OVERALL[status.overall] || OVERALL.degraded;
  const OverallIcon = overall.icon;
  const startable = status.services.filter((s) => s.canStart);

  return (
    <DashboardShell title="Setup guide" activeSection="recruiter-setup">
      <div className="p-6 space-y-6 max-w-5xl">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Setup guide</h1>
            <p className="text-sm text-base-content/70 mt-1 max-w-2xl">
              Hiring runs on four programs. Start them here, see what each one does, and follow the steps below to get from a job to a hire.
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm !normal-case gap-1" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Check again
          </button>
        </header>

        <div role="status" className={`alert ${overall.className} items-start`}>
          <OverallIcon className="h-5 w-5 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold">{status.overall === "ready" ? "Everything is running" : status.summary}</p>
            {status.overall === "ready" && <p className="text-xs opacity-80">{status.summary}</p>}
          </div>
          {status.controlEnabled && startable.length > 0 && (
            <button type="button" className="btn btn-sm !normal-case gap-1" onClick={startAll} disabled={Boolean(busy)}>
              {busy === "all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Start what is stopped ({startable.length})
            </button>
          )}
        </div>
        {!status.controlEnabled && (
          <p className="text-sm text-base-content/70 flex gap-2"><Info className="h-4 w-4 mt-0.5 shrink-0" /> Starting from the app is turned off on this server. Start each program from a terminal with the command shown on its card.</p>
        )}

        <section aria-labelledby="next-heading" className="space-y-2">
          <h2 id="next-heading" className="text-base font-semibold">What to do next</h2>
          <Checklist guidance={guidance} onSetupPage />
        </section>

        <section aria-labelledby="programs-heading" className="space-y-2">
          <h2 id="programs-heading" className="text-base font-semibold">The programs</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {status.services.map((service) => (
              <ProgramCard key={service.id} service={service} busy={busy} controlEnabled={status.controlEnabled} onAction={act} />
            ))}
          </div>
          <p className="text-xs text-base-content/50">Programs started here keep running when you close this page. Their output is saved in the .runtime folder of the project.</p>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-2">
            <h2 className="text-base font-semibold">What they stand on</h2>
            <ul className="rounded-xl border border-base-300 bg-base-100 divide-y divide-base-300">
              {status.infra.map((item) => (
                <li key={item.id} className="px-4 py-3 text-sm flex gap-3">
                  {item.up ? <CheckCircle2 className="h-5 w-5 text-success shrink-0" aria-label="Reachable" /> : <XCircle className="h-5 w-5 text-error shrink-0" aria-label="Not reachable" />}
                  <div>
                    <p className="font-medium">{item.label}</p>
                    <p className="text-xs text-base-content/60">{item.up ? "Reachable." : item.hint}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-2">
            <h2 className="text-base font-semibold">Settings</h2>
            <ul className="rounded-xl border border-base-300 bg-base-100 divide-y divide-base-300">
              {status.config.map((item) => (
                <li key={item.id} className="px-4 py-3 text-sm flex gap-3">
                  {item.ok ? <CheckCircle2 className="h-5 w-5 text-success shrink-0" aria-label="Set" /> : <XCircle className={`h-5 w-5 shrink-0 ${item.optional ? "text-warning" : "text-error"}`} aria-label="Missing" />}
                  <div>
                    <p className="font-medium">{item.label}{item.optional && <span className="badge badge-ghost badge-xs ml-2">optional</span>}</p>
                    <p className="text-xs text-base-content/60">{item.ok ? "Set." : `${item.impact} ${item.hint}`}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}
