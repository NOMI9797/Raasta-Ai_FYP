"use client";

import { AnimatePresence, m } from "framer-motion";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { easing, useHydratedReducedMotion } from "@/lib/motion";

const motionRoutes = new Set(["/", "/signup", "/login", "/signin"]);

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const reduced = useHydratedReducedMotion();
  const routeKey = motionRoutes.has(pathname) ? pathname : "application";
  return (
    <AnimatePresence initial={false} mode="wait">
      <m.div animate={{ opacity: 1 }} exit={{ opacity: 0 }} initial={{ opacity: reduced ? 1 : 0 }} key={routeKey} transition={{ duration: reduced ? 0 : 0.2, ease: easing.smooth }}>
        {children}
      </m.div>
    </AnimatePresence>
  );
}
