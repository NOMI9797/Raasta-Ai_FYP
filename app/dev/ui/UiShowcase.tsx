"use client";

import { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CellRow } from "@/components/ui/CellRow";
import { DitherField } from "@/components/ui/DitherField";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Reveal } from "@/components/ui/Reveal";
import { SectionHeading } from "@/components/ui/SectionHeading";

export function UiShowcase() {
  const [hue, setHue] = useState(255);

  useEffect(() => {
    document.documentElement.style.setProperty("--hue", String(hue));
    return () => { document.documentElement.style.removeProperty("--hue"); };
  }, [hue]);

  return (
    <main className="min-h-screen bg-bg px-6 py-16 text-ink">
      <div className="mx-auto max-w-[1200px] space-y-16">
        <header className="flex flex-col gap-6 border-b border-border pb-10 md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <Eyebrow>Foundation preview</Eyebrow>
            <h1 className="max-w-3xl text-[clamp(2.5rem,7vw,5rem)] font-medium leading-[1.05] tracking-[-0.03em]">
              Raasta-AI UI primitives
            </h1>
          </div>
          <label className="grid gap-2 text-xs font-medium text-muted">
            Theme hue: {hue}
            <input
              aria-label="Theme hue"
              className="accent-primary"
              max="360"
              min="0"
              onChange={(event) => setHue(Number(event.target.value))}
              type="range"
              value={hue}
            />
          </label>
        </header>

        <Reveal className="space-y-6">
          <SectionHeading eyebrow="Buttons">Action variants</SectionHeading>
          <div className="flex flex-wrap gap-3">
            <Button variant="dark">Get 14 Days Demo</Button>
            <Button variant="light">View Details</Button>
            <Button variant="primary">Get Started</Button>
          </div>
        </Reveal>

        <Reveal className="space-y-6">
          <SectionHeading eyebrow="Typography">Section heading primitive</SectionHeading>
          <Eyebrow icon={Clock3}>The Problem</Eyebrow>
        </Reveal>

        <Reveal className="space-y-6">
          <SectionHeading eyebrow="Cell row">Equal-width bordered cells</SectionHeading>
          <CellRow>
            <div><strong className="block text-2xl font-medium">15/day</strong><span className="text-xs text-muted">Safe invite cap</span></div>
            <div><strong className="block text-2xl font-medium">4–5</strong><span className="text-xs text-muted">Posts analysed</span></div>
            <div><strong className="block text-2xl font-medium">4h</strong><span className="text-xs text-muted">Acceptance sync</span></div>
            <div><strong className="block text-2xl font-medium">2-in-1</strong><span className="text-xs text-muted">One dashboard</span></div>
          </CellRow>
        </Reveal>

        <Reveal className="space-y-6">
          <SectionHeading eyebrow="WebGL">Dither field</SectionHeading>
          <div className="h-[500px] w-full max-w-[1200px] overflow-hidden rounded-[4px] border border-border bg-primary">
            <DitherField variant="hero" />
          </div>
        </Reveal>

        <Reveal className="space-y-6">
          <SectionHeading eyebrow="CTA mask">Radial white center</SectionHeading>
          <div className="h-72 overflow-hidden rounded-[4px] border border-border bg-primary">
            <DitherField variant="cta" />
          </div>
        </Reveal>
      </div>
    </main>
  );
}