"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "framer-motion";
import { CellRow } from "@/components/ui/CellRow";

import { duration, useHydratedReducedMotion } from "@/lib/motion";
const stats = [
  [15, "/day", "Safe invite cap per account"],
  [4, "\u20135", "Recent posts analysed per lead"],
  [4, "h", "Connection acceptance sync"],
  [2, "-in-1", "Outreach and hiring, one dashboard"],
] as const;

function CountUp({ value, suffix }: { value: number; suffix: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reducedMotion = useHydratedReducedMotion();
  const [count, setCount] = useState(reducedMotion ? value : 0);

  useEffect(() => {
    if (!inView || reducedMotion) {
      if (inView) setCount(value);
      return;
    }
    let frame = 0;
    const started = performance.now();
    const countDuration = duration.reveal * 2 * 1000;
    const update = (now: number) => {
      const progress = Math.min((now - started) / countDuration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(value * eased));
      if (progress < 1) frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [inView, reducedMotion, value]);

  return <span ref={ref}>{count}{suffix}</span>;
}

export function Stats() {
  return (
    <div className="mx-auto w-[min(100%-32px,1200px)]">
      <CellRow cellClassName="px-3 py-7 sm:px-6 sm:py-7">
        {stats.map(([value, suffix, label]) => (
          <div data-testid="stat-cell" key={label}>
            <strong className="block text-[clamp(1.7rem,5vw,2.5rem)] font-medium leading-none tracking-[-0.03em] text-ink"><CountUp suffix={suffix} value={value} /></strong>
            <span className="mt-2 block text-[13px] leading-[1.5] text-muted">{label}</span>
          </div>
        ))}
      </CellRow>
    </div>
  );
}
