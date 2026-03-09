"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import {
  Briefcase,
  Users,
  Star,
  FileText,
  Plus,
  ArrowRight,
  TrendingUp,
  Clock,
  CheckCircle2,
  XCircle,
  Eye,
  Sparkles,
} from "lucide-react";

export default function RecruiterDashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);

  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) { router.push("/"); return; }
    const role = session.user?.role;
    if (role !== "recruiter" && role !== "admin") {
      router.replace("/dashboard");
    }
  }, [session, status, router]);

  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch("/api/hiring/jobs");
      const data = await res.json();
      if (data.success) setJobs(data.jobs || []);
    } catch {
      // silent fail on overview
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) fetchOverview();
  }, [session, fetchOverview]);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center">
        <div className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }
  if (!session) return null;
  const role = session.user?.role;
  if (role !== "recruiter" && role !== "admin") return null;

  // Derived stats
  const totalJobs = jobs.length;
  const publishedJobs = jobs.filter((j) => j.status === "published").length;
  const draftJobs = jobs.filter((j) => j.status === "draft").length;
  const recentJobs = [...jobs].slice(0, 5);

  const firstName = session.user?.name?.split(" ")[0] || "there";

  return (
    <div className="h-screen bg-base-100 flex overflow-hidden">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        activeSection="recruiter"
      />
      <div
        className={`flex-1 transition-all duration-300 ${
          sidebarCollapsed ? "ml-16" : "ml-64"
        } flex flex-col h-full overflow-hidden`}
      >
        <TopBar title="Recruiter Dashboard" />
        <main className="flex-1 p-6 overflow-auto space-y-6">

          {/* Welcome banner */}
          <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-base-200 rounded-2xl border border-primary/20 p-6 flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-base-content">
                Welcome back, {firstName} 👋
              </h1>
              <p className="text-sm text-base-content/60 mt-1">
                Manage your open roles, review candidates, and generate AI-powered job posts.
              </p>
            </div>
            <Link href="/dashboard/hiring" className="btn btn-primary btn-sm gap-2 shrink-0">
              <Plus className="h-4 w-4" /> New Job
            </Link>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard
              icon={<Briefcase className="h-5 w-5 text-primary" />}
              label="Total jobs"
              value={loading ? "—" : totalJobs}
              bg="bg-primary/10"
            />
            <StatCard
              icon={<CheckCircle2 className="h-5 w-5 text-success" />}
              label="Published"
              value={loading ? "—" : publishedJobs}
              bg="bg-success/10"
            />
            <StatCard
              icon={<Clock className="h-5 w-5 text-warning" />}
              label="Drafts"
              value={loading ? "—" : draftJobs}
              bg="bg-warning/10"
            />
            <StatCard
              icon={<TrendingUp className="h-5 w-5 text-secondary" />}
              label="Active pipeline"
              value={loading ? "—" : publishedJobs}
              bg="bg-secondary/10"
            />
          </div>

          {/* Quick actions */}
          <div>
            <h2 className="text-sm font-semibold text-base-content/70 uppercase tracking-wider mb-3">
              Quick actions
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <QuickAction
                href="/dashboard/hiring"
                icon={<Briefcase className="h-5 w-5" />}
                title="Manage Jobs"
                desc="View, create, and edit job openings"
                color="text-primary"
              />
              <QuickAction
                href="/dashboard/hiring"
                icon={<Sparkles className="h-5 w-5" />}
                title="Generate AI Post"
                desc="Create a LinkedIn post for any open role"
                color="text-secondary"
              />
              <QuickAction
                href="/dashboard/statistics"
                icon={<TrendingUp className="h-5 w-5" />}
                title="Statistics"
                desc="View your overall activity stats"
                color="text-accent"
              />
            </div>
          </div>

          {/* Recent jobs */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-base-content/70 uppercase tracking-wider">
                Recent jobs
              </h2>
              <Link href="/dashboard/hiring" className="text-xs text-primary hover:underline flex items-center gap-1">
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-10">
                <span className="loading loading-spinner loading-md text-primary" />
              </div>
            ) : recentJobs.length === 0 ? (
              <div className="bg-base-200 rounded-xl border border-base-300 p-10 text-center">
                <Briefcase className="h-10 w-10 text-base-content/20 mx-auto mb-3" />
                <p className="font-semibold text-base-content">No jobs yet</p>
                <p className="text-sm text-base-content/60 mb-4">
                  Create your first job to start building your pipeline
                </p>
                <Link href="/dashboard/hiring" className="btn btn-primary btn-sm gap-1">
                  <Plus className="h-4 w-4" /> Create job
                </Link>
              </div>
            ) : (
              <div className="bg-base-200 rounded-xl border border-base-300 overflow-hidden">
                <table className="table table-sm w-full">
                  <thead>
                    <tr className="border-b border-base-300 text-base-content/60 text-xs uppercase">
                      <th className="font-semibold px-4 py-3">Job title</th>
                      <th className="font-semibold px-4 py-3 hidden sm:table-cell">Location</th>
                      <th className="font-semibold px-4 py-3 hidden sm:table-cell">Type</th>
                      <th className="font-semibold px-4 py-3">Status</th>
                      <th className="font-semibold px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentJobs.map((job) => (
                      <tr key={job.id} className="border-b border-base-300/50 last:border-0 hover:bg-base-300/30 transition-colors">
                        <td className="px-4 py-3">
                          <span className="font-medium text-sm text-base-content">{job.title}</span>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <span className="text-xs text-base-content/60">
                            {job.location || "—"} {job.locationType ? `(${job.locationType})` : ""}
                          </span>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <span className="text-xs text-base-content/60">{job.employmentType || "—"}</span>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={job.status} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/dashboard/hiring/${job.id}/candidates`}
                            className="btn btn-ghost btn-xs gap-1"
                          >
                            <Users className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Candidates</span>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </main>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, bg }) {
  return (
    <div className="bg-base-200 border border-base-300 rounded-xl p-4 flex items-center gap-3">
      <div className={`${bg} rounded-lg p-2 shrink-0`}>{icon}</div>
      <div>
        <p className="text-xs text-base-content/60">{label}</p>
        <p className="text-xl font-bold text-base-content">{value}</p>
      </div>
    </div>
  );
}

function QuickAction({ href, icon, title, desc, color }) {
  return (
    <Link
      href={href}
      className="bg-base-200 border border-base-300 rounded-xl p-4 flex items-start gap-3 hover:bg-base-300/60 transition-colors group"
    >
      <div className={`${color} mt-0.5 shrink-0`}>{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-base-content">{title}</p>
        <p className="text-xs text-base-content/60 mt-0.5">{desc}</p>
      </div>
      <ArrowRight className="h-4 w-4 text-base-content/30 group-hover:text-base-content/60 transition-colors mt-0.5 shrink-0" />
    </Link>
  );
}

function StatusBadge({ status }) {
  const map = {
    draft: "badge-ghost",
    published: "badge-success",
    closed: "badge-error",
  };
  return (
    <span className={`badge badge-xs ${map[status] || "badge-ghost"}`}>{status}</span>
  );
}
