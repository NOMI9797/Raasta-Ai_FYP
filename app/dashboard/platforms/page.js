"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import RozeeAccountsPanel from "@/app/dashboard/accounts/components/RozeeAccountsPanel";
import LinkedInAccountsPanel from "./components/LinkedInAccountsPanel";
import { Plug, CheckCircle2 } from "lucide-react";
import { PLATFORM_LIST } from "@/libs/platforms/meta";

const PLATFORMS = PLATFORM_LIST;

export default function PlatformsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [active, setActive] = useState("linkedin");

  useEffect(() => {
    if (status === "loading") return;
    if (!session) router.push("/");
  }, [session, status, router]);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center">
        <div className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }
  if (!session) return null;

  const activeMeta = PLATFORMS.find((p) => p.id === active);

  return (
    <div className="min-h-screen bg-base-100 flex">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        activeSection="platforms"
      />
      <div className={`flex-1 transition-all duration-300 ${sidebarCollapsed ? "ml-16" : "ml-64"} flex flex-col`}>
        <TopBar title="Platforms" />
        <main className="flex-1 p-6 space-y-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Plug className="h-6 w-6" /> Platforms
            </h1>
            <p className="text-sm text-base-content/70 mt-1">
              Connect and manage accounts used across Recruiter and Sales modes.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {PLATFORMS.map((p) => {
              const isActive = active === p.id;
              return (
                <button
                  key={p.id}
                  disabled={p.comingSoon}
                  onClick={() => !p.comingSoon && setActive(p.id)}
                  className={`text-left p-4 rounded-xl border-2 transition-all ${
                    isActive
                      ? "border-primary bg-primary/5"
                      : "border-base-300 hover:border-base-content/30"
                  } ${p.comingSoon ? "opacity-60 cursor-not-allowed" : ""}`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${p.accent}`}>
                      <span className="text-white text-sm font-bold">{p.initials}</span>
                    </div>
                    <div className="font-semibold">{p.label}</div>
                    {isActive && <CheckCircle2 className="h-4 w-4 text-primary ml-auto" />}
                    {p.comingSoon && (
                      <span className="badge badge-ghost badge-sm ml-auto">Coming soon</span>
                    )}
                  </div>
                  <div className="text-xs text-base-content/60">{p.description}</div>
                </button>
              );
            })}
          </div>

          <div className="card bg-base-100 border border-base-300">
            <div className="card-body">
              <div className="flex items-center gap-2 mb-3 pb-3 border-b border-base-300">
                <div className={`w-8 h-8 rounded flex items-center justify-center ${activeMeta?.accent}`}>
                  <span className="text-white text-xs font-bold">{activeMeta?.initials}</span>
                </div>
                <h2 className="text-lg font-semibold">{activeMeta?.label} Accounts</h2>
              </div>
              {active === "linkedin" && <LinkedInAccountsPanel />}
              {active === "rozee" && <RozeeAccountsPanel />}
              {active === "indeed" && (
                <div className="space-y-3 text-sm text-base-content/80 py-4">
                  <p className="font-medium text-base-content">
                    Indeed runs from your Raasta server — no Indeed login in the app.
                  </p>
                  <p>
                    Your deployment admin enables job search the same way as other scraping features. Use Lead Scraper
                    to pick keywords, location, and optional country.
                  </p>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
