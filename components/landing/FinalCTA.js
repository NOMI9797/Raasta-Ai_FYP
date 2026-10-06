import { Mail } from "lucide-react";
import config from "@/config";
import Container from "./ui/Container";
import Button from "./ui/Button";
import Footer from "./Footer";

// Flat navy close that runs straight into the navy footer.
const FinalCTA = () => (
  <>
    <section aria-labelledby="final-cta-title" data-nav-theme="dark" className="bg-raasta-navyDeep">
      <Container className="flex flex-col items-center py-20 text-center md:py-28">
        <h2
          id="final-cta-title"
          className="max-w-[720px] text-balance font-display text-[34px] font-medium leading-[1.08] tracking-[-0.03em] text-raasta-white md:text-[52px]"
        >
          Try it on your next campaign or job post
        </h2>
        <p className="mt-5 max-w-[520px] text-[17px] leading-[1.6] text-raasta-white/80">
          Raasta-AI is in early access. Create an account and set up your first campaign or job post today.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Button href="/signup" className="focus-visible:ring-offset-raasta-navyDeep">
            Create your account
          </Button>
          <Button
            href={`mailto:${config.contactEmail}?subject=Raasta-AI%20demo`}
            variant="outlineLight"
            className="focus-visible:ring-raasta-cobaltSoft focus-visible:ring-offset-raasta-navyDeep"
          >
            <Mail className="h-4 w-4" aria-hidden="true" />
            Book a demo
          </Button>
        </div>
      </Container>
    </section>
    <Footer />
  </>
);

export default FinalCTA;
