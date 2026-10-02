"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Bot, CheckCheck, Gauge, Mic, UserPlus, AlertTriangle, PauseCircle } from "lucide-react";

const QUERY_KEY = ["notifications"];

const TYPE_ICONS = {
  new_application: { icon: UserPlus, tone: "text-info bg-info/10" },
  screening_complete: { icon: Gauge, tone: "text-success bg-success/10" },
  interview_completed: { icon: Mic, tone: "text-accent bg-accent/10" },
  agent_run_finished: { icon: Bot, tone: "text-primary bg-primary/10" },
  agent_run_failed: { icon: AlertTriangle, tone: "text-error bg-error/10" },
  agent_needs_approval: { icon: PauseCircle, tone: "text-warning bg-warning/10" },
};

function timeAgo(date) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

async function markRead(ids) {
  const res = await fetch("/api/notifications", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ids ? { ids } : {}),
  });
  if (!res.ok) throw new Error("Failed to update notifications");
  return res.json();
}

export default function NotificationBell() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await fetch("/api/notifications?limit=20");
      if (!res.ok) throw new Error("Failed to load notifications");
      return res.json();
    },
    refetchInterval: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  const mutation = useMutation({
    mutationFn: markRead,
    // Clear the badge immediately; the refetch below reconciles with the server
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData(QUERY_KEY);
      if (previous) {
        const now = new Date().toISOString();
        const notifications = previous.notifications.map((n) =>
          !n.readAt && (!ids || ids.includes(n.id)) ? { ...n, readAt: now } : n
        );
        const unread = ids ? Math.max(0, previous.unread - ids.length) : 0;
        queryClient.setQueryData(QUERY_KEY, { ...previous, notifications, unread });
      }
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(QUERY_KEY, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items = data?.notifications || [];
  const unread = data?.unread || 0;

  const openItem = (item) => {
    if (!item.readAt) mutation.mutate([item.id]);
    setOpen(false);
    if (item.link) router.push(item.link);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        className="btn btn-ghost btn-sm btn-circle relative"
        onClick={() => setOpen((o) => !o)}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-error text-error-content text-[10px] font-bold flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-base-100 border border-base-300 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-base-300">
            <p className="font-semibold text-sm">Notifications</p>
            <button
              className="btn btn-ghost btn-xs gap-1"
              onClick={() => mutation.mutate(null)}
              disabled={unread === 0 || mutation.isPending}
            >
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {isLoading ? (
              <div className="p-6 flex justify-center">
                <span className="loading loading-spinner loading-sm text-primary" />
              </div>
            ) : isError ? (
              <p className="p-6 text-sm text-center text-error">Couldn&apos;t load notifications.</p>
            ) : items.length === 0 ? (
              <div className="p-8 text-center">
                <Bell className="h-8 w-8 text-base-content/20 mx-auto mb-2" />
                <p className="text-sm font-medium">You&apos;re all caught up</p>
                <p className="text-xs text-base-content/60 mt-1">
                  New applications, screening results and agent updates show up here.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-base-300">
                {items.map((item) => {
                  const { icon: Icon, tone } = TYPE_ICONS[item.type] || { icon: Bell, tone: "text-base-content bg-base-200" };
                  return (
                    <li key={item.id}>
                      <button
                        className={`w-full text-left px-4 py-3 flex gap-3 hover:bg-base-200 transition-colors ${
                          item.readAt ? "" : "bg-primary/5"
                        }`}
                        onClick={() => openItem(item)}
                      >
                        <span className={`p-2 rounded-lg h-fit ${tone}`}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="flex items-start justify-between gap-2">
                            <span className={`text-sm ${item.readAt ? "" : "font-semibold"}`}>{item.title}</span>
                            {!item.readAt && <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" aria-label="Unread" />}
                          </span>
                          {item.body && (
                            <span className="block text-xs text-base-content/60 mt-0.5 line-clamp-2">{item.body}</span>
                          )}
                          <span className="block text-[11px] text-base-content/40 mt-1">{timeAgo(item.createdAt)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
