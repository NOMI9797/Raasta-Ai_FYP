"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import config from "@/config";
import Container from "./ui/Container";
import SectionHeading from "./ui/SectionHeading";
import Disclosure from "./ui/Disclosure";

// Grouped so the list scans by topic. The last group is labelled Roadmap: those answers
// describe plans, not features.
const groups = [
  {
    title: "Limits and control",
    items: [
      {
        q: "How does Raasta-AI respect LinkedIn's limits?",
        a: "Invites go out from a background queue, at most 15 per LinkedIn account per day, and the count resets daily. You can pause, resume or cancel any job at any time. Automation on LinkedIn is still subject to LinkedIn's own terms, so keep volumes sensible.",
      },
      {
        q: "Do I approve messages before they're sent?",
        a: "By default, yes. Every generated message lands in a review queue where you can approve, edit or regenerate it. On the Pro plan you can turn on autopilot for campaigns you trust; it still respects the daily cap and you can switch it off at any time.",
      },
      {
        q: "Can my team have different access levels?",
        a: "Yes. Admins see everything, Recruiters work in hiring, and Sales Operators work in client acquisition. Each role only sees the workflows it needs.",
      },
      {
        q: "How is my data protected?",
        a: "Passwords are hashed with bcrypt, LinkedIn session data is encrypted at rest, all traffic uses TLS, and leads are isolated per user and campaign.",
      },
    ],
  },
  {
    title: "How it works",
    items: [
      {
        q: "Where do leads and candidates come from?",
        a: "Paste LinkedIn profile URLs, upload a CSV or Excel file, or pull from Rozee.pk and Indeed. Candidates can also apply through a public application link generated for each job.",
      },
      {
        q: "How are messages personalized?",
        a: "Each note is generated from your ideal customer profile, the lead's role and company, and a summary of their 4–5 most recent LinkedIn posts. It isn't a template with a name swapped in.",
      },
      {
        q: "What resume formats are supported?",
        a: "PDF and DOCX files up to 5 MB. Resumes are parsed automatically into skills, work experience and education; scanned images without a text layer are flagged for manual review.",
      },
    ],
  },
  {
    title: "Roadmap",
    items: [
      {
        q: "What is on the roadmap?",
        a: "Planned, not yet available: transparent AI candidate scoring with per-criterion breakdowns, AI-assisted interviews with transcription and evaluation, a voice agent that qualifies prospects and books meetings, and multi-channel A/B testing for outreach.",
      },
    ],
  },
];

const FAQ = () => {
  const [open, setOpen] = useState("0-0");

  return (
    <section id="faq" aria-labelledby="faq-title" className="border-t border-raasta-line bg-raasta-white py-20 md:py-32">
      <Container className="grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] md:gap-16">
        <div className="md:sticky md:top-24 md:self-start">
          <SectionHeading
            id="faq-title"
            title="Before you connect LinkedIn"
            sub="What teams ask about limits, data and access."
          />
          <p className="mt-6 text-[16px] text-raasta-slate">Still have a question?</p>
          <a
            href={`mailto:${config.contactEmail}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-control font-display text-[16px] font-semibold text-raasta-cobalt underline-offset-[5px] hover:text-raasta-cobaltDeep hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-raasta-cobalt"
          >
            <Mail className="h-4 w-4" aria-hidden="true" />
            {config.contactEmail}
          </a>
        </div>

        <div className="flex flex-col gap-10">
          {groups.map((g, gi) => (
            <div key={g.title}>
              <h3 className="mb-1 font-display text-[15px] font-medium text-raasta-cobaltDeep">{g.title}</h3>
              <ul className="border-t border-raasta-line">
                {g.items.map((item, i) => {
                  const key = `${gi}-${i}`;
                  return (
                    <Disclosure
                      key={item.q}
                      id={`faq-${key}`}
                      question={item.q}
                      open={open === key}
                      onToggle={() => setOpen(open === key ? null : key)}
                    >
                      {item.a}
                    </Disclosure>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
};

export default FAQ;
