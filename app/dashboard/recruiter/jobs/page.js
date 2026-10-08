"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { Plus, Briefcase, Bot } from "lucide-react";
import { useDialog } from "@/components/ui/DialogProvider";
import GuidanceStrip from "@/components/system/GuidanceStrip";
import Sidebar from "@/components/layout/Sidebar";
import { useSidebar } from "@/components/layout/SidebarContext";
import TopBar from "@/components/layout/TopBar";
import CreateJobModal from "@/app/dashboard/hiring/components/CreateJobModal";
import JobCard from "@/app/dashboard/hiring/components/JobCard";
import PublishPanel from "../components/PublishPanel";

export default function RecruiterJobsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { confirm } = useDialog();
  const { collapsed: sidebarCollapsed, setCollapsed: setSidebarCollapsed } = useSidebar();

  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  // Bumped after each create so the modal remounts with an empty form
  const [createFormKey, setCreateFormKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [publishJob, setPublishJob] = useState(null); // job whose publish panel is open

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/");
      return;
    }
    const modes = Array.isArray(session.user?.modes) ? session.user.modes : [];
    const isAdmin = session.user?.role === "admin";
    if (!isAdmin && !modes.includes("recruiter")) {
      router.replace("/dashboard/home");
    }
  }, [session, status, router]);

  const fetchJobs = useCallback(async ({ quiet = false } = {}) => {
    try {
      if (!quiet) setLoading(true);
      const res = await fetch("/api/hiring/jobs");
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error);
      setJobs(data.jobs || []);
    } catch {
      toast.error("Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) fetchJobs();
  }, [session, fetchJobs]);

  const handleCreate = async (payload) => {
    try {
      setCreating(true);
      const res = await fetch("/api/hiring/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setJobs((prev) => [data.job, ...prev]);
      setShowCreate(false);
      setCreateFormKey((k) => k + 1);
      toast.success("Job created successfully");
    } catch (err) {
      toast.error(err.message || "Failed to create job");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (jobId) => {
    const job = jobs.find((j) => j.id === jobId);
    const ok = await confirm({
      title: `Delete "${job?.title || "this job"}"?`,
      message: "This also deletes all of its candidates, interviews and interview questions. It cannot be undone.",
      confirmText: "Delete job",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/hiring/jobs/${jobId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
      toast.success("Job deleted");
    } catch {
      toast.error("Failed to delete job");
    }
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center">
        <div className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

  if (!session) return null;

  const draftCount = jobs.filter((j) => j.status === "draft").length;
  const publishedCount = jobs.filter((j) => j.status === "published").length;

  return (
    <div className="h-screen bg-base-100 flex overflow-hidden">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        activeSection="recruiter-jobs"
      />
      <div
        className={`flex-1 min-w-0 transition-all duration-300 ${
          sidebarCollapsed ? "ml-16" : "ml-16 md:ml-64"
        } flex flex-col h-full overflow-hidden`}
      >
        <TopBar title="Jobs" />
        <main className="flex-1 p-6 overflow-auto space-y-6">
          <GuidanceStrip feature="screening" showNext />

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-base-content">Jobs</h1>
              <p className="text-sm text-base-content/70 mt-1">
                Create jobs, then publish a post written for each platform to LinkedIn, Rozee.pk and Indeed.
              </p>
            </div>
            <div className="flex gap-2">
              <Link href="/dashboard/recruiter/agent" className="btn btn-outline btn-sm gap-1">
                <Bot className="h-4 w-4" /> Hiring agent
              </Link>
              <button className="btn btn-primary btn-sm gap-1" onClick={() => setShowCreate(true)}>
                <Plus className="h-4 w-4" /> New job
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="stat bg-base-200 rounded-xl shadow-sm border border-base-300">
              <div className="stat-title text-xs uppercase tracking-wide text-base-content/60">
                Total jobs
              </div>
              <div className="stat-value text-2xl">{jobs.length}</div>
            </div>
            <div className="stat bg-base-200 rounded-xl shadow-sm border border-base-300">
              <div className="stat-title text-xs uppercase tracking-wide text-base-content/60">
                Drafts
              </div>
              <div className="stat-value text-2xl">{draftCount}</div>
            </div>
            <div className="stat bg-base-200 rounded-xl shadow-sm border border-base-300">
              <div className="stat-title text-xs uppercase tracking-wide text-base-content/60">
                Published
              </div>
              <div className="stat-value text-2xl text-success">{publishedCount}</div>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <span className="loading loading-spinner loading-md text-primary" />
            </div>
          ) : jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-base-content/60 space-y-3">
              <Briefcase className="h-12 w-12" />
              <p className="font-semibold text-base-content">No jobs yet</p>
              <p className="text-sm">Create your first job to generate an AI post</p>
              <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
                <Plus className="h-4 w-4 mr-1" /> Create job
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {jobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  onDelete={handleDelete}
                  onPublish={setPublishJob}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      {publishJob && (
        <PublishPanel
          key={publishJob.id}
          job={publishJob}
          onClose={() => setPublishJob(null)}
          onChanged={() => fetchJobs({ quiet: true })}
        />
      )}

      <CreateJobModal
        key={createFormKey}
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={handleCreate}
        isSubmitting={creating}
      />
    </div>
  );
}
