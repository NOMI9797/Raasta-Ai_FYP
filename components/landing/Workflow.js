"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import {
  Building2,
  CopyCheck,
  FileSearch,
  FileSpreadsheet,
  FileText,
  Funnel,
  History,
  Inbox,
  Link2,
  ListChecks,
  MessageSquareText,
  Newspaper,
  PenLine,
  Percent,
  Search,
  Send,
  UserCheck,
  UserPlus,
} from "lucide-react";
import Container from "./ui/Container";
import SectionHeading from "./ui/SectionHeading";
import { SegmentedTabs } from "./ui/Tabs";
import BrandMark from "./BrandMark";

/* ------------------------------------------------------------------ */
/* Content. Station labels name the state; the text under each one     */
/* says what goes in or comes out, so the two never repeat each other. */
/* ------------------------------------------------------------------ */

const pipelines = {
  sales: [
    { icon: UserPlus, state: "Profile added", body: "Paste a LinkedIn profile URL, upload a CSV or Excel file, or add a match from Rozee.pk or Indeed. Duplicates are skipped." },
    { icon: Newspaper, state: "Posts read", body: "The lead's 4–5 most recent public posts, with dates and engagement." },
    { icon: PenLine, state: "Note drafted", body: "Written from your ideal customer profile, their role and their posts. You approve, edit or regenerate it. Pro can skip review with autopilot." },
    { icon: Send, state: "Invite sent", body: "Sent from a background queue, at most 15 per account per day. Pause, resume or cancel the job at any time." },
    { icon: UserCheck, state: "Acceptance tracked", body: "Checked every few hours. Accepted leads move forward on their own." },
  ],
  hiring: [
    { icon: FileText, state: "Job post written", body: "Role intro, responsibilities, requirements and benefits, generated from your preferences and ready to edit." },
    { icon: Link2, state: "Published", body: "Posted with one public application link you can share anywhere." },
    { icon: Inbox, state: "CVs collected", body: "One form for every applicant. PDF or DOCX, up to 5 MB." },
    { icon: FileSearch, state: "CVs parsed", body: "Skills, experience and education pulled into a profile you can review. Scanned images without text are flagged." },
    { icon: ListChecks, state: "Candidate moved", body: "Move each candidate from received to in review, shortlisted or rejected." },
  ],
};

const tabs = [
  { id: "sales", label: "Client acquisition", summary: "One lead, from a profile URL to an accepted invite." },
  { id: "hiring", label: "Hiring", summary: "One role, from a job post to a shortlisted candidate." },
  { id: "integrations", label: "Integrations", summary: "Every source lands in one lead list or one candidate queue." },
  { id: "analytics", label: "Analytics", summary: "Outreach and hiring progress side by side, down to each lead." },
];

const sources = ["LinkedIn profile URLs", "CSV and Excel files", "Rozee.pk", "Indeed", "Career-portal link"];
const outputs = ["Campaign lead list", "Candidate queue"];
const integrationFeatures = [
  { icon: FileSpreadsheet, text: "CSV and Excel upload with a column check" },
  { icon: Search, text: "Rozee.pk and Indeed search inside Raasta-AI" },
  { icon: CopyCheck, text: "Duplicate check across every source" },
  { icon: Building2, text: "Role and company filled in for each lead" },
  { icon: Link2, text: "One public application link per job" },
];

const analytics = [
  { icon: Percent, title: "Acceptance rate", body: "How many invites turn into connections, per campaign." },
  { icon: MessageSquareText, title: "Reply tracking", body: "Which leads replied and which still need a follow-up." },
  { icon: Funnel, title: "Candidate funnel", body: "Applicants moving from received to in review to shortlisted." },
  { icon: History, title: "Lead history", body: "Every post read, message sent and status change, in order." },
];

// Small icon tile used on every micro-card in this section.
const IconTile = ({ icon: Icon }) => (
  <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-raasta-wash text-raasta-cobaltDeep">
    <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
  </span>
);

/* ------------------------------------------------------------------ */
/* Pipeline: the road runs left to right (top to bottom on phones) and  */
/* draws as the section scrolls through the viewport. Each segment is a */
/* scaled box, so only transform changes.                               */
/* ------------------------------------------------------------------ */

const Segment = ({ progress, i, n }) => {
  const scale = useTransform(progress, [i / (n - 1), (i + 1) / (n - 1)], [0, 1], { clamp: true });
  return (
    <>
      {/* phones: vertical */}
      <span aria-hidden="true" className="absolute bottom-0 left-[13px] top-7 w-[3px] bg-raasta-line md:hidden">
        <motion.span className="block h-full w-full origin-top bg-raasta-cobalt" style={{ scaleY: scale }} />
      </span>
      {/* tablet and up: horizontal */}
      <span aria-hidden="true" className="absolute -right-4 left-7 top-[13px] hidden h-[3px] bg-raasta-line md:block">
        <motion.span className="block h-full w-full origin-left bg-raasta-cobalt" style={{ scaleX: scale }} />
      </span>
    </>
  );
};

const StationNumber = ({ progress, i, n }) => {
  const at = i / (n - 1);
  const fill = useTransform(progress, [Math.max(0, at - 0.04), at], [0, 1], { clamp: true });
  return (
    <span aria-hidden="true" className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-[3px] border-raasta-cobalt bg-raasta-white font-display text-[13px] font-medium text-raasta-navy">
      {i + 1}
      <motion.span
        className="absolute inset-[-3px] flex items-center justify-center rounded-full bg-raasta-cobalt text-raasta-white"
        style={{ opacity: fill }}
      >
        {i + 1}
      </motion.span>
    </span>
  );
};

const Pipeline = ({ steps, label }) => {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 85%", "end 60%"] });
  const done = useTransform(scrollYProgress, () => 1);
  const progress = reduce ? done : scrollYProgress;
  const n = steps.length;

  return (
    <ol ref={ref} aria-label={label} className="relative grid md:grid-cols-5 md:gap-4">
      {steps.map((s, i) => (
        <li key={s.state} className="relative flex gap-4 pb-5 last:pb-0 md:block md:pb-0">
          {i < n - 1 && <Segment progress={progress} i={i} n={n} />}
          <StationNumber progress={progress} i={i} n={n} />
          {/* micro-card: icon, state, one short paragraph */}
          <div className="min-w-0 flex-1 rounded-card border border-raasta-line bg-raasta-white p-5 md:mt-5 md:h-[calc(100%-48px)]">
            <IconTile icon={s.icon} />
            <h3 className="mt-4 font-display text-[18px] font-medium leading-snug tracking-[-0.01em] text-raasta-navy">{s.state}</h3>
            <p className="mt-1.5 text-[15px] leading-[1.55] text-raasta-slate">{s.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
};

/* ------------------------------------------------------------------ */
/* Integrations: the page's only fan shape. Sources merge into          */
/* Raasta-AI, which splits them into a lead list and a candidate queue. */
/* SVG keeps its aspect ratio, so % label positions line up exactly.    */
/* ------------------------------------------------------------------ */

const W = 1000;
const H = 340;
const srcY = sources.map((_, i) => 30 + i * 70);
const outY = [100, 240];
const HUB = { x: 560, y: 170 };
const r = 16;

const inPath = (y) => {
  if (y === HUB.y) return `M 0 ${y} H ${HUB.x - 34}`;
  const d = y < HUB.y ? 1 : -1;
  return `M 0 ${y} H ${420 - r} Q 420 ${y} 420 ${y + d * r} V ${HUB.y - d * r} Q 420 ${HUB.y} ${420 + r} ${HUB.y} H ${HUB.x - 34}`;
};
const outPath = (y) => {
  const d = y > HUB.y ? 1 : -1;
  return `M ${HUB.x + 34} ${HUB.y} H ${680 - r} Q 680 ${HUB.y} 680 ${HUB.y + d * r} V ${y - d * r} Q 680 ${y} ${680 + r} ${y} H 760`;
};

const pct = (v, total) => `${(v / total) * 100}%`;

const FanDiagram = () => (
  <>
    <div className="relative hidden aspect-[1000/340] md:block" aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" fill="none">
        {[...srcY.map(inPath), ...outY.map(outPath)].map((d) => (
          <path key={d} d={d} stroke="rgb(var(--raasta-cobalt))" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      {sources.map((s, i) => (
        <span
          key={s}
          className="absolute -translate-y-1/2 whitespace-nowrap rounded-control border border-raasta-line bg-raasta-white px-3 py-1.5 font-display text-[15px] font-semibold text-raasta-navy"
          style={{ left: 0, top: pct(srcY[i], H) }}
        >
          {s}
        </span>
      ))}
      <span className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: pct(HUB.x, W), top: pct(HUB.y, H) }}>
        <BrandMark size={60} title="Raasta-AI" />
      </span>
      {outputs.map((o, i) => (
        <span
          key={o}
          className="absolute -translate-y-1/2 rounded-chip bg-raasta-navy px-3 py-1.5 font-display text-[15px] font-medium text-raasta-white"
          style={{ left: pct(764, W), top: pct(outY[i], H) }}
        >
          {o}
        </span>
      ))}
    </div>

    {/* Phones: the same merge and split, stacked */}
    <div className="flex flex-col items-start md:hidden" aria-hidden="true">
      <ul className="flex flex-wrap gap-2">
        {sources.map((s) => (
          <li key={s} className="rounded-control border border-raasta-line bg-raasta-white px-3 py-1.5 font-display text-[15px] font-semibold">
            {s}
          </li>
        ))}
      </ul>
      <span className="ml-[27px] h-6 w-[3px] bg-raasta-cobalt" />
      <BrandMark size={56} />
      <span className="ml-[27px] h-6 w-[3px] bg-raasta-cobalt" />
      <div className="flex flex-wrap gap-2">
        {outputs.map((o) => (
          <span key={o} className="rounded-chip bg-raasta-navy px-3 py-1.5 font-display text-[15px] font-medium text-raasta-white">
            {o}
          </span>
        ))}
      </div>
    </div>
    <p className="sr-only">
      {sources.join(", ")} all go into Raasta-AI, which sorts them into a {outputs.join(" and a ")}.
    </p>
  </>
);

const Integrations = () => (
  <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-16">
    <FanDiagram />
    <ul className="grid gap-2.5 self-center">
      {integrationFeatures.map((f) => (
        <li
          key={f.text}
          className="flex items-center gap-3 rounded-card border border-raasta-line bg-raasta-white px-4 py-3 text-[15px] leading-snug text-raasta-navy"
        >
          <IconTile icon={f.icon} />
          {f.text}
        </li>
      ))}
    </ul>
  </div>
);

const Analytics = () => (
  <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
    {analytics.map((a) => (
      <div key={a.title} className="rounded-card border border-raasta-line bg-raasta-white p-5">
        <IconTile icon={a.icon} />
        <dt className="mt-4 font-display text-[18px] font-medium text-raasta-navy">{a.title}</dt>
        <dd className="mt-1.5 text-[15px] leading-[1.55] text-raasta-slate">{a.body}</dd>
      </div>
    ))}
  </dl>
);

/* ------------------------------------------------------------------ */

const Workflow = () => {
  const [active, setActive] = useState(0);
  const tab = tabs[active];

  // Deep links: #hiring (nav, footer) or ?tab=<id>
  useEffect(() => {
    const sync = () => {
      const fromHash = window.location.hash === "#hiring" ? "hiring" : null;
      const t = fromHash || new URLSearchParams(window.location.search).get("tab");
      const idx = tabs.findIndex((x) => x.id === t);
      if (idx >= 0) setActive(idx);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  return (
    <section id="workflow" aria-labelledby="workflow-title" className="relative border-t border-raasta-line bg-raasta-mist py-20 md:py-32">
      <span id="hiring" aria-hidden="true" className="absolute top-0 block" />
      <Container>
        <SectionHeading
          id="workflow-title"
          title="Follow a lead from profile to accepted invite, or a candidate from job post to shortlist"
        />

        <div className="mt-10 md:mt-12">
          <SegmentedTabs tabs={tabs} active={active} setActive={setActive} idPrefix="wf" label="Workflows" />
        </div>

        <div id="wf-panel" role="tabpanel" aria-labelledby={`wf-tab-${tab.id}`} className="mt-8">
          <p className="mb-10 text-[17px] leading-[1.6] text-raasta-slate">{tab.summary}</p>
          {pipelines[tab.id] && <Pipeline key={tab.id} steps={pipelines[tab.id]} label={`${tab.label} steps`} />}
          {tab.id === "integrations" && <Integrations />}
          {tab.id === "analytics" && <Analytics />}
        </div>
      </Container>
    </section>
  );
};

export default Workflow;
