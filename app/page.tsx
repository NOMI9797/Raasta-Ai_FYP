import { AnnouncementBar } from "@/components/landing/AnnouncementBar";
import { Hero } from "@/components/landing/Hero";
import { HeroVisual } from "@/components/landing/HeroVisual";
import { LogoStrip } from "@/components/landing/LogoStrip";
import { Navbar } from "@/components/landing/Navbar";
import { Problem } from "@/components/landing/Problem";
import { Solution } from "@/components/landing/Solution";
import { Stats } from "@/components/landing/Stats";
import { Workflow } from "@/components/landing/Workflow";
import { BuiltFor } from "@/components/landing/BuiltFor";
import { Resources } from "@/components/landing/Resources";
import { Pricing } from "@/components/landing/Pricing";
import { Faq } from "@/components/landing/Faq";
import { FinalCta } from "@/components/landing/FinalCta";
import { Footer } from "@/components/landing/Footer";
import { ScrollProgress } from "@/components/ui/ScrollProgress";

export default function Home() {
  return (
    <div className="min-h-screen overflow-x-clip bg-bg text-ink">
      <AnnouncementBar />
      <ScrollProgress />
      <Navbar />
      <main data-testid="section-hero">
        <Hero />
        <LogoStrip />
        <HeroVisual />
        <Stats />
      </main>
      <Problem />
      <Solution />
      <Workflow />
      <BuiltFor />
      <Resources />
      <Pricing />
      <Faq />
      <FinalCta />
      <Footer />
    </div>
  );
}


