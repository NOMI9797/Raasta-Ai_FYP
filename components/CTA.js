import Link from "next/link";

const CTA = () => {
  return (
    <section className="bg-neutral text-neutral-content">
      <div className="max-w-4xl mx-auto px-8 py-24 md:py-32 text-center flex flex-col items-center gap-8">
        <h2 className="font-bold text-3xl md:text-5xl tracking-tight">
          Ready to put your LinkedIn outreach on autopilot?
        </h2>
        <p className="text-lg opacity-80 max-w-xl leading-relaxed">
          Join hundreds of sales reps and recruiters who use Reachly to fill
          their pipelines without the manual grind.
        </p>

        <div className="flex flex-col sm:flex-row gap-4">
          <Link href="/signup" className="btn btn-primary btn-wide">
            Get started for free
          </Link>
          <Link href="/#pricing" className="btn btn-outline btn-wide border-neutral-content/30 hover:bg-neutral-content/10">
            View pricing
          </Link>
        </div>

        <p className="text-sm opacity-50">No credit card required · Cancel anytime</p>
      </div>
    </section>
  );
};

export default CTA;
