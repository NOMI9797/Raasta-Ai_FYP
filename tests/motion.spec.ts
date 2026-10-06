"use strict";

import { expect, test } from "@playwright/test";

test.use({ reducedMotion: "no-preference" });

test("landing motion stays stable during a full-page scroll", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__motionMetrics = { cls: 0 };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as any) {
        if (!entry.hadRecentInput) (window as any).__motionMetrics.cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);

  const frameMetrics = await page.evaluate(async () => {
    const samples: number[] = [];
    const scrollRange = document.documentElement.scrollHeight - innerHeight;
    const started = performance.now();
    let previous = started;
    const runFor = 4200;

    await new Promise<void>((resolve) => {
      const frame = (now: number) => {
        samples.push(now - previous);
        previous = now;
        const progress = Math.min((now - started) / runFor, 1);
        window.scrollTo(0, scrollRange * progress);
        if (progress < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });

    return {
      cls: (window as any).__motionMetrics.cls as number,
      droppedFrames: samples.filter((gap) => gap > 34).length,
      severeFrames: samples.filter((gap) => gap > 50).length,
      maxFrameGap: Math.max(...samples),
      sampleCount: samples.length,
    };
  });

  console.log("motion-metrics", JSON.stringify(frameMetrics));
  expect(frameMetrics.cls).toBeLessThan(0.05);
});
