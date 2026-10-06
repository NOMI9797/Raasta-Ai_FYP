import { Suspense } from "react";
import Header from "@/components/landing/Header";
import Hero from "@/components/landing/Hero";
import PlatformStrip from "@/components/landing/PlatformStrip";
import Problem from "@/components/landing/Problem";
import Solution from "@/components/landing/Solution";
import Workflow from "@/components/landing/Workflow";
import UseCases from "@/components/landing/UseCases";
import Pricing from "@/components/landing/Pricing";
import FAQ from "@/components/landing/FAQ";
import FinalCTA from "@/components/landing/FinalCTA";

export default function Home() {
  return (
    // data-theme pins the landing to the light theme so DaisyUI dark mode can't leak in.
    <div data-theme="reachly" className="landing min-h-screen bg-raasta-mist text-raasta-navy antialiased">
      <Suspense>
        <Header />
      </Suspense>
      <main>
        <Hero />
        <PlatformStrip />
        <Problem />
        <Solution />
        <Workflow />
        <UseCases />
        <Pricing />
        <FAQ />
      </main>
      <FinalCTA />
    </div>
  );
}
