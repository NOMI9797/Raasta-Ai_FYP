"use client";

import { useState } from "react";
import { m } from "framer-motion";
import { GitFork, Timer, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DitherField } from "@/components/ui/DitherField";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { fadeUp, stagger, useReducedMotionVariants } from "@/lib/motion";
import { Reveal } from "@/components/ui/Reveal";

const problems = [
  {
    icon: Timer,
    title: "Hours lost on manual DMs",
    description: "Copying profiles, writing messages, and tracking replies by hand eats your day.",
  },
  {
    icon: TriangleAlert,
    title: "Generic messages get ignored",
    description: "Template outreach ignores what your leads actually post and care about.",
  },
  {
    icon: GitFork,
    title: "Candidates scattered everywhere",
    description: "Resumes arrive from different places with no single pipeline to review.",
  },
];

export function Problem() {
  const [hovered, setHovered] = useState<number | null>(null);
  const containerVariants = useReducedMotionVariants(stagger(0.08));
  const cardVariants = useReducedMotionVariants(fadeUp);

  return (
    <section className="py-16 md:py-24" data-testid="section-problem">
      <Reveal className="mx-auto w-[min(100%-32px,1200px)]">
        <div className="grid gap-5 md:grid-cols-12 md:gap-x-8">
          <div className="md:col-span-3"><Eyebrow>The Problem</Eyebrow></div>
          <div className="flex max-w-[800px] flex-col items-start gap-6 md:col-span-9 sm:flex-row sm:items-end sm:justify-between">
            <h2 className="max-w-[640px]">Manual outreach and screening is draining your pipeline.</h2>
            <Button className="shrink-0" variant="dark">View Details</Button>
          </div>
        </div>

        <m.div
          className="mt-12 grid gap-4 md:grid-cols-3"
          initial="hidden"
          variants={containerVariants}
          viewport={{ once: true, amount: 0.18 }}
          whileInView="visible"
        >
          {problems.map(({ icon: Icon, title, description }, index) => (
            <m.article data-spotlight data-tilt
              className="problem-card rounded-lg border border-border bg-surface p-6 transition-[transform,box-shadow] duration-150 ease-out hover:-translate-y-1 motion-reduce:transform-none motion-reduce:transition-none"
              key={title}
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered(null)}
              variants={cardVariants}
            >
              <div className="relative aspect-video overflow-hidden rounded-[4px] bg-primary">
                <DitherField variant="card" />
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  <Icon aria-hidden="true" className="size-10 text-on-primary" strokeWidth={1.45} />
                </div>
              </div>
              <div className="mt-6">
                <h3 className="text-[15px] font-semibold leading-snug text-ink">{title}</h3>
                <p className="mt-2 text-[13px] leading-[1.6] text-muted">{description}</p>
              </div>
            </m.article>
          ))}
        </m.div>
      </Reveal>
    </section>
  );
}