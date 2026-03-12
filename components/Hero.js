import ButtonSignin from "./ButtonSignin";

const Hero = () => {
  return (
    <section className="max-w-7xl mx-auto bg-base-100 flex flex-col lg:flex-row items-center justify-center gap-16 lg:gap-20 px-8 py-16 lg:py-28">
      {/* Left — copy */}
      <div className="flex flex-col gap-8 lg:gap-10 items-center justify-center text-center lg:text-left lg:items-start max-w-xl">
        {/* Badge */}
        <span className="inline-flex items-center gap-2 bg-primary/10 text-primary text-sm font-semibold px-4 py-1.5 rounded-full border border-primary/20">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          AI-Powered LinkedIn Automation
        </span>

        <h1 className="font-extrabold text-4xl lg:text-6xl tracking-tight leading-tight">
          Automate your LinkedIn{" "}
          <span className="text-primary">outreach & hiring</span> at scale
        </h1>

        <p className="text-lg text-base-content/70 leading-relaxed">
          Raasta-AI runs your entire B2B sales and recruitment pipeline — from
          lead discovery to signed deals and hired talent — completely on
          autopilot.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
          <ButtonSignin text="Start for free" extraStyle="btn-primary btn-wide" />
          <a href="#features" className="btn btn-outline btn-wide">
            See how it works
          </a>
        </div>

        {/* Social proof */}
        <div className="flex items-center gap-3 text-sm text-base-content/60">
          <div className="flex -space-x-2">
            {["🧑‍💼", "👩‍💻", "🧑‍🔬", "👨‍💼"].map((emoji, i) => (
              <div
                key={i}
                className="w-8 h-8 rounded-full bg-base-200 border-2 border-base-100 flex items-center justify-center text-base"
              >
                {emoji}
              </div>
            ))}
          </div>
          <span>
            Trusted by <strong className="text-base-content">200+</strong> sales reps &amp; recruiters
          </span>
        </div>
      </div>

      {/* Right — visual demo card */}
      <div className="lg:w-full flex justify-center">
        <div className="w-full max-w-md bg-base-200 rounded-2xl p-6 shadow-xl border border-base-300 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-base-content/60 uppercase tracking-widest">
              Live Campaign
            </span>
            <span className="badge badge-success badge-sm gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-success-content animate-ping" />
              Running
            </span>
          </div>

          {/* Metric row */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Invites sent", value: "142" },
              { label: "Accepted", value: "38" },
              { label: "Replies", value: "21" },
            ].map(({ label, value }) => (
              <div key={label} className="bg-base-100 rounded-xl p-3 text-center">
                <p className="text-2xl font-extrabold text-primary">{value}</p>
                <p className="text-xs text-base-content/50 mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {/* Message preview */}
          <div className="bg-base-100 rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-sm">🤖</div>
              <div>
                <p className="text-xs font-semibold text-base-content">AI Agent</p>
                <p className="text-xs text-base-content/40">just now</p>
              </div>
            </div>
            <p className="text-sm text-base-content/80 leading-relaxed">
              &ldquo;Hi Sarah, I noticed your team at{" "}
              <span className="text-primary font-medium">Acme Corp</span> recently
              expanded into EMEA — congrats! I&apos;d love to show you how Raasta-AI
              can help your SDRs...&rdquo;
            </p>
          </div>

          {/* Progress bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-base-content/50">
              <span>Daily invite limit</span>
              <span>14 / 20</span>
            </div>
            <div className="w-full bg-base-300 rounded-full h-2">
              <div className="bg-primary h-2 rounded-full" style={{ width: "70%" }} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Hero;
