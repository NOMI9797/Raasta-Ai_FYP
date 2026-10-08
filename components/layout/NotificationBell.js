"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, Settings } from "lucide-react";
import {
  markNotificationsRead,
  metaFor,
  notificationKeys,
  timeAgo,
  useNotificationFeed,
  useNow,
} from "./notification-utils";

export default function NotificationBell() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const now = useNow();

  const { data, isLoading, isError } = useNotificationFeed();

  const mutation = useMutation({
    mutationFn: markNotificationsRead,
    // Clear the badge immediately; the refetch below reconciles with the server
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.all });
      const previous = queryClient.getQueryData(notificationKeys.bell);
      if (previous) {
        const readAt = new Date().toISOString();
        let cleared = 0;
        const list = previous.notifications.map((n) => {
          if (n.readAt || (ids && !ids.includes(n.id))) return n;
          cleared += 1;
          return { ...n, readAt };
        });
        // Unread ones beyond the 20 shown still count, so subtract only what changed here
        const unread = ids ? Math.max(0, previous.unread - cleared) : 0;
        queryClient.setQueryData(notificationKeys.bell, { ...previous, notifications: list, unread });
      }
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(notificationKeys.bell, context.previous);
    },
    // Settings shows the same notifications under another key: refresh them all
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
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
            <p className="font-semibold text-sm">
              Notifications
              {unread > 0 && <span className="ml-2 badge badge-primary badge-sm">{unread} new</span>}
            </p>
            <button
              className="btn btn-ghost btn-xs gap-1"
              onClick={() => mutation.mutate(undefined)}
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
                  const { icon: Icon, tone } = metaFor(item.type);
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
                          <span className="block text-[11px] text-base-content/50 mt-1">{timeAgo(item.createdAt, now)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <Link
            href="/dashboard/settings#notifications"
            onClick={() => setOpen(false)}
            className="flex items-center justify-center gap-2 px-4 py-2.5 border-t border-base-300 text-xs font-medium text-primary hover:bg-base-200 transition-colors"
          >
            <Settings className="h-3.5 w-3.5" /> All notifications &amp; settings
          </Link>
        </div>
      )}
    </div>
  );
}
