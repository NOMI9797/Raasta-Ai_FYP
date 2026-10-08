"use client";

// Shared by the top-bar bell, the Settings notification list and the Home activity feed.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, Bot, Gauge, Mic, UserPlus, AlertTriangle, PauseCircle, MessagesSquare, CalendarCheck } from "lucide-react";

export const notificationKeys = {
  all: ["notifications"],
  bell: ["notifications", "bell"],
  history: (unreadOnly) => ["notifications", "history", unreadOnly ? "unread" : "all"],
};

export const TYPE_META = {
  new_application: { icon: UserPlus, tone: "text-info bg-info/10", label: "Application" },
  screening_complete: { icon: Gauge, tone: "text-success bg-success/10", label: "Screening" },
  interview_completed: { icon: Mic, tone: "text-accent bg-accent/10", label: "Interview" },
  agent_run_finished: { icon: Bot, tone: "text-primary bg-primary/10", label: "Agent" },
  agent_run_failed: { icon: AlertTriangle, tone: "text-error bg-error/10", label: "Agent" },
  agent_needs_approval: { icon: PauseCircle, tone: "text-warning bg-warning/10", label: "Approval" },
  sales_reply: { icon: MessagesSquare, tone: "text-info bg-info/10", label: "Reply" },
  meeting_booked: { icon: CalendarCheck, tone: "text-success bg-success/10", label: "Meeting" },
};
const FALLBACK_META = { icon: Bell, tone: "text-base-content bg-base-200", label: "Update" };
export const metaFor = (type) => TYPE_META[type] || FALLBACK_META;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "3m ago", "5h ago", "2d ago", then a date. Rounds down, so "3h ago" never means 3h 59m.
 * A time more than a couple of minutes in the future means a bad clock somewhere, so show the
 * date instead of claiming it just happened.
 */
export function timeAgo(date, now = Date.now()) {
  const at = new Date(date).getTime();
  if (Number.isNaN(at)) return "";
  const elapsed = now - at;
  if (elapsed < -2 * MINUTE) return new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d ago`;
  return new Date(at).toLocaleDateString([], { dateStyle: "medium" });
}

/** The current time as state, refreshed every `ms`, so "3m ago" keeps moving on a page that stays open. */
export function useNow(ms = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/**
 * The latest notifications and the unread count: { notifications, unread }. The bell and the Home
 * activity feed both use this, so they share one request and one cache entry.
 */
export function useNotificationFeed() {
  return useQuery({
    queryKey: notificationKeys.bell,
    queryFn: async () => {
      const res = await fetch("/api/notifications?limit=20");
      if (!res.ok) throw new Error("Failed to load notifications");
      return res.json();
    },
    refetchInterval: 30 * 1000,
    refetchOnWindowFocus: true,
  });
}

/** Mark the given notification ids as read, or every unread one when `ids` is omitted. */
export async function markNotificationsRead(ids) {
  const res = await fetch("/api/notifications", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ids ? { ids } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Failed to update notifications");
  return data;
}
