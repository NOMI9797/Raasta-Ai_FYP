"use client";

import { useRef, useState } from "react";
import { Check } from "lucide-react";
import config from "@/config";
import Container from "./ui/Container";
import SectionHeading from "./ui/SectionHeading";
import Button from "./ui/Button";

// Plans come from config.js unchanged (copy, features, prices).
// The two cards are a radio group: click a card (or use the arrow keys) to select it.
// The selected card gets the cobalt border, a filled radio dot and the solid button.
// Pro starts selected. "Choose" buttons go to sign-up with the plan in the URL.
//
// TODO(yearly): no Monthly/Yearly toggle on purpose. Plans are monthly via Stripe and
// yearly prices aren't defined yet. When they are, add a `billing` state here, render a
// segmented toggle above the cards, and read the price from plan.yearlyPrice.

const PlanCard = ({ plan, selected, onSelect, cardRef }) => {
  const slug = plan.name.toLowerCase();

  return (
    <div
      ref={cardRef}
      role="radio"
      aria-checked={selected}
      aria-label={`${plan.name}, $${plan.price} per month`}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          if (e.target !== e.currentTarget) return; // let the inner button work
          e.preventDefault();
          onSelect();
        }
      }}
      className={`relative flex h-full cursor-pointer flex-col rounded-card border-2 bg-raasta-white p-7 text-raasta-navy transition-[border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-raasta-cobalt focus-visible:ring-offset-4 focus-visible:ring-offset-raasta-mist sm:p-8 ${
        selected ? "border-raasta-cobalt shadow-e2" : "border-raasta-line hover:border-raasta-slate/40"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* visible radio, so the card reads as a choice */}
          <span
            aria-hidden="true"
            className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors duration-200 ${
              selected ? "border-raasta-cobalt" : "border-raasta-line"
            }`}
          >
            {selected && <span className="h-2.5 w-2.5 rounded-full bg-raasta-cobalt" />}
          </span>
          <h3 className="font-display text-[24px] font-medium tracking-[-0.015em]">{plan.name}</h3>
        </div>
        {plan.isFeatured && (
          <span className="rounded-chip bg-raasta-wash px-2 py-1 text-[14px] font-medium text-raasta-cobaltDeep">For teams</span>
        )}
      </div>
      <p className="mt-2 text-[16px] text-raasta-slate">{plan.description}</p>

      <p className="mt-6 flex items-end gap-1.5">
        <span className="font-display text-[48px] font-medium leading-none tracking-[-0.03em] tabular-nums">${plan.price}</span>
        <span className="mb-1 text-[16px] text-raasta-slate">per month</span>
      </p>

      <ul className="mt-7 flex-1 space-y-3 border-t border-raasta-line pt-6">
        {plan.features.map((f) => (
          <li key={f.name} className="flex items-start gap-2.5 text-[16px] leading-snug">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-raasta-cobalt" strokeWidth={2.5} aria-hidden="true" />
            {f.name}
          </li>
        ))}
      </ul>

      <Button href={`/signup?plan=${slug}`} variant={selected ? "primary" : "secondary"} className="mt-8 w-full">
        Choose {plan.name}
      </Button>
    </div>
  );
};

// TODO(proof): replace with a real customer quote or pilot result once someone agrees to
// be quoted. Shown only when NEXT_PUBLIC_SHOW_DEV_TODOS=true, never by default.
const ProofSlot = () =>
  process.env.NEXT_PUBLIC_SHOW_DEV_TODOS === "true" ? (
    <div className="mx-auto mt-12 max-w-[880px] rounded-card border-2 border-dashed border-raasta-danger/50 p-5 text-[15px] text-raasta-danger">
      TODO (dev flag on): customer quote or pilot result goes here. Do not ship invented proof.
    </div>
  ) : null;

const Pricing = () => {
  const plans = config.stripe.plans;
  const [selected, setSelected] = useState(() => Math.max(0, plans.findIndex((p) => p.isFeatured)));
  const refs = useRef([]);

  const onKeyDown = (e) => {
    const next = e.key === "ArrowRight" || e.key === "ArrowDown";
    const prev = e.key === "ArrowLeft" || e.key === "ArrowUp";
    if (!next && !prev) return;
    e.preventDefault();
    const i = (selected + (next ? 1 : -1) + plans.length) % plans.length;
    setSelected(i);
    refs.current[i]?.focus();
  };

  return (
    <section id="pricing" aria-labelledby="pricing-title" className="border-t border-raasta-line bg-raasta-mist py-20 md:py-32">
      <Container>
        <SectionHeading
          id="pricing-title"
          className="mx-auto items-center text-center"
          title="Two plans: start small, move to Pro when your team grows"
          sub="Early-access pricing, billed monthly through Stripe. Cancel any time."
        />

        <div
          role="radiogroup"
          aria-labelledby="pricing-title"
          onKeyDown={onKeyDown}
          className="mx-auto mt-14 grid max-w-[880px] items-stretch gap-8 md:grid-cols-2 md:gap-6"
        >
          {plans.map((plan, i) => (
            <PlanCard
              key={plan.priceId}
              plan={plan}
              selected={selected === i}
              onSelect={() => setSelected(i)}
              cardRef={(el) => (refs.current[i] = el)}
            />
          ))}
        </div>

        <p className="mt-10 text-center text-[16px] text-raasta-slate">
          Need more seats or LinkedIn accounts?{" "}
          <Button href={`mailto:${config.contactEmail}?subject=Raasta-AI%20team%20plan`} variant="tertiary">
            Email us
          </Button>
        </p>

        <ProofSlot />
      </Container>
    </section>
  );
};

export default Pricing;
