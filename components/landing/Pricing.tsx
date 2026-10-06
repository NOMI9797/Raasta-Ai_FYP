"use client";

import { Check, Zap } from "lucide-react";
import { Reveal } from "@/components/ui/Reveal";

const plans = [
  { name: "Starter", popular: false, price: "$49", oldPrice: "$70", features: ["1 LinkedIn account", "up to 3 active campaigns", "AI message generation", "automated invite and follow-up", "basic analytics"] },
  { name: "Pro", price: "$99", oldPrice: "$149", popular: true, features: ["up to 5 LinkedIn accounts", "unlimited campaigns", "recruiter pipeline and CV parsing", "advanced analytics and reporting", "priority support", "Agentic mode"] },
] as const;

export function Pricing() {
  return (
    <section className="scroll-mt-16 py-16 md:py-24" data-testid="section-pricing" id="pricing">
      <Reveal className="mx-auto w-[min(100%-32px,1000px)]">
        <h2 className="mx-auto max-w-[680px] text-center text-[clamp(2.25rem,5vw,3rem)] font-medium leading-[1.1] tracking-[-0.03em] text-ink">Simple pricing for outreach and hiring.</h2>
        <div className="mt-12 grid items-stretch gap-4 md:grid-cols-2">
          {plans.map((plan) => (
            <article data-spotlight data-tilt className={"pricing-card relative flex h-full flex-col rounded-lg border bg-surface p-6 transition-[transform,box-shadow,border-color] duration-150 ease-out hover:-translate-y-1 motion-reduce:transform-none " + (plan.popular ? "pricing-card-popular border-primary" : "border-border")} data-testid="pricing-card" key={plan.name}>
              {plan.popular ? <span className="absolute left-1/2 top-[-12px] -translate-x-1/2 rounded-[999px] bg-primary px-[10px] py-[3px] text-[13px] font-semibold leading-none text-white">POPULAR</span> : null}
              <h3 className="text-xl font-semibold text-ink">{plan.name}</h3>
              <div className="mt-8 flex items-end gap-3">
                <span className="pb-1 text-lg text-muted line-through">{plan.oldPrice}</span>
                <span className="text-5xl font-semibold tracking-[-0.04em] text-ink">{plan.price}</span>
                <span className="pb-2 text-[13px] font-semibold text-muted">USD</span>
              </div>
              <ul className="mt-8 flex-1 space-y-4">
                {plan.features.map((feature) => (
                  <li className="flex items-center gap-3 text-sm text-ink" key={feature}><Check className="size-4 shrink-0 text-primary" strokeWidth={2} /><span>{feature}</span>{feature === "Agentic mode" ? <span className="ml-auto rounded-full bg-primary-soft px-2 py-1 text-[13px] font-medium text-primary">Coming soon</span> : null}</li>
                ))}
              </ul>
              <button className="mt-9 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-on-primary transition-transform duration-150 hover:-translate-y-px motion-reduce:transform-none" data-testid="pricing-get-started" onClick={() => { window.location.href = "/signup"; }} type="button"><Zap className="size-4" fill="currentColor" />Get Raasta-AI</button>
              <p className="mt-3 text-center text-[13px] leading-[1.5] text-muted">Billed monthly {"\u00B7"} Cancel anytime</p>
            </article>
          ))}
        </div>
      </Reveal>
    </section>
  );
}


