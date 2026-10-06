"use client";

import { Dithering } from "@paper-design/shaders-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type DitherVariant = "hero" | "card" | "cta";

export interface DitherFieldProps {
  className?: string;
  variant?: DitherVariant;
}

const presets: Record<DitherVariant, { pxSize: number; scale: number; speed: number }> = {
  hero: { pxSize: 3, scale: 0.55, speed: 0.25 },
  card: { pxSize: 2, scale: 0.9, speed: 0.15 },
  cta: { pxSize: 3, scale: 0.5, speed: 0.2 },
};

let liveShaders = 0;
const slotWaiters = new Set<() => void>();

function notifyNextWaiter() {
  slotWaiters.values().next().value?.();
}

function useLiveShaderSlot(wanted: boolean) {
  const [hasSlot, setHasSlot] = useState(false);
  const claimed = useRef(false);

  useEffect(() => {
    const release = () => {
      if (!claimed.current) return;
      claimed.current = false;
      liveShaders = Math.max(0, liveShaders - 1);
      setHasSlot(false);
      notifyNextWaiter();
    };

    if (!wanted) {
      release();
      return;
    }

    const tryClaim = () => {
      if (claimed.current || liveShaders >= 2) return;
      slotWaiters.delete(tryClaim);
      claimed.current = true;
      liveShaders += 1;
      setHasSlot(true);
    };

    tryClaim();
    if (!claimed.current) slotWaiters.add(tryClaim);

    return () => {
      slotWaiters.delete(tryClaim);
      release();
    };
  }, [wanted]);

  return hasSlot;
}

function toRgb(color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return "rgb(255, 255, 255)";
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = color.trim();
  context.fillRect(0, 0, 1, 1);
  const pixel = context.getImageData(0, 0, 1, 1).data;
  return `rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`;
}

function readThemeColors() {
  const styles = getComputedStyle(document.documentElement);
  return {
    bg: toRgb(styles.getPropertyValue("--bg")),
    primary: toRgb(styles.getPropertyValue("--primary")),
  };
}

export function DitherField({ className, variant = "card" }: DitherFieldProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [canAnimate, setCanAnimate] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [colors, setColors] = useState({ bg: "rgb(255, 255, 255)", primary: "rgb(70, 91, 222)" });
  const [maxPixelCount, setMaxPixelCount] = useState(1_500_000);
  const hasSlot = useLiveShaderSlot(inView && canAnimate && pageVisible);
  const preset = presets[variant];

  useEffect(() => {
    const update = () => setPageVisible(!document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.01 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const narrowScreen = window.matchMedia("(max-width: 767px)");
    const update = () => setCanAnimate(!reducedMotion.matches && !narrowScreen.matches);
    update();
    reducedMotion.addEventListener("change", update);
    narrowScreen.addEventListener("change", update);
    return () => {
      reducedMotion.removeEventListener("change", update);
      narrowScreen.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    const update = () => setColors(readThemeColors());
    update();
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    const themeObserver = new MutationObserver(update);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    scheme.addEventListener("change", update);
    return () => {
      themeObserver.disconnect();
      scheme.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setMaxPixelCount(Math.max(1, Math.ceil(width * height * 1.5 * 1.5)));
    });
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, []);

  return (
    <div ref={rootRef} className={cn("dither-field size-full overflow-hidden", className)} data-variant={variant}>
      {hasSlot ? (
        <Dithering
          className="size-full"
          colorBack={colors.bg}
          colorFront={colors.primary}
          shape="simplex"
          type="8x8"
          pxSize={preset.pxSize}
          scale={preset.scale}
          speed={preset.speed}
          minPixelRatio={1}
          maxPixelCount={maxPixelCount}
        />
      ) : (
        <div aria-label="Static dithered cloud field" className="dither-static size-full" />
      )}
      <div aria-hidden="true" className="dither-edge-softener" />
      {variant === "cta" ? <div aria-hidden="true" className="dither-cta-mask" /> : null}
    </div>
  );
}
