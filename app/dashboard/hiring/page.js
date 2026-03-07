"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";

export default function HiringPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);

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

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center">
        <div className="loading loading-spinner loading-lg text-primary"></div>
      </div>
    );
  }

  if (!session) return null;
  const role = session.user?.role;
  if (role !== "recruiter" && role !== "admin") return null;

  return (
    <div className="h-screen bg-base-100 flex overflow-hidden">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} activeSection="hiring" />
      <div className={`flex-1 transition-all duration-300 ${sidebarCollapsed ? "ml-16" : "ml-64"} flex flex-col h-full overflow-hidden`}>
        <TopBar />
        <main className="flex-1 p-6 overflow-auto">
          <h1 className="text-2xl font-bold text-base-content">Hiring</h1>
          <p className="mt-2 text-base-content/70">Job posts and candidate pipeline — coming in a later commit.</p>
        </main>
      </div>
    </div>
  );
}
