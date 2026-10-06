"use client";

import { Button } from "@/components/ui/Button";
import { DitherField } from "@/components/ui/DitherField";
import { Reveal } from "@/components/ui/Reveal";

export function FinalCta() {
  return (
    <section className="relative overflow-hidden pb-52 pt-16 md:pt-24" data-testid="section-final-cta">
      <DitherField className="absolute inset-0" variant="cta" />
      <Reveal className="relative z-10 mx-auto w-[min(100%-32px,1200px)] text-center">
        <h2 className="mx-auto max-w-[760px] text-[clamp(2.5rem,6vw,2.75rem)] font-medium leading-[1.1] tracking-[-0.03em] text-ink">Stop managing your pipeline. Start automating it.</h2>
        <div className="mt-12 flex flex-wrap justify-center gap-3">
          <Button data-testid="final-get-started" onClick={() => { window.location.href = "/signup"; }} variant="dark">Get Started Free</Button>
          <Button variant="light">Book a Demo</Button>
        </div>
        <p className="mt-5 text-[13px] leading-[1.5] text-muted">No credit card required</p>
      </Reveal>
    </section>
  );
}

