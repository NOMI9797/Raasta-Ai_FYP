"use client";

import { m, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import { BarChart3, BriefcaseBusiness, Check, LayoutDashboard, Mail, Megaphone, Users } from "lucide-react";
import { DitherField } from "@/components/ui/DitherField";

import { duration, easing, useHydratedReducedMotion } from "@/lib/motion";
const navItems = [
  [LayoutDashboard, "Overview"], [Megaphone, "Campaigns"], [Users, "Leads"], [Mail, "Messages"], [BriefcaseBusiness, "Recruiting"],
] as const;
const timeline = ["Posts analyzed", "Message generated", "Invite sent"];
const leads = [
  ["Prospect A", "Founder", "Scraped"],
  ["Prospect B", "Revenue Lead", "Sent"],
  ["Prospect C", "Co-founder", "Accepted"],
  ["Prospect D", "Growth Lead", "Replied"],
];

export function HeroVisual() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useHydratedReducedMotion();
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ["start end", "end start"] });
  const parallax = useTransform(scrollYProgress, [0, 1], reducedMotion ? [0, 0] : [0, 48]);

  return (
    <div className="mx-auto mt-10 w-[min(100%-32px,1200px)]" ref={sectionRef}>
      <div className="relative aspect-[16/8.5] min-h-[520px] overflow-hidden rounded-[4px] bg-primary sm:min-h-0">
        <DitherField variant="hero" />
        <m.div className="absolute inset-x-[4%] top-[8%] sm:inset-x-[13%] sm:top-[12%]" style={{ y: parallax }}>
          <m.div
            animate={{ opacity: 1, scale: 1 }}
            className="overflow-hidden rounded-[10px] border border-border bg-surface text-ink"
            initial={reducedMotion ? false : { opacity: 0, scale: 0.96 }}
            transition={{ duration: reducedMotion ? 0 : duration.reveal, ease: easing.smooth }}
            style={{ boxShadow: "0 24px 60px -20px color-mix(in oklch, var(--primary) 35%, transparent)" }}
          >
            <div className="flex h-9 items-center gap-1.5 border-b border-border bg-bg px-3">
              <span className="size-2 rounded-full bg-muted/40" /><span className="size-2 rounded-full bg-muted/40" /><span className="size-2 rounded-full bg-muted/40" />
            </div>
            <div className="grid grid-cols-[64px_1fr] sm:grid-cols-[18%_1fr]">
              <aside className="border-r border-border bg-bg px-2 py-3 sm:p-4">
                <div className="mb-5 grid size-7 place-items-center rounded-md bg-primary text-on-primary"><BarChart3 size={14} /></div>
                <div className="grid gap-1.5">
                  {navItems.map(([Icon, label], index) => (
                    <div className={`flex items-center gap-2 rounded-md px-2 py-2 text-[13px] leading-[1.5] font-medium ${index === 1 ? "bg-primary-soft text-primary" : "text-muted"}`} key={label}>
                      <Icon className="size-3.5 shrink-0" /><span className="hidden truncate sm:block">{label}</span>
                    </div>
                  ))}
                </div>
              </aside>
              <div className="min-w-0 p-3 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold sm:text-lg">Campaign: Q4 SaaS Founders</h3><span className="rounded-full bg-primary-soft px-2 py-1 text-[13px] leading-[1.5] font-medium text-primary">14/15</span></div>
                <div className="mt-4 grid grid-cols-3 border-y border-border">
                  {[["Audience","SaaS founders"],["Channel","LinkedIn"],["Status","Active"]].map(([label,value], index) => <div className={`${index ? "border-l" : ""} border-border px-2 py-2.5 sm:px-3`} key={label}><span className="block text-[13px] leading-[1.5] text-muted sm:text-[13px] leading-[1.5]">{label}</span><strong className="block truncate text-[13px] leading-[1.5] font-medium sm:text-[13px] leading-[1.5]">{value}</strong></div>)}
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
                  <div><h4 className="mb-2 text-[13px] leading-[1.5] font-semibold sm:text-[13px] leading-[1.5]">AI Activity Timeline</h4><div className="grid gap-1.5">{timeline.map((item) => <div className="flex items-center gap-2 rounded-md border border-border px-2 py-2 text-[13px] leading-[1.5] text-muted sm:text-[13px] leading-[1.5]" key={item}><span className="grid size-4 place-items-center rounded-full bg-primary-soft text-primary"><Check size={9}/></span>{item}</div>)}</div></div>
                  <div className="min-w-0 overflow-hidden rounded-md border border-border"><div className="grid grid-cols-[1.2fr_1fr_.8fr] bg-bg px-2 py-2 text-[13px] leading-[1.5] font-medium text-muted sm:text-[13px] leading-[1.5]"><span>Name</span><span>Role</span><span>Status</span></div>{leads.map(([name,role,status]) => <div className="grid grid-cols-[1.2fr_1fr_.8fr] items-center border-t border-border px-2 py-2 text-[13px] leading-[1.5]" key={name}><span className="font-medium">{name}</span><span className="truncate text-muted">{role}</span><span className="w-fit rounded-full bg-primary-soft px-1.5 py-0.5 text-primary">{status}</span></div>)}</div>
                </div>
                <div className="mt-3 flex items-center gap-3"><span className="text-[13px] leading-[1.5] text-muted sm:text-[13px] leading-[1.5]">Invites 14/15</span><div className="h-1 flex-1 overflow-hidden rounded-full bg-primary-soft"><div className="h-full w-[93%] rounded-full bg-primary" /></div></div>
              </div>
            </div>
          </m.div>
        </m.div>
      </div>
    </div>
  );
}