"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";
import Checklist from "@/app/dashboard/recruiter/setup/components/Checklist";
import { PLATFORM_KIND } from "@/libs/sales/stages";
import { PLATFORM_LIST } from "@/libs/platforms/meta";

// How each platform fits into the sales steps, so the difference between people and companies is clear up front
const PLATFORM_FLOW = {
  person: "Add people → read their profile and posts → AI message → invite → message once connected",
  company: "Find companies that are hiring → research the company and a decision-maker → AI message → email or LinkedIn",
};

export default function SalesSetupPage() {
  const [guidance, setGuidance] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/sales/guidance")
      .then((r) => r.json())
      .then((data) => (data.success ? setGuidance(data.guidance) : setError(data.error || "Could not load the setup guide")))
      .catch(() => setError("Could not load the setup guide"));
  }, []);

  return (
    <DashboardShell title="Sales setup guide" activeSection="sales-setup">
      <div className="p-4 md:p-6 space-y-6 max-w-4xl">
        <div>
          <h1 className="text-2xl font-bold">Sales setup guide</h1>
          <p className="text-sm text-base-content/70 mt-1">
            Sales runs in eight steps, from a campaign to meetings and results. The checklist shows where you are; the first step not done yet is highlighted.
          </p>
        </div>

        {error ? (
          <div role="alert" className="alert alert-error text-sm">{error}</div>
        ) : !guidance ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <Checklist guidance={guidance} />
        )}

        <section className="space-y-3">
          <h2 className="font-semibold">How each platform works</h2>
          <div className="grid gap-3 md:grid-cols-3">
            {PLATFORM_LIST.map((p) => (
              <div key={p.id} className="rounded-xl border border-base-300 bg-base-100 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex h-7 w-7 items-center justify-center rounded text-xs font-bold text-white ${p.accent}`}>{p.initials}</span>
                  <span className="font-semibold">{p.label}</span>
                  <span className="badge badge-ghost badge-sm ml-auto">{PLATFORM_KIND[p.id] === "company" ? "Companies" : "People"}</span>
                </div>
                <p className="text-xs text-base-content/70">{PLATFORM_FLOW[PLATFORM_KIND[p.id]]}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}
