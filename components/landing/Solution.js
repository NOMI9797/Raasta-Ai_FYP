"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { FileSpreadsheet, Heart, MessageCircle } from "lucide-react";
import Container from "./ui/Container";
import SectionHeading from "./ui/SectionHeading";
import { tabKeyHandler } from "./ui/Tabs";
import { ease } from "./ui/motion";

/* ---------- Screens (illustrations: nothing in them looks clickable) ---------- */

const Screen = ({ children, className = "" }) => (
  <div className={`w-[min(520px,92%)] rounded-card border border-raasta-line bg-raasta-white p-5 text-[15px] text-raasta-navy sm:p-6 ${className}`}>
    {children}
  </div>
);

// Control names as plain text, so the illustration never invites a click.
// Destructive actions are red; everything else is slate.
const Controls = ({ items }) => (
  <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-raasta-line pt-3 text-[13px] font-semibold">
    <span className="font-normal text-raasta-slate">Controls:</span>
    {items.map(([label, tone]) => (
      <span key={label} className={tone === "danger" ? "text-raasta-danger" : "text-raasta-slate"}>
        {label}
      </span>
    ))}
  </p>
);

const UploadScreen = () => (
  <Screen>
    <div className="flex items-center gap-3">
      <FileSpreadsheet className="h-8 w-8 shrink-0 text-raasta-cobalt" strokeWidth={1.5} aria-hidden="true" />
      <div>
        <p className="font-semibold">leads.csv</p>
        <p className="text-[13px] text-raasta-slate">257 rows, profile URL format checked</p>
      </div>
    </div>
    <dl className="mt-4 grid grid-cols-3 divide-x divide-raasta-line rounded-control border border-raasta-line text-center">
      {[
        ["248", "Added"],
        ["6", "Duplicates skipped"],
        ["3", "Invalid URLs"],
      ].map(([n, l]) => (
        <div key={l} className="flex flex-col-reverse px-2 py-2.5">
          <dt className="text-[12px] leading-tight text-raasta-slate">{l}</dt>
          <dd className="font-display text-[21px] font-medium tabular-nums">{n}</dd>
        </div>
      ))}
    </dl>
  </Screen>
);

const PostsScreen = () => (
  <Screen className="space-y-2">
    {[
      ["Growing an SDR team from 2 to 12 in a quarter", 214, 38, "2 days ago"],
      ["What we learned replacing cold email with warm intros", 156, 22, "6 days ago"],
      ["Hiring our first Head of Growth: what worked", 98, 17, "11 days ago"],
    ].map(([title, likes, comments, when]) => (
      <div key={title} className="rounded-control border border-raasta-line p-3">
        <p className="line-clamp-1 font-semibold">{title}</p>
        <p className="mt-1 flex items-center gap-3 text-[13px] tabular-nums text-raasta-slate">
          <span className="inline-flex items-center gap-1">
            <Heart className="h-3.5 w-3.5" aria-hidden="true" />
            {likes}
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
            {comments}
          </span>
          <span>{when}</span>
        </p>
      </div>
    ))}
  </Screen>
);

const NoteScreen = () => (
  <Screen>
    <p className="text-[13px] text-raasta-slate">Note for Ayesha Rahman, waiting for your review</p>
    <p className="mt-2 leading-[1.6]">
      Hi Ayesha, your post on growing an SDR team from 2 to 12 stood out. We help growth teams take the research out of
      outreach. Open to comparing notes?
    </p>
    <Controls items={[["Approve"], ["Edit"], ["Regenerate"]]} />
  </Screen>
);

const LimitScreen = () => (
  <Screen>
    <p className="font-display text-[21px] font-medium tabular-nums">9 of 15 invites sent today</p>
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-raasta-line" aria-hidden="true">
      <div className="h-full w-[60%] rounded-full bg-raasta-cobalt" />
    </div>
    <p className="mt-2 text-[13px] text-raasta-slate">Stays within LinkedIn&apos;s daily limit. The count resets at midnight.</p>
    <Controls items={[["Pause"], ["Resume"], ["Cancel job", "danger"]]} />
  </Screen>
);

const CandidateScreen = () => (
  <Screen>
    <p className="font-semibold">Zara Ahmed</p>
    <p className="text-[13px] text-raasta-slate">Full-stack engineer, 4 years, resume.pdf</p>
    <p className="mt-4 text-[13px] font-semibold text-raasta-slate">Skills found in the CV</p>
    <ul className="mt-1.5 flex flex-wrap gap-1.5">
      {["React", "Node.js", "PostgreSQL", "Redis", "Docker"].map((s) => (
        <li key={s} className="rounded-chip bg-raasta-wash px-2 py-0.5 text-[13px] text-raasta-cobaltDeep">
          {s}
        </li>
      ))}
    </ul>
    <p className="mt-4 text-[13px] text-raasta-slate">
      Stage: <span className="font-semibold text-raasta-navy">Shortlisted</span>
    </p>
  </Screen>
);

/* ---------- Steps ---------- */

const steps = [
  {
    label: "Bring in leads",
    title: "Every lead is checked before it joins a campaign",
    body: "Paste profile URLs or upload a CSV or Excel file. Each entry is checked against the linkedin.com/in/ format, and duplicates are skipped without stopping the rest.",
    Screen: UploadScreen,
  },
  {
    label: "Read their posts",
    title: "See what each lead has been posting about",
    body: "Raasta-AI reads each lead's 4–5 most recent public posts, with dates and engagement, so outreach starts from something they said.",
    Screen: PostsScreen,
  },
  {
    label: "Review the note",
    title: "A first draft for every lead, ready for you to review",
    body: "Your ideal customer profile, the lead's role and their posts become a note. Approve, edit or regenerate it, one lead at a time or in bulk.",
    Screen: NoteScreen,
  },
  {
    label: "Send within limits",
    title: "Sending that stays within LinkedIn's daily limits",
    body: "Invites go out from a background queue, at most 15 per account per day. Pause, resume or cancel any job. Acceptances are checked every few hours.",
    Screen: LimitScreen,
  },
  {
    label: "Shortlist candidates",
    title: "From job post to shortlist in one place",
    body: "Generate a job post, share one application link, and get every PDF or DOCX CV turned into skills, experience and education.",
    Screen: CandidateScreen,
  },
];

// Tour tabs: you choose the screen (click or arrow keys). No auto-advance; the panel
// cross-fades only in response to a choice.
const Solution = () => {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const step = steps[active];
  const select = (i) => setActive(i);

  return (
    <section id="solution" aria-labelledby="solution-title" className="border-t border-raasta-line bg-raasta-white py-20 md:py-32">
      <Container>
        <SectionHeading
          id="solution-title"
          title="What you see at each step"
          sub="Five screens from Raasta-AI, from the first CSV upload to a shortlisted candidate."
        />

        <div className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-10 md:mt-16 md:grid-cols-[300px_minmax(0,1fr)] md:gap-12">
          <div className="min-w-0">
            <div
              role="tablist"
              aria-orientation="vertical"
              aria-label="Raasta-AI screens"
              onKeyDown={tabKeyHandler(steps.length, select, { vertical: true })}
              className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 py-1 md:mx-0 md:flex-col md:overflow-visible md:px-0"
            >
              {steps.map((s, i) => {
                const isActive = i === active;
                return (
                  <button
                    key={s.label}
                    type="button"
                    role="tab"
                    id={`solution-tab-${i}`}
                    aria-selected={isActive}
                    aria-controls="solution-panel"
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => select(i)}
                    className={`flex h-11 shrink-0 items-center whitespace-nowrap rounded-control px-4 py-2 text-left text-[16px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-raasta-cobalt ${
                      isActive
                        ? "bg-raasta-wash text-raasta-cobaltDeep"
                        : "text-raasta-navy/70 hover:bg-raasta-navy/[0.04] hover:text-raasta-navy"
                    }`}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-6 hidden md:block">
              <h3 className="font-display text-[21px] font-medium leading-snug tracking-[-0.01em] text-raasta-navy">{step.title}</h3>
              <p className="mt-2 text-[16px] leading-[1.6] text-raasta-slate">{step.body}</p>
            </div>
          </div>

          <div className="min-w-0" id="solution-panel" role="tabpanel" aria-labelledby={`solution-tab-${active}`}>
            {/* both screens share one grid cell, so the swap is a true cross-fade */}
            <div className="grid min-h-[320px] place-items-center overflow-hidden rounded-card bg-raasta-mist py-8 md:min-h-[400px]">
              <AnimatePresence initial={false}>
                <motion.div
                  key={active}
                  className="flex w-full justify-center [grid-area:1/1]"
                  initial={reduce ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? undefined : { opacity: 0, y: -12 }}
                  transition={{ duration: 0.3, ease }}
                >
                  <step.Screen />
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="mt-5 md:hidden">
              <h3 className="font-display text-[21px] font-medium leading-snug text-raasta-navy">{step.title}</h3>
              <p className="mt-2 text-[16px] leading-[1.6] text-raasta-slate">{step.body}</p>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
};

export default Solution;
