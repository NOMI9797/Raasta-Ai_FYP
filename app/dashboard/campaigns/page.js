"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import CampaignsList from "@/app/dashboard/campaigns/components/CampaignsList";
import CampaignWorkspace from "@/app/dashboard/campaigns/components/CampaignWorkspace";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import toast from "react-hot-toast";
import { Bot, Loader2 } from "lucide-react";

export default function CampaignsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [launchingAgent, setLaunchingAgent] = useState(false);

  const handleLaunchSalesAgent = async () => {
    setLaunchingAgent(true);
    try {
      const res = await fetch("/api/agents/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipelineType: "sales_operator", mode: "semi_auto", config: {} }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Sales agent launched! Check the Agents page for status.");
        router.push("/dashboard/agents");
      } else {
        toast.error(data.error || "Failed to launch agent");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setLaunchingAgent(false);
    }
  };

  // Redirect if not authenticated or not allowed (campaigns: sales_operator, admin)
  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/");
      return;
    }
    const role = session.user?.role;
    if (role !== "sales_operator" && role !== "admin") {
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
  if (session.user?.role !== "sales_operator" && session.user?.role !== "admin") return null;

  return (
    <div className="h-screen bg-base-100 flex overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        activeSection="campaigns"
      />

      {/* Main Content */}
      <div className={`flex-1 transition-all duration-300 ${
        sidebarCollapsed ? "ml-16" : "ml-64"
      } flex flex-col h-full overflow-hidden`}>
        {/* Top Bar */}
        <div className="flex-shrink-0 flex items-center">
          <div className="flex-1">
            <TopBar title="Campaigns" />
          </div>
          {!selectedCampaign && (
            <div className="pr-4">
              <button
                className="btn btn-outline btn-sm gap-1"
                onClick={handleLaunchSalesAgent}
                disabled={launchingAgent}
              >
                {launchingAgent ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                Run Agent
              </button>
            </div>
          )}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-hidden min-h-0">
          {selectedCampaign ? (
            <CampaignWorkspace
              campaign={selectedCampaign}
              onBack={() => setSelectedCampaign(null)}
            />
          ) : (
            <CampaignsList onSelectCampaign={setSelectedCampaign} />
          )}
        </div>
      </div>
    </div>
  );
}

