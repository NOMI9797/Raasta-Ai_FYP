"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useSystemStatus } from "@/components/system/useSystem";
import {
  Home,
  Briefcase,
  Users,
  LayoutGrid,
  TrendingUp,
  UserCheck,
  MessageSquare,
  Target,
  Plug,
  Shield,
  Bot,
  Settings,
  BarChart3,
  Radar,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Gavel,
  Video,
  Activity,
  Send,
  BookOpen,
} from "lucide-react";

const NAV = [
  {
    key: "home",
    label: "Home",
    href: "/dashboard/home",
    icon: Home,
  },
  {
    key: "recruiter",
    label: "Recruiter",
    icon: Briefcase,
    requireMode: "recruiter",
    children: [
      { key: "recruiter-jobs", label: "Jobs", href: "/dashboard/recruiter/jobs", icon: Briefcase },
      { key: "recruiter-candidates", label: "Candidates", href: "/dashboard/recruiter/candidates", icon: Users },
      { key: "recruiter-pipeline", label: "Pipeline", href: "/dashboard/recruiter/pipeline", icon: LayoutGrid },
      { key: "recruiter-interviews", label: "Interviews", href: "/dashboard/recruiter/interviews", icon: Video },
      { key: "recruiter-decisions", label: "Decisions", href: "/dashboard/recruiter/decisions", icon: Gavel },
      { key: "recruiter-agent", label: "Hiring agent", href: "/dashboard/recruiter/agent", icon: Bot },
      { key: "recruiter-setup", label: "Setup guide", href: "/dashboard/recruiter/setup", icon: Activity },
    ],
  },
  {
    key: "sales",
    label: "Sales",
    icon: Target,
    requireMode: "sales",
    children: [
      // The steps of the sales pipeline, in order (libs/sales/stages.js)
      { key: "sales-campaigns", label: "1. Campaigns", href: "/dashboard/sales/campaigns", icon: Target },
      { key: "sales-find", label: "2. Find leads", href: "/dashboard/sales/find-leads", icon: Radar },
      { key: "sales-research", label: "3. Research", href: "/dashboard/sales/research", icon: UserCheck },
      { key: "sales-messages", label: "4. Messages", href: "/dashboard/sales/messages", icon: MessageSquare },
      { key: "sales-outreach", label: "5. Outreach", href: "/dashboard/sales/outreach", icon: Send },
      { key: "sales-results", label: "6. Results", href: "/dashboard/sales/results", icon: TrendingUp },
      { key: "sales-knowledge", label: "Knowledge base", href: "/dashboard/sales/knowledge", icon: BookOpen },
      { key: "sales-agent", label: "Sales agent", href: "/dashboard/agents", icon: Bot },
      { key: "sales-setup", label: "Setup guide", href: "/dashboard/sales/setup", icon: Activity },
    ],
  },
  {
    key: "platforms",
    label: "Platforms",
    href: "/dashboard/platforms",
    icon: Plug,
  },
  {
    key: "analytics",
    label: "Analytics",
    href: "/dashboard/analytics",
    icon: BarChart3,
  },
  {
    key: "settings",
    label: "Settings",
    href: "/dashboard/settings",
    icon: Settings,
  },
  {
    key: "admin",
    label: "Admin",
    href: "/dashboard/admin",
    icon: Shield,
    requireRole: "admin",
  },
];

function isActive(pathname, href, activeSection, key) {
  if (activeSection && activeSection === key) return true;
  if (!href) return false;
  if (pathname === href) return true;
  if (href !== "/dashboard" && pathname.startsWith(href + "/")) return true;
  return false;
}

export default function Sidebar({ collapsed, onToggle, activeSection = "" }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = session?.user?.role ?? "sales_operator";
  const modes = Array.isArray(session?.user?.modes) ? session.user.modes : [];
  const isAdmin = role === "admin";

  // A coloured dot on Recruiter and Setup guide when a hiring program is off or Redis / the database is down
  const showHiring = isAdmin || modes.includes("recruiter");
  const system = useSystemStatus({ enabled: showHiring, interval: 20000 });
  const systemOverall = system.data?.status?.overall;
  const systemDot = systemOverall === "blocked" ? "bg-error" : systemOverall === "degraded" ? "bg-warning" : null;

  const visibleItems = useMemo(() => {
    return NAV.filter((item) => {
      if (item.requireRole && item.requireRole !== role) return false;
      if (item.requireMode && !isAdmin && !modes.includes(item.requireMode)) return false;
      return true;
    });
  }, [role, modes, isAdmin]);

  const [openGroups, setOpenGroups] = useState(() => {
    const open = {};
    for (const item of NAV) {
      if (item.children && item.children.some((c) => pathname.startsWith(c.href))) {
        open[item.key] = true;
      }
    }
    return open;
  });

  const toggleGroup = (key) => {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Collapsed groups have nowhere to show their children: expand the sidebar and open the group
  const handleGroupClick = (key) => {
    if (collapsed) {
      setOpenGroups((prev) => ({ ...prev, [key]: true }));
      onToggle?.();
      return;
    }
    toggleGroup(key);
  };

  // On phones the expanded sidebar floats over the page: close it after navigating
  const closeOnMobile = () => {
    if (!collapsed && window.matchMedia("(max-width: 767px)").matches) onToggle?.();
  };

  return (
    <>
    {!collapsed && (
      <div className="fixed inset-0 bg-black/30 z-40 md:hidden" onClick={onToggle} aria-hidden="true" />
    )}
    <div
      className={`bg-base-200 border-r border-base-300 transition-all duration-300 flex flex-col fixed left-0 top-0 h-screen z-50 ${
        collapsed ? "w-16" : "w-64"
      }`}
    >
      {/* Header */}
      <div className="p-4 border-b border-base-300">
        <div className="flex items-center justify-between">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <Target className="h-5 w-5 text-primary-content" />
              </div>
              <span className="font-bold text-lg text-base-content">Raasta-AI</span>
            </div>
          )}
          <button
            onClick={onToggle}
            className="btn btn-ghost btn-sm btn-circle"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2 overflow-y-auto min-h-0" aria-label="Main">
        <div className="space-y-1">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            if (item.children) {
              const groupOpen = !collapsed && (openGroups[item.key] ?? false);
              const anyChildActive = item.children.some((c) =>
                isActive(pathname, c.href, activeSection, c.key)
              );
              return (
                <div key={item.key}>
                  <button
                    onClick={() => handleGroupClick(item.key)}
                    aria-expanded={groupOpen}
                    aria-label={collapsed ? item.label : undefined}
                    title={collapsed ? item.label : undefined}
                    className={`btn btn-ghost w-full justify-start gap-3 h-12 ${
                      anyChildActive
                        ? "bg-primary/10 text-primary hover:bg-primary/15"
                        : "text-base-content hover:bg-base-300"
                    } ${collapsed ? "px-2" : "px-4"}`}
                  >
                    <Icon className={`h-5 w-5 flex-shrink-0 ${anyChildActive ? "text-primary" : ""}`} />
                    {!collapsed && (
                      <>
                        <span className={`truncate font-medium flex-1 text-left ${anyChildActive ? "text-primary" : ""}`}>
                          {item.label}
                        </span>
                        {item.key === "recruiter" && systemDot && <span className={`h-2 w-2 rounded-full ${systemDot}`} role="img" aria-label="A hiring program needs attention" />}
                        <ChevronDown
                          className={`h-4 w-4 transition-transform ${groupOpen ? "rotate-180" : ""}`}
                        />
                      </>
                    )}
                  </button>
                  {groupOpen && !collapsed && (
                    <div className="ml-4 mt-1 space-y-1 border-l border-base-300 pl-2">
                      {item.children.map((child) => {
                        const ChildIcon = child.icon;
                        const active = isActive(pathname, child.href, activeSection, child.key);
                        return (
                          <Link
                            key={child.key}
                            href={child.href}
                            aria-current={active ? "page" : undefined}
                            onClick={closeOnMobile}
                            className={`btn btn-ghost w-full justify-start gap-3 h-10 px-3 ${
                              active
                                ? "bg-primary/10 text-primary hover:bg-primary/15"
                                : "text-base-content hover:bg-base-300"
                            }`}
                          >
                            <ChildIcon className={`h-4 w-4 flex-shrink-0 ${active ? "text-primary" : ""}`} />
                            <span className={`truncate text-sm ${active ? "text-primary font-medium" : ""}`}>
                              {child.label}
                            </span>
                            {child.key === "recruiter-setup" && systemDot && <span className={`ml-auto h-2 w-2 rounded-full ${systemDot}`} role="img" aria-label="Needs attention" />}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            const active = isActive(pathname, item.href, activeSection, item.key);
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-label={collapsed ? item.label : undefined}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                onClick={closeOnMobile}
                className={`btn btn-ghost w-full justify-start gap-3 h-12 ${
                  active
                    ? "bg-primary/10 text-primary hover:bg-primary/15"
                    : "text-base-content hover:bg-base-300"
                } ${collapsed ? "px-2" : "px-4"}`}
              >
                <Icon className={`h-5 w-5 flex-shrink-0 ${active ? "text-primary" : ""}`} />
                {!collapsed && (
                  <span className={`truncate font-medium ${active ? "text-primary" : ""}`}>
                    {item.label}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-base-300">
        {!collapsed ? (
          <div className="text-xs text-base-content/60 text-center">
            <div className="font-semibold">Raasta-AI v1.0</div>
            <div>Outreach & Hiring</div>
          </div>
        ) : (
          <div className="flex justify-center">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <Target className="h-4 w-4 text-primary-content" />
            </div>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
