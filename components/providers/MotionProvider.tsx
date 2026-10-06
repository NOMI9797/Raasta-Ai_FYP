"use client";

import { LazyMotion, MotionConfig, domAnimation } from "framer-motion";
import { useEffect, type ReactNode } from "react";
import { useHydratedReducedMotion } from "@/lib/motion";

export function MotionProvider({ children }: { children: ReactNode }) {
  const reducedMotion = useHydratedReducedMotion();

  useEffect(() => {
    const update = () => document.documentElement.toggleAttribute("data-page-hidden", document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    if (!finePointer.matches) return;

    let frame = 0;
    let pending: PointerEvent | null = null;

    const updatePointer = () => {
      frame = 0;
      const event = pending;
      if (!event) return;
      const target = (event.target as Element | null)?.closest<HTMLElement>("[data-spotlight], [data-tilt], [data-magnetic]");
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (target.hasAttribute("data-spotlight")) {
        target.style.setProperty("--mx", x + "px");
        target.style.setProperty("--my", y + "px");
      }
      if (target.hasAttribute("data-tilt")) {
        const rotateY = ((x / rect.width) - 0.5) * 8;
        const rotateX = ((y / rect.height) - 0.5) * -8;
        target.style.transform = "perspective(800px) rotateX(" + rotateX + "deg) rotateY(" + rotateY + "deg) translateY(-4px)";
      }
      if (target.hasAttribute("data-magnetic")) {
        const moveX = Math.max(-6, Math.min(6, (x - rect.width / 2) * 0.12));
        const moveY = Math.max(-6, Math.min(6, (y - rect.height / 2) * 0.12));
        target.style.transform = "translate3d(" + moveX + "px," + moveY + "px,0)";
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      pending = event;
      if (!frame) frame = requestAnimationFrame(updatePointer);
    };
    const onPointerLeave = (event: PointerEvent) => {
      const target = (event.target as Element | null)?.closest<HTMLElement>("[data-tilt], [data-magnetic]");
      if (!target) return;
      target.style.transition = "transform 500ms cubic-bezier(.2,.9,.2,1.35)";
      target.style.transform = "";
      window.setTimeout(() => { target.style.removeProperty("transition"); }, 520);
    };
    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerout", onPointerLeave, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerout", onPointerLeave);
    };
  }, [reducedMotion]);

  return <LazyMotion features={domAnimation}><MotionConfig reducedMotion="user">{children}</MotionConfig></LazyMotion>;
}

