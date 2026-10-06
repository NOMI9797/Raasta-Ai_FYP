"use client";

import Link from "next/link";
import { m } from "framer-motion";
import { Check, Lock, MessageSquareText, UserRoundCheck, Zap } from "lucide-react";
import { DitherField } from "@/components/ui/DitherField";
import { duration, useHydratedReducedMotion } from "@/lib/motion";

const benefits = ["Personalized outreach at scale", "Safe daily automation limits", "One pipeline for leads and candidates"];

export function AuthShell({ children }) {
  const reduced = useHydratedReducedMotion();
  return (
    <main className="min-h-screen bg-bg text-ink lg:grid lg:grid-cols-[45%_55%]">
      <div className="relative h-24 overflow-hidden lg:hidden"><DitherField variant="hero" /></div>
      <section className="relative flex min-h-[calc(100vh-96px)] items-center justify-center px-6 py-16 lg:min-h-screen lg:px-10 lg:py-12">
        <Link aria-label="Raasta-AI home" className="absolute left-6 top-6 flex items-center gap-2 text-base font-semibold text-ink lg:left-10 lg:top-8" href="/">
          <span className="grid size-8 place-items-center rounded-full bg-primary text-on-primary"><Zap size={16} fill="currentColor" /></span>
          Raasta-AI
        </Link>
        <div className="w-full max-w-[400px]">{children}</div>
      </section>
      <aside className="relative m-4 ml-0 hidden min-h-[calc(100vh-32px)] overflow-hidden rounded-2xl lg:block">
        <DitherField variant="hero" />
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-10">
          <m.div animate={reduced ? { opacity: 1 } : { y: [0, -8, 0] }} className="w-full max-w-[470px] rounded-xl border border-border bg-surface p-6 shadow-[0_30px_70px_-30px_color-mix(in_oklch,var(--primary)_55%,transparent)]" transition={{ duration: duration.ambientMax, ease: "easeInOut", repeat: reduced ? 0 : Infinity }}>
            <div className="flex items-center justify-between"><div><p className="text-[13px] leading-[1.5] text-muted">Campaign overview</p><strong className="mt-1 block text-lg font-semibold">Product leaders outreach</strong></div><span className="rounded-full bg-primary-soft px-3 py-1 text-[13px] font-medium text-primary">Active</span></div>
            <div className="mt-6 grid grid-cols-3 gap-4">{[["14","Invites sent"],["8","Accepted"],["5","Replies"]].map(([value,label]) => <div className="rounded-lg border border-border bg-bg p-4" key={label}><strong className="block text-3xl font-medium tracking-[-0.03em]">{value}</strong><span className="mt-1 block text-[13px] leading-[1.5] text-muted">{label}</span></div>)}</div>
            <div className="mt-6 space-y-3">
              <div className="flex items-center gap-3 rounded-lg border border-border p-3"><span className="grid size-8 place-items-center rounded-full bg-primary-soft text-primary"><UserRoundCheck size={16}/></span><div><strong className="block text-sm">New acceptance</strong><span className="text-[13px] text-muted">Follow-up ready to review</span></div></div>
              <div className="flex items-center gap-3 rounded-lg border border-border p-3"><span className="grid size-8 place-items-center rounded-full bg-primary-soft text-primary"><MessageSquareText size={16}/></span><div><strong className="block text-sm">AI message generated</strong><span className="text-[13px] text-muted">Personalized from recent activity</span></div></div>
            </div>
          </m.div>
          <div className="mt-6 grid w-full max-w-[470px] gap-3">{benefits.map((benefit) => <div className="flex h-11 items-center gap-3 rounded-full bg-white px-[18px] text-sm font-medium text-ink shadow-sm" key={benefit}><Check className="size-4 text-primary" />{benefit}</div>)}</div>
        </div>
      </aside>
    </main>
  );
}

export function SecureNote() {
  return <p className="mt-6 flex items-center justify-center gap-2 text-[13px] leading-[1.5] text-muted"><Lock className="size-4 text-primary" />Your data is secure and encrypted</p>;
}

export function GoogleIcon() {
  return <svg aria-hidden="true" className="size-5" viewBox="0 0 24 24"><path fill="currentColor" d="M21.35 12.18c0-.64-.06-1.25-.17-1.84H12v3.48h5.25a4.49 4.49 0 0 1-1.95 2.95v2.26h3.16c1.85-1.7 2.89-4.21 2.89-6.85Z"/><path fill="currentColor" d="M12 21.7c2.64 0 4.86-.88 6.48-2.38l-3.16-2.46c-.88.59-2 .94-3.32.94a5.86 5.86 0 0 1-5.5-4.05H3.24v2.53A9.79 9.79 0 0 0 12 21.7Z"/><path fill="currentColor" d="M6.5 13.75A5.9 5.9 0 0 1 6.2 12c0-.61.1-1.2.3-1.75V7.72H3.24A9.8 9.8 0 0 0 2.2 12c0 1.55.37 3.02 1.04 4.28l3.26-2.53Z"/><path fill="currentColor" d="M12 6.2c1.44 0 2.72.5 3.74 1.46l2.81-2.8A9.43 9.43 0 0 0 12 2.3a9.79 9.79 0 0 0-8.76 5.42l3.26 2.53A5.86 5.86 0 0 1 12 6.2Z"/></svg>;
}
