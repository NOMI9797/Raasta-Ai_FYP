"use client";

import type { ComponentProps, ReactNode } from "react";
import { m } from "framer-motion";
import { fadeUp, useReducedMotionVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface RevealProps extends Omit<ComponentProps<typeof m.div>, "children"> {
  children: ReactNode;
}

export function Reveal({ children, className, ...props }: RevealProps) {
  const variants = useReducedMotionVariants(fadeUp);

  return (
    <m.div
      className={cn(className)}
      variants={variants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.2 }}
      {...props}
    >
      {children}
    </m.div>
  );
}