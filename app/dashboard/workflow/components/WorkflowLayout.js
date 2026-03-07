"use client";

import { useState } from "react";
import { Users, Workflow, BarChart3, Settings as SettingsIcon } from "lucide-react";

export default function WorkflowLayout({
  AudienceTab,
  SequenceTab,
  StatisticsTab,
  SettingsTab,
}) {
  const [activeTab, setActiveTab] = useState("sequence");

  const tabs = [
    { id: "audience", label: "Audience", icon: Users },
    { id: "sequence", label: "Sequence", icon: Workflow },
    { id: "statistics", label: "Statistics", icon: BarChart3 },
    { id: "settings", label: "Settings", icon: SettingsIcon },
  ];

  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-base-300 bg-base-100">
        <div className="max-w-7xl mx-auto px-4">
          <nav className="flex items-center gap-4 overflow-x-auto py-3" aria-label="Workflow tabs">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`whitespace-nowrap inline-flex items-center gap-2 px-2 sm:px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === t.id
                    ? "border-primary text-primary"
                    : "border-transparent text-base-content/80 hover:text-base-content"
                }`}
                title={t.label}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {activeTab === "audience" && <AudienceTab />}
        {activeTab === "sequence" && <SequenceTab />}
        {activeTab === "statistics" && <StatisticsTab />}
        {activeTab === "settings" && <SettingsTab />}
      </div>
    </div>
  );
}
