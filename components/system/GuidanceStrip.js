"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Compass, Loader2, Play, ShieldAlert } from "lucide-react";
import { FEATURE_NEEDS, FEATURE_WHY, sentenceName } from "@/libs/system/features";
import { SETUP_PATH } from "@/libs/system/paths";
import { useSystemStatus } from "./useSystem";
import { useServiceGuard } from "./useServiceGuard";

const names = (list) => list.map((s) => sentenceName(s.label)).join(", ").replace(/, ([^,]*)$/, " and $1");

/**
 * The little guide at the top of a screen. It says, only when it matters:
 *   - Postgres or Redis is down (nothing can work),
 *   - a program this screen depends on is off (with a Start button),
 *   - something is waiting for the person (agent approvals),
 *   - and, with `showNext`, the next step of the hiring flow.
 * `feature` is one of agent | screening | invites | interviews (libs/system/features.js).
 */
export default function GuidanceStrip({ feature, showNext = false }) {
  const { data } = useSystemStatus({ guidance: true });
  const { startPrograms } = useServiceGuard();
  const [starting, setStarting] = useState(false);

  if (!data || data.forbidden || !data.status) return null;
  const { status, guidance } = data;
  const missing = (FEATURE_NEEDS[feature] || []).map((id) => status.services.find((s) => s.id === id)).filter((s) => s && s.state !== "running");
  const booting = missing.some((s) => s.state === "starting");
  const startable = status.controlEnabled && missing.length > 0 && missing.every((s) => s.canStart);
  const infraDown = status.infra.filter((i) => !i.up);

  const start = async () => {
    setStarting(true);
    try {
      await startPrograms(missing.map((s) => s.id));
    } finally {
      setStarting(false);
    }
  };

  const alerts = [];
  if (infraDown.length) {
    alerts.push(
      <div key="infra" role="alert" className="alert alert-error text-sm items-start">
        <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="font-semibold">{status.summary}</p>
          <p className="text-xs opacity-80">{infraDown[0].hint}</p>
        </div>
        <Link href={SETUP_PATH} className="btn btn-sm !normal-case">Open setup</Link>
      </div>
    );
  } else if (missing.length) {
    alerts.push(
      <div key="missing" role="alert" className="alert alert-warning text-sm items-start">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="font-semibold">{`The ${names(missing)} ${missing.length === 1 ? "is" : "are"} not running.`}</p>
          <p className="text-xs opacity-80">{FEATURE_WHY[feature]}</p>
        </div>
        {booting || starting ? (
          <span className="flex items-center gap-1 text-xs"><Loader2 className="h-4 w-4 animate-spin" /> Starting</span>
        ) : startable ? (
          <button type="button" className="btn btn-sm !normal-case gap-1" onClick={start}><Play className="h-3.5 w-3.5" /> Start now</button>
        ) : (
          <Link href={SETUP_PATH} className="btn btn-sm !normal-case">Setup guide</Link>
        )}
      </div>
    );
  }

  for (const item of guidance?.attention || []) {
    if (item.id === "worker-waiting" && missing.length) continue; // the warning above already says it
    alerts.push(
      <div key={item.id} role="status" className="alert alert-info text-sm">
        <Compass className="h-4 w-4 shrink-0" />
        <div className="flex-1">
          <p className="font-semibold">{item.title}</p>
          <p className="text-xs opacity-80">{item.detail}</p>
        </div>
        <Link href={item.href} className="btn btn-sm !normal-case">{item.cta}</Link>
      </div>
    );
  }

  const next = guidance?.next;
  if (showNext && next && alerts.length === 0) {
    alerts.push(
      <div key="next" className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
        <Compass className="h-4 w-4 text-primary shrink-0" />
        <div className="flex-1 min-w-[12rem]">
          <p className="font-semibold">Next: {next.title}</p>
          <p className="text-xs text-base-content/70">{next.detail}</p>
        </div>
        <Link href={next.href} className="btn btn-primary btn-sm !normal-case gap-1">{next.cta} <ArrowRight className="h-3.5 w-3.5" /></Link>
      </div>
    );
  }

  return alerts.length ? <div className="space-y-2">{alerts}</div> : null;
}
