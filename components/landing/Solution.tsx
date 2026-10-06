"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, m } from "framer-motion";
import { Lock, Pause, Play, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DitherField } from "@/components/ui/DitherField";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Reveal } from "@/components/ui/Reveal";
import { useHydratedReducedMotion } from "@/lib/motion";

const features = [
  { title: "Campaign Management", description: "Build campaigns, upload leads by CSV or pasted LinkedIn URLs, and track every lead's status in one place.", testId: "campaign-management" },
  { title: "AI Message Generation", description: "Personalized messages written from each lead's role and 4-5 recent posts, streamed live and editable before sending.", testId: "ai-message-generation" },
  { title: "Automated Invites & Follow-ups", description: "Invites send in the background with a safe 15/day cap, pause/resume/cancel controls, and acceptance tracking every 4 hours.", testId: "automated-invites" },
  { title: "Recruiter Pipeline", description: "Generate a job post, publish it to LinkedIn, collect applications through a public form, and review parsed resumes.", testId: "recruiter-pipeline" },
  { title: "Agentic Mode", description: "Full autopilot from discovery to follow-up is on the roadmap.", testId: "agentic-mode", comingSoon: true },
] as const;

const chipMotion = {
  initial: { opacity: 0, scale: 0.82 },
  animate: { opacity: 1, scale: 1 },
};

function StatusChip({ children, tone = "primary", delay = 0, reducedMotion = false }: { children: ReactNode; tone?: "primary" | "success" | "muted" | "warning"; delay?: number; reducedMotion?: boolean }) {
  const tones = { primary: "bg-primary-soft text-primary", success: "bg-emerald-50 text-emerald-700", muted: "bg-bg text-muted", warning: "bg-amber-50 text-amber-700" };
  return <m.span {...chipMotion} className={`inline-flex w-fit rounded-full px-2.5 py-1 text-[13px] font-medium ${tones[tone]}`} transition={{ duration: reducedMotion ? 0 : 0.18, delay }}>{children}</m.span>;
}

const campaignLeads = [
  ["Lead 01", "Operations Director", "Connected", "12 min ago", "success"],
  ["Lead 02", "Revenue Manager", "Invite sent", "38 min ago", "primary"],
  ["Lead 03", "Talent Partner", "Message ready", "1h ago", "warning"],
  ["Lead 04", "Growth Director", "Profile viewed", "2h ago", "muted"],
  ["Lead 05", "Product Lead", "Replied", "3h ago", "success"],
  ["Lead 06", "Sales Manager", "Queued", "Today", "muted"],
] as const;

function CampaignPanel({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <div className="solution-mock-panel overflow-auto p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-[13px] text-muted">Campaign</p><strong className="mt-0.5 block text-[16px] font-semibold">Q4 Product Outreach</strong></div>
        <StatusChip reducedMotion={reducedMotion} tone="success">Active</StatusChip>
      </div>
      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        <table className="w-full min-w-[620px] border-collapse text-left text-[13px]">
          <thead className="bg-bg text-muted"><tr><th className="px-3 py-2.5 font-medium">Lead</th><th className="px-3 py-2.5 font-medium">Role</th><th className="px-3 py-2.5 font-medium">Status</th><th className="px-3 py-2.5 font-medium">Last activity</th></tr></thead>
          <tbody>{campaignLeads.map(([name, role, status, activity, tone], index) => <m.tr animate={{ opacity: 1, y: 0 }} className="border-t border-border" initial={reducedMotion ? false : { opacity: 0, y: 7 }} key={name} transition={{ duration: reducedMotion ? 0 : 0.22, delay: index * 0.05 }}><td className="px-3 py-2.5 font-medium">{name}</td><td className="px-3 py-2.5 text-muted">{role}</td><td className="px-3 py-2"><StatusChip delay={index * 0.05 + 0.08} reducedMotion={reducedMotion} tone={tone}>{status}</StatusChip></td><td className="px-3 py-2.5 text-muted">{activity}</td></m.tr>)}</tbody>
        </table>
      </div>
      <div className="mt-4 flex items-center justify-between text-[13px]"><span className="font-medium">Daily invites</span><span className="text-muted">14/15</span></div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-primary-soft"><m.div animate={{ width: "93.333%" }} className="h-full rounded-full bg-primary" initial={reducedMotion ? false : { width: 0 }} transition={{ duration: reducedMotion ? 0 : 0.65, ease: "easeOut" }} /></div>
    </div>
  );
}

const generatedMessage = "Hi there ? I enjoyed your recent thoughts on simplifying team handoffs. We help growing teams keep outreach personal while automating repetitive follow-ups. Would you be open to comparing notes for 15 minutes next week?";

function MessagePanel({ reducedMotion }: { reducedMotion: boolean }) {
  const [text, setText] = useState(reducedMotion ? generatedMessage : "");
  const [edited, setEdited] = useState(false);
  useEffect(() => {
    if (reducedMotion) { setText(generatedMessage); return; }
    setText("");
    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setText(generatedMessage.slice(0, index));
      if (index >= generatedMessage.length) window.clearInterval(timer);
    }, 30);
    return () => window.clearInterval(timer);
  }, [reducedMotion]);
  return (
    <div className="solution-mock-panel grid overflow-auto p-6 md:grid-cols-[.82fr_1.18fr] md:gap-5">
      <div className="rounded-lg border border-border bg-bg p-4">
        <p className="text-[13px] text-muted">Lead context</p><strong className="mt-1 block text-[16px]">Product Lead</strong><p className="mt-1 text-[13px] text-muted">Cloud software company</p>
        <p className="mt-5 text-[13px] font-semibold">Recent posts</p>
        <div className="mt-2 space-y-2">{["Reducing friction between product and sales teams.", "Why simple onboarding beats feature-heavy demos.", "A practical framework for customer feedback."].map((post, index) => <m.div animate={{ opacity: 1, y: 0 }} className="rounded-md border border-border bg-surface p-2.5 text-[13px] leading-5 text-muted" initial={reducedMotion ? false : { opacity: 0, y: 6 }} key={post} transition={{ delay: index * 0.05 }}>{post}</m.div>)}</div>
      </div>
      <div className="mt-4 flex min-h-[280px] flex-col rounded-lg border border-border p-4 md:mt-0">
        <div className="flex items-center justify-between gap-3"><strong className="text-[15px]">Generated message</strong><button aria-pressed={edited} className={`rounded-full px-3 py-1.5 text-[13px] font-medium ${edited ? "bg-primary text-white" : "bg-bg text-muted"}`} onClick={() => setEdited((value) => !value)} type="button">Edited {edited ? "On" : "Off"}</button></div>
        <div className="mt-3 flex-1 rounded-md bg-bg p-3 text-[13px] leading-6 text-ink">{text}<span className="ml-0.5 inline-block h-4 w-px animate-pulse bg-primary align-middle" /></div>
        <button className="mt-3 inline-flex w-fit items-center gap-2 rounded-full border border-border px-4 py-2 text-[13px] font-medium" onClick={() => setText(generatedMessage)} type="button"><RefreshCw size={15}/>Regenerate</button>
      </div>
    </div>
  );
}

const queue = [["Invite Lead 07", "Sending", "primary"], ["Follow up Lead 08", "Ready", "success"], ["Check Lead 09", "Waiting", "warning"], ["Invite Lead 10", "Queued", "muted"], ["Follow up Lead 11", "Queued", "muted"]] as const;

function InvitesPanel({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <div className="solution-mock-panel grid overflow-auto p-6 md:grid-cols-[1.2fr_.8fr] md:gap-6">
      <div><div className="flex items-center justify-between"><strong className="text-[16px]">Automation queue</strong><StatusChip reducedMotion={reducedMotion} tone="success">Running</StatusChip></div><div className="mt-4 space-y-2">{queue.map(([job,status,tone], index) => <m.div animate={{ opacity: 1, x: 0 }} className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5" initial={reducedMotion ? false : { opacity: 0, x: -8 }} key={job} transition={{ delay: index * 0.05 }}><span className="text-[13px] font-medium">{job}</span><StatusChip delay={index * 0.05} reducedMotion={reducedMotion} tone={tone}>{status}</StatusChip></m.div>)}</div></div>
      <div className="mt-5 flex flex-col items-center justify-center rounded-lg bg-bg p-4 md:mt-0">
        <div className="relative size-36"><svg className="size-full -rotate-90" viewBox="0 0 120 120"><circle cx="60" cy="60" fill="none" r="50" stroke="var(--primary-soft)" strokeWidth="10"/><m.circle animate={{ pathLength: 0.74 }} cx="60" cy="60" fill="none" initial={reducedMotion ? false : { pathLength: 0 }} pathLength={1} r="50" stroke="var(--primary)" strokeLinecap="round" strokeWidth="10" transition={{ duration: reducedMotion ? 0 : 0.8 }}/></svg><div className="absolute inset-0 grid place-items-center text-center"><span><strong className="block text-[24px]">74%</strong><span className="text-[13px] text-muted">complete</span></span></div></div>
        <p className="mt-3 text-center text-[13px] text-muted">Next acceptance check in <strong className="text-ink">3h 12m</strong></p>
        <div className="mt-4 flex gap-2">{[[Pause,"Pause"],[Play,"Resume"],[X,"Cancel"]].map(([Icon,label]) => <button className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-[13px] font-medium" key={label as string} type="button"><Icon size={14}/>{label as string}</button>)}</div>
      </div>
    </div>
  );
}

const candidateColumns = [
  { title: "Received", cards: [["Candidate A1", "3 years", ["React", "SQL"]], ["Candidate A2", "5 years", ["Python", "APIs"]]] },
  { title: "Under Review", cards: [["Candidate B1", "4 years", ["Node.js", "Cloud"]], ["Candidate B2", "6 years", ["Product", "Data"]]] },
  { title: "Shortlisted", cards: [["Candidate C1", "5 years", ["React", "UX"]], ["Candidate C2", "7 years", ["Systems", "SQL"]]] },
] as const;

function RecruiterPanel({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <div className="solution-mock-panel overflow-auto p-6">
      <div className="flex items-center justify-between"><div><p className="text-[13px] text-muted">Open role</p><strong className="text-[16px]">Senior Product Engineer</strong></div><StatusChip reducedMotion={reducedMotion} tone="primary">6 candidates</StatusChip></div>
      <div className="mt-4 grid min-w-[660px] grid-cols-3 gap-3">{candidateColumns.map((column, columnIndex) => <div className="rounded-lg bg-bg p-3" key={column.title}><div className="flex items-center justify-between text-[13px] font-semibold"><span>{column.title}</span><span className="text-muted">2</span></div><div className="mt-3 space-y-2">{column.cards.map(([name, experience, skills], cardIndex) => <m.article animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-border bg-surface p-3" initial={reducedMotion ? false : { opacity: 0, y: 8 }} key={name} transition={{ delay: (columnIndex * 2 + cardIndex) * 0.05 }}><strong className="text-[13px]">{name}</strong><p className="mt-1 text-[13px] text-muted">{experience} experience</p><div className="mt-2 flex flex-wrap gap-1">{skills.map((skill, index) => <StatusChip delay={index * 0.04} reducedMotion={reducedMotion} tone="primary" key={skill}>{skill}</StatusChip>)}</div><div className="mt-3 flex gap-2"><button className="rounded-full bg-dark px-3 py-1.5 text-[13px] font-medium text-white" type="button">Shortlist</button><button className="rounded-full border border-border px-3 py-1.5 text-[13px] font-medium" type="button">Reject</button></div></m.article>)}</div></div>)}</div>
    </div>
  );
}

function AgenticPanel() {
  return (
    <div className="solution-mock-panel relative overflow-hidden p-6">
      <div className="select-none space-y-4 blur-[6px]"><div className="flex justify-between"><div className="h-9 w-48 rounded bg-primary-soft"/><div className="h-9 w-24 rounded-full bg-primary-soft"/></div><div className="grid grid-cols-3 gap-3"><div className="h-44 rounded-lg border border-border"/><div className="h-44 rounded-lg border border-border"/><div className="h-44 rounded-lg border border-border"/></div><div className="h-14 rounded-lg border border-border"/></div>
      <div className="absolute inset-0 grid place-items-center bg-surface/65"><div className="text-center"><span className="mx-auto grid size-12 place-items-center rounded-full bg-primary text-white shadow-lg"><Lock size={20}/></span><strong className="mt-3 block text-[17px]">Agentic Mode</strong><span className="mt-2 inline-flex rounded-full bg-primary-soft px-3 py-1.5 text-[13px] font-semibold text-primary">Coming soon</span></div></div>
    </div>
  );
}

export function Solution() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const reducedMotion = useHydratedReducedMotion();
  useEffect(() => { if (paused || reducedMotion) return; const timer = window.setTimeout(() => setActive((value) => (value + 1) % features.length), 6000); return () => window.clearTimeout(timer); }, [active, paused, reducedMotion]);
  const handleKeys = (event: KeyboardEvent<HTMLButtonElement>, index: number) => { if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return; event.preventDefault(); let next = index; if (event.key === "ArrowDown") next = (index + 1) % features.length; if (event.key === "ArrowUp") next = (index - 1 + features.length) % features.length; if (event.key === "Home") next = 0; if (event.key === "End") next = features.length - 1; setActive(next); tabRefs.current[next]?.focus(); };
  const panels = [<CampaignPanel key="campaign" reducedMotion={reducedMotion}/>, <MessagePanel key="message" reducedMotion={reducedMotion}/>, <InvitesPanel key="invites" reducedMotion={reducedMotion}/>, <RecruiterPanel key="recruiter" reducedMotion={reducedMotion}/>, <AgenticPanel key="agentic"/>];
  const feature = features[active];
  return (
    <section className="scroll-mt-16 py-16 md:py-24" data-testid="section-features" id="features">
      <Reveal className="mx-auto w-[min(100%-32px,1200px)]">
        <div className="grid gap-5 md:grid-cols-12 md:gap-x-8"><div className="md:col-span-3"><Eyebrow>Our Solution</Eyebrow></div><h2 className="max-w-[760px] text-[clamp(2rem,5vw,2.5rem)] font-medium leading-[1.12] tracking-[-0.03em] text-ink md:col-span-9">One dashboard. Every lead and candidate, automated.</h2></div>
        <div className="mt-12 grid gap-8 md:grid-cols-12 md:gap-x-8" data-testid="section-solution" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }} onFocus={() => setPaused(true)} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
          <div aria-label="Solution features" className="grid content-start md:col-span-3" role="tablist">{features.map((item, index) => <button aria-controls="solution-panel" aria-selected={active === index} className={`relative min-h-14 border-l border-border py-2 pl-5 text-left text-[15px] ${active === index ? "font-semibold text-ink" : "font-normal text-muted"}`} data-testid={`solution-tab-${item.testId}`} id={`solution-tab-${index}`} key={item.title} onClick={() => setActive(index)} onKeyDown={(event) => handleKeys(event, index)} ref={(node) => { tabRefs.current[index] = node; }} role="tab" tabIndex={active === index ? 0 : -1} type="button">{active === index ? <span className="solution-progress absolute -left-px top-0 h-full w-0.5 bg-primary" data-paused={paused} key={active}/> : null}<span>{item.title}</span>{"comingSoon" in item && item.comingSoon ? <span className="ml-2 rounded-full bg-primary-soft px-2 py-1 text-[13px] font-medium text-primary">Coming soon</span> : null}</button>)}</div>
          <div className="md:col-span-9">
            <div className="relative aspect-[16/10] min-h-[520px] overflow-hidden rounded-[4px] bg-primary sm:min-h-0" data-testid="solution-panel" id="solution-panel" role="tabpanel">
              <DitherField variant="card" />
              <div className="absolute inset-0 grid place-items-center"><AnimatePresence initial={false} mode="wait"><m.div animate={{ opacity: 1, y: 0 }} className="flex max-h-[86%] w-[84%] justify-center" exit={{ opacity: 0, y: -8, transition: { duration: reducedMotion ? 0 : 0.15 } }} initial={reducedMotion ? false : { opacity: 0, y: 12 }} key={active} transition={{ duration: reducedMotion ? 0 : 0.25, ease: "easeOut" }}>{panels[active]}</m.div></AnimatePresence></div>
            </div>
            <div className="mt-5 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center"><div className="max-w-[680px]"><h3 className="text-base font-semibold text-ink">{feature.title}</h3><p className="mt-1.5 text-base leading-[1.6] text-muted">{feature.description}</p></div><Button className="shrink-0" onClick={() => { window.location.href = "/signup"; }} variant="dark">Get Started</Button></div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
