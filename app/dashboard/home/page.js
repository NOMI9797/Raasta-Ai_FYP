"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import {
  Briefcase,
  Target,
  Users,
  UserCheck,
  Plug,
  ArrowRight,
  Bot,
} from "lucide-react";

export default function HomePage() {
  const { data: session } = useSession();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [stats, setStats] = useState({ loading: true });

  const modes = Array.isArray(session?.user?.modes) ? session.user.modes : [];
  const isAdmin = session?.user?.role === "admin";
  const showRecruiter = isAdmin || modes.includes("recruiter");
  const showSales = isAdmin || modes.includes("sales");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const promises = [];
        if (showRecruiter) promises.push(fetch("/api/hiring/jobs").then((r) => r.json()).catch(() => null));
        else promises.push(Promise.resolve(null));
        if (showSales) promises.push(fetch("/api/campaigns").then((r) => r.json()).catch(() => null));
        else promises.push(Promise.resolve(null));
        const [jobsData, campaignsData] = await Promise.all(promises);
        if (cancelled) return;
        setStats({
          loading: false,
          jobs: jobsData?.jobs?.length ?? 0,
          publishedJobs: jobsData?.jobs?.filter((j) => j.status === "published").length ?? 0,
          campaigns: campaignsData?.campaigns?.length ?? 0,
          activeCampaigns: campaignsData?.campaigns?.filter((c) => c.status === "active").length ?? 0,
        });
      } catch {
        if (!cancelled) setStats({ loading: false });
      }
    })();
    return () => { cancelled = true; };
  }, [showRecruiter, showSales]);

  return (
    <div className="min-h-screen bg-base-100 flex">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        activeSection="home"
      />
      <div className={`flex-1 transition-all duration-300 ${sidebarCollapsed ? "ml-16" : "ml-64"} flex flex-col`}>
        <TopBar title="Home" />
        <main className="flex-1 p-6 space-y-6">
          <div>
            <h1 className="text-2xl font-bold">
              Welcome back{session?.user?.name ? `, ${session.user.name.split(" ")[0]}` : ""}
            </h1>
            <p className="text-sm text-base-content/70 mt-1">
              {modes.length > 0
                ? `Working in ${modes.map(capitalize).join(" & ")} mode`
                : "Admin overview"}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {showRecruiter && (
              <>
                <StatCard icon={Briefcase} label="Total jobs" value={stats.jobs ?? 0} loading={stats.loading} />
                <StatCard icon={UserCheck} label="Published jobs" value={stats.publishedJobs ?? 0} loading={stats.loading} accent="text-success" />
              </>
            )}
            {showSales && (
              <>
                <StatCard icon={Target} label="Total campaigns" value={stats.campaigns ?? 0} loading={stats.loading} />
                <StatCard icon={Users} label="Active campaigns" value={stats.activeCampaigns ?? 0} loading={stats.loading} accent="text-success" />
              </>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {showRecruiter && (
              <QuickCard
                title="Recruiter"
                description="Post jobs, review candidates, and move them through the hiring pipeline."
                links={[
                  { href: "/dashboard/recruiter/jobs", label: "Manage Jobs" },
                  { href: "/dashboard/recruiter/candidates", label: "View Candidates" },
                  { href: "/dashboard/recruiter/pipeline", label: "Hiring Pipeline" },
                ]}
              />
            )}
            {showSales && (
              <QuickCard
                title="Sales"
                description="Run outreach campaigns, collect leads, and track conversations."
                links={[
                  { href: "/dashboard/sales/campaigns", label: "Campaigns" },
                  { href: "/dashboard/sales/leads", label: "Leads" },
                  { href: "/dashboard/sales/outreach", label: "Outreach" },
                ]}
              />
            )}
            <QuickCard
              title="Platforms"
              description="Connect LinkedIn, Rozee.pk, and Indeed accounts used across both modes."
              links={[{ href: "/dashboard/platforms", label: "Manage Platforms" }]}
              icon={Plug}
            />
            <QuickCard
              title="Agents"
              description="Run recruiter and sales automation pipelines end-to-end."
              links={[{ href: "/dashboard/agents", label: "Open Agents" }]}
              icon={Bot}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function StatCard({ icon: Icon, label, value, loading, accent }) {
  return (
    <div className="card bg-base-200 border border-base-300">
      <div className="card-body py-4 px-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-base-300 rounded-lg flex items-center justify-center">
            <Icon className="h-5 w-5 text-base-content/70" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-base-content/60">{label}</div>
            <div className={`text-2xl font-bold ${accent ?? ""}`}>
              {loading ? <span className="loading loading-dots loading-sm" /> : value}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuickCard({ title, description, links, icon: Icon }) {
  return (
    <div className="card bg-base-200 border border-base-300">
      <div className="card-body">
        <div className="flex items-center gap-2 mb-1">
          {Icon && <Icon className="h-5 w-5 text-primary" />}
          <h2 className="card-title">{title}</h2>
        </div>
        <p className="text-sm text-base-content/70 mb-3">{description}</p>
        <div className="flex flex-wrap gap-2">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="btn btn-sm btn-outline gap-1">
              {l.label} <ArrowRight className="h-3 w-3" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
