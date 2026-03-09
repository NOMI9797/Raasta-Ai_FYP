"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import { Plus, Briefcase } from "lucide-react";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import CreateJobModal from "./components/CreateJobModal";
import JobCard from "./components/JobCard";

export default function HiringPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);

  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [generatingId, setGeneratingId] = useState(null);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/");
      return;
    }
    const role = session.user?.role;
    if (role !== "recruiter" && role !== "admin") {
      router.replace("/dashboard");
    }
  }, [session, status, router]);

  const fetchJobs = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/hiring/jobs");
      const data = await res.json();
      if (data.success) setJobs(data.jobs || []);
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
      toast.success("Job created successfully");
    } catch (err) {
      toast.error(err.message || "Failed to create job");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (jobId) => {
    try {
      const res = await fetch(`/api/hiring/jobs/${jobId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
      toast.success("Job deleted");
    } catch {
      toast.error("Failed to delete job");
    }
  };

  const handleGeneratePost = async (jobId) => {
    try {
      setGeneratingId(jobId);
      const applyUrl = `${window.location.origin}/apply/${jobId}`;
      const res = await fetch(`/api/hiring/jobs/${jobId}/generate-post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tone: "professional", applyUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setJobs((prev) =>
        prev.map((j) => (j.id === jobId ? { ...j, linkedinPost: data.linkedinPost } : j))
      );
      toast.success("LinkedIn post generated");
    } catch (err) {
      toast.error(err.message || "Failed to generate post");
    } finally {
      setGeneratingId(null);
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
  const role = session.user?.role;
  if (role !== "recruiter" && role !== "admin") return null;

  const draftCount = jobs.filter((j) => j.status === "draft").length;
  const publishedCount = jobs.filter((j) => j.status === "published").length;

  return (
    <div className="h-screen bg-base-100 flex overflow-hidden">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        activeSection="hiring"
      />
      <div
        className={`flex-1 transition-all duration-300 ${
          sidebarCollapsed ? "ml-16" : "ml-64"
        } flex flex-col h-full overflow-hidden`}
      >
        <TopBar />
        <main className="flex-1 p-6 overflow-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-base-content">Hiring</h1>
              <p className="text-sm text-base-content/70 mt-1">
                Create job preferences and generate AI-powered LinkedIn posts
              </p>
            </div>
            <button className="btn btn-primary btn-sm gap-1" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" /> New job
            </button>
          </div>

          {/* Summary cards */}
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

          {/* Job list */}
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <span className="loading loading-spinner loading-md text-primary" />
            </div>
          ) : jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-base-content/60 space-y-3">
              <Briefcase className="h-12 w-12" />
              <p className="font-semibold text-base-content">No jobs yet</p>
              <p className="text-sm">Create your first job to generate an AI LinkedIn post</p>
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
                  onGeneratePost={handleGeneratePost}
                  isGenerating={generatingId === job.id}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      <CreateJobModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={handleCreate}
        isSubmitting={creating}
      />
    </div>
  );
}
