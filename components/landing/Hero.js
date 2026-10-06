import config from "@/config";
import Container from "./ui/Container";
import Button from "./ui/Button";
import MockDashboard from "./MockDashboard";
import StatsStrip from "./StatsStrip";

// Light hero: headline and CTAs, then the product itself on a pale blue stage.
// The text fades in once on load (CSS only); nothing else moves.

const t = (ms) => ({ animationDelay: `${ms}ms` });

const Hero = () => (
  <section aria-labelledby="hero-title" className="relative bg-raasta-white">
    <Container className="grid gap-8 pb-16 pt-[140px] md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] md:items-end md:gap-12 md:pb-20 md:pt-[184px]">
      <h1
        id="hero-title"
        className="raasta-in font-display text-[42px] font-medium leading-[1.04] tracking-[-0.03em] text-raasta-navy sm:text-[54px] md:text-[64px]"
      >
        A Faster Raasta to Every Client and Every Hire
      </h1>

      <div className="raasta-in flex flex-col gap-6 md:pb-2" style={t(120)}>
        <p className="max-w-[420px] text-[17px] leading-[1.6] text-raasta-slate">
          Find prospects and candidates on LinkedIn, Rozee.pk and Indeed. Raasta-AI drafts the outreach, parses the
          CVs and tracks who accepts.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button href="/signup">Start a campaign</Button>
          <Button href={`mailto:${config.contactEmail}?subject=Raasta-AI%20demo`} variant="secondary">
            Book a demo
          </Button>
        </div>
        <p className="text-[14px] text-raasta-slate">In early access. Monthly plans, cancel any time.</p>
      </div>
    </Container>

    {/* the product as a floating window on a pale-blue stage, cropped by the stage's bottom edge */}
    <Container>
      <div className="raasta-stage overflow-hidden rounded-t-[24px] px-4 pt-10 sm:px-10 sm:pt-14 md:px-16 md:pt-20">
        <div className="mx-auto max-h-[380px] max-w-[1000px] overflow-hidden rounded-t-[16px] shadow-e4 sm:max-h-[460px] md:max-h-[500px]">
          <MockDashboard />
        </div>
      </div>
    </Container>

    <StatsStrip />
  </section>
);

export default Hero;
