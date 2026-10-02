"use client";

import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import { useSidebar } from "./SidebarContext";

// Sidebar + top bar + scrolling content area used by dashboard pages
export default function DashboardShell({ title, activeSection, children }) {
  const { collapsed, toggle } = useSidebar();

  return (
    <div className="h-screen bg-base-100 flex overflow-hidden">
      <Sidebar collapsed={collapsed} onToggle={toggle} activeSection={activeSection} />
      <div
        className={`flex-1 min-w-0 transition-all duration-300 ${
          collapsed ? "ml-16" : "ml-16 md:ml-64"
        } flex flex-col h-full overflow-hidden`}
      >
        <TopBar title={title} />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
