"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useDialog } from "@/components/ui/DialogProvider";
import { FEATURE_NEEDS, FEATURE_WHY, START_ORDER, sentenceName } from "@/libs/system/features";
import { controlService, fetchSystem, refreshSystem, waitUntilRunning } from "./useSystem";

/**
 * Before something that quietly waits when a program is off, check the programs and offer to start them.
 *
 *   const { ensure, startPrograms } = useServiceGuard();
 *   if (!(await ensure("agent"))) return;                       // needed: stops here when declined
 *   if (!(await ensure("invites", { required: false }))) return; // advice: "Continue anyway" carries on
 *
 * Never blocks on its own failure: if the status cannot be read it lets the action through.
 */
export function useServiceGuard() {
  const { confirm, alert } = useDialog();
  const queryClient = useQueryClient();

  // Start these programs and wait for them. Returns the ids that are still not running.
  const startPrograms = useCallback(async (ids) => {
    const ordered = START_ORDER.filter((id) => ids.includes(id));
    const toastId = toast.loading("Starting. The first start can take up to a minute...");
    try {
      for (const id of ordered) await controlService(id, "start");
      const status = await waitUntilRunning(ordered);
      refreshSystem(queryClient).catch(() => {});
      const still = ordered.filter((id) => status?.services.find((s) => s.id === id)?.state !== "running");
      if (still.length === 0) {
        toast.success("Running", { id: toastId });
        return [];
      }
      toast.dismiss(toastId);
      await alert({
        title: "Not ready yet",
        message: "These did not come up. The Setup guide shows what each one printed.",
        items: still.map((id) => {
          const s = status.services.find((x) => x.id === id);
          return `${s?.label || id}: ${s?.logTail?.slice(-1)[0] || s?.detail || "no answer"}`;
        }),
        tone: "warning",
      });
      return still;
    } catch (error) {
      toast.dismiss(toastId);
      await alert({ title: "Could not start", message: error.message, tone: "error" });
      return ordered;
    }
  }, [alert, queryClient]);

  const ensure = useCallback(async (feature, { required = true } = {}) => {
    let status;
    try {
      const data = await fetchSystem();
      if (data.forbidden) return true;
      status = data.status;
    } catch {
      return true;
    }
    const missing = (FEATURE_NEEDS[feature] || []).map((id) => status.services.find((s) => s.id === id)).filter((s) => s && s.state !== "running");
    if (missing.length === 0) return true;

    const startable = status.controlEnabled && missing.every((s) => s.canStart || s.state === "starting");
    const list = missing.map((s) => `${s.label}: ${s.role}`);
    if (startable) {
      const ok = await confirm({
        title: missing.length === 1 ? `Start the ${sentenceName(missing[0].label)}?` : "Start the programs this needs?",
        message: FEATURE_WHY[feature],
        items: list,
        confirmText: "Start now",
        cancelText: required ? "Cancel" : "Continue anyway",
        tone: "info",
      });
      if (!ok) return !required;
      const still = await startPrograms(missing.map((s) => s.id));
      return still.length === 0 ? true : !required;
    }

    await alert({
      title: "Some programs are not running",
      message: `${FEATURE_WHY[feature]} Start them from a terminal, or open the Setup guide.`,
      items: missing.map((s) => `${s.label}: ${s.manual}`),
      tone: "warning",
    });
    return !required;
  }, [alert, confirm, startPrograms]);

  return { ensure, startPrograms };
}
