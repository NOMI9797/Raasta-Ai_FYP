"use client";

import { m } from "framer-motion";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { duration, easing, fadeUp, motionStagger, stagger, useHydratedReducedMotion, useReducedMotionVariants } from "@/lib/motion";
import { useLenis } from "@/components/providers/LenisProvider";

const headline = [
  ["One", false], ["platform", false], ["for", false], ["LinkedIn", false],
  ["outreach", true], ["and", false], ["hiring.", true],
] as const;

export function Hero() {
  const reducedMotion = useHydratedReducedMotion();
  const lenis = useLenis();
  const wordVariants = useReducedMotionVariants({
    hidden: { y: "110%", opacity: 0 },
    visible: { y: "0%", opacity: 1, transition: { duration: duration.reveal, ease: easing.smooth } },
  });
  const contentVariants = useReducedMotionVariants(stagger(motionStagger));
  const itemVariants = useReducedMotionVariants(fadeUp);

  const scrollToWorkflow = () => {
    if (lenis) lenis.scrollTo("#workflow", { offset: -64 });
    else document.getElementById("workflow")?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" });
  };

  return (
    <section className="scroll-mt-16 pb-16 pt-[72px]" id="top">
      <div className="mx-auto grid w-[min(100%-32px,1200px)] grid-cols-1 gap-10 md:grid-cols-12 md:gap-x-8">
        <div className="md:col-span-7">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1.5 text-[13px] leading-[1.5] font-medium text-primary">
            <Sparkles aria-hidden="true" size={14} />
            <span>AI-Powered Outreach &amp; Hiring</span>
          </div>
          <m.h1
            animate="visible"
            className="flex max-w-[760px] flex-wrap gap-x-[0.24em] text-[clamp(2.75rem,7vw,3.75rem)] font-medium leading-[1.05] tracking-[-0.03em] text-ink"
            data-testid="hero-heading"
            initial="hidden"
            variants={reducedMotion ? undefined : { visible: { transition: { staggerChildren: motionStagger } } }}
          >
            {headline.map(([word, accent]) => (
              <span className="overflow-hidden pb-[0.08em]" key={word}>
                <m.span className={`inline-block ${accent ? "text-primary" : ""}`} variants={wordVariants}>{word}</m.span>
              </span>
            ))}
          </m.h1>
        </div>
        <m.div animate="visible" className="flex flex-col justify-end md:col-span-5" initial="hidden" variants={contentVariants}>
          <m.p className="max-w-[500px] text-base leading-[1.6] text-muted" variants={itemVariants}>
            Raasta-AI finds leads, writes personalized messages from their recent posts, sends invites safely, and runs your recruitment pipeline from job post to parsed resume.
          </m.p>
          <m.div className="mt-7 flex flex-wrap gap-3" variants={itemVariants}>
            <Button data-testid="hero-primary-cta" onClick={() => { window.location.href = "/signup"; }} variant="dark">Start for Free</Button>
            <Button data-testid="hero-secondary-cta" onClick={scrollToWorkflow} variant="light">See How It Works</Button>
          </m.div>
        </m.div>
      </div>
    </section>
  );
}