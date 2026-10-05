"use client";

import { useQuery } from "@tanstack/react-query";

export const SYSTEM_KEY = "system-status";

/** One reading of the system. { forbidden: true } for people who are not in hiring. */
export async function fetchSystem({ guidance = false, fresh = false } = {}) {
  const params = new URLSearchParams();
  if (guidance) params.set("guidance", "1");
  if (fresh) params.set("fresh", "1");
  const res = await fetch(`/api/system/status${params.size ? `?${params}` : ""}`, { cache: "no-store" });
  if (res.status === 403) return { forbidden: true };
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not check the system");
  return data;
}

/**
 * Live status of the hiring programs. Polls while the tab is visible.
 * data = { status, guidance? } (status.services, status.infra, status.config, status.overall, status.summary).
 */
export function useSystemStatus({ guidance = false, interval = 15000, enabled = true } = {}) {
  return useQuery({
    queryKey: [SYSTEM_KEY, guidance],
    queryFn: () => fetchSystem({ guidance }),
    refetchInterval: interval,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true, // coming back to the tab shows the current state at once, not the one from before
    staleTime: 2000,
    enabled,
    retry: false,
  });
}

/**
 * Read the system again right now (not the shared 2 second reading) and put it where every screen shows it.
 * Call after starting or stopping a program so the card changes at once.
 */
export async function refreshSystem(queryClient) {
  const data = await fetchSystem({ guidance: true, fresh: true });
  if (data.forbidden) return;
  queryClient.setQueryData([SYSTEM_KEY, true], data);
  queryClient.setQueryData([SYSTEM_KEY, false], { success: true, status: data.status });
}

/** Start, stop or restart one program. Throws an Error with a sentence a person can act on. */
export async function controlService(id, action) {
  const res = await fetch(`/api/system/services/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not do that");
  return data.result;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until the programs answer. Returns the last status (some may still not be running after the time is up). */
export async function waitUntilRunning(ids, { timeoutMs = 100000, intervalMs = 1500 } = {}) {
  const until = Date.now() + timeoutMs;
  let status = null;
  while (Date.now() < until) {
    await sleep(intervalMs);
    const data = await fetchSystem({ fresh: true });
    status = data.status;
    const states = ids.map((id) => status.services.find((s) => s.id === id)?.state);
    // A program that crashed while starting will not recover by waiting
    if (states.every((s) => s === "running") || states.some((s) => s === "crashed")) break;
  }
  return status;
}
