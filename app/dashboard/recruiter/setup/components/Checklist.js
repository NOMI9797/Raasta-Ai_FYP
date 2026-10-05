"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle } from "lucide-react";

/**
 * "Where you are": the hiring flow as a short checklist. The first step that is not done is highlighted
 * and has the button; optional steps say so and never hold anything up.
 */
export default function Checklist({ guidance, onSetupPage = false }) {
  if (!guidance) return null;
  const { steps, next, attention } = guidance;
  return (
    <section aria-label="What to do next" className="space-y-3">
      {attention.map((item) => (
        <div key={item.id} role="status" className="alert alert-info text-sm">
          <div className="flex-1">
            <p className="font-semibold">{item.title}</p>
            <p className="text-xs opacity-80">{item.detail}</p>
          </div>
          <Link href={item.href} className="btn btn-sm !normal-case">{item.cta}</Link>
        </div>
      ))}
      <ol className="rounded-xl border border-base-300 bg-base-100 divide-y divide-base-300">
        {steps.map((step, index) => {
          const isNext = next?.id === step.id;
          // On the setup page itself the first step points at the programs below instead of at this page
          const here = onSetupPage && step.id === "programs";
          return (
            <li key={step.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${isNext ? "bg-primary/5" : ""}`} aria-current={isNext ? "step" : undefined}>
              {step.done ? <CheckCircle2 className="h-5 w-5 text-success shrink-0" aria-label="Done" /> : <Circle className={`h-5 w-5 shrink-0 ${isNext ? "text-primary" : "text-base-content/30"}`} aria-label="Not done" />}
              <div className="flex-1 min-w-[12rem]">
                <p className={`text-sm ${step.done ? "text-base-content/60" : "font-semibold"}`}>
                  {index + 1}. {step.title}
                  {step.optional && <span className="badge badge-ghost badge-xs ml-2 align-middle">optional</span>}
                </p>
                <p className="text-xs text-base-content/60">{step.detail}</p>
              </div>
              {!step.done && (
                <Link href={here ? "#programs-heading" : step.href} className={`btn btn-sm !normal-case gap-1 ${isNext ? "btn-primary" : "btn-ghost"}`}>
                  {here ? "Start them below" : step.cta} {isNext && <ArrowRight className="h-3.5 w-3.5" />}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
