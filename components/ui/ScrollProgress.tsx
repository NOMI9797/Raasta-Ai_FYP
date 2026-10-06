"use client";

import { useEffect, useRef } from "react";
import { useHydratedReducedMotion } from "@/lib/motion";

export function ScrollProgress() {
  const barRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useHydratedReducedMotion();

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const progress = max > 0 ? Math.min(1, window.scrollY / max) : 0;
      barRef.current?.style.setProperty("--scroll-progress", String(progress));
      document.querySelector("[data-navbar]")?.toggleAttribute("data-scrolled", window.scrollY > 8);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { if (frame) cancelAnimationFrame(frame); window.removeEventListener("scroll", onScroll); };
  }, []);

  return <div aria-hidden="true" className="pointer-events-none sticky top-0 z-[70] h-0"><div className="scroll-progress h-0.5 origin-left bg-primary" ref={barRef} style={reducedMotion ? undefined : { transition: "transform 80ms linear" }} /></div>;
}

