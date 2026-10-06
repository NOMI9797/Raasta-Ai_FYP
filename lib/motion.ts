"use client";

import { useEffect, useMemo, useState } from "react";
import { useReducedMotion as useFramerReducedMotion, type Transition, type Variants } from "framer-motion";

export const easing = { smooth: [0.22, 1, 0.36, 1], snappy: [0.32, 0.72, 0, 1] } as const;
export const duration = { micro: 0.15, ui: 0.25, reveal: 0.6, ambientMin: 3, ambientMax: 6 } as const;
export const motionStagger = 0.08;
export const maxStaggerItems = 6;
export const smoothTransition: Transition = { duration: duration.ui, ease: easing.smooth };
export const snappyTransition: Transition = { duration: duration.ui, ease: easing.snappy };

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24, filter: "blur(6px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: duration.reveal, ease: easing.smooth },
  },
};

export const stagger = (delay = motionStagger): Variants => ({
  hidden: {},
  visible: { transition: { staggerChildren: delay } },
});

export function staggerDelay(index: number, delay = motionStagger) {
  return Math.min(index, maxStaggerItems - 1) * delay;
}

export function instantIfReduced(reduced: boolean, transition: Transition = smoothTransition): Transition {
  return reduced ? { duration: 0 } : transition;
}

const staticVariants: Variants = {
  hidden: { opacity: 1, y: 0, filter: "blur(0px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0 } },
};

export function useHydratedReducedMotion() {
  const preference = useFramerReducedMotion();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated ? Boolean(preference) : false;
}

export function useReducedMotionVariants(variants: Variants = fadeUp): Variants {
  const shouldReduceMotion = useHydratedReducedMotion();
  return useMemo(() => (shouldReduceMotion ? staticVariants : variants), [shouldReduceMotion, variants]);
}