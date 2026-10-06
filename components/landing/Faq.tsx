"use client";

import { useState } from "react";
import { AnimatePresence, m } from "framer-motion";
import { Minus, Plus } from "lucide-react";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { useHydratedReducedMotion } from "@/lib/motion";
import { Reveal } from "@/components/ui/Reveal";

const questions = [
  { question: "How does Raasta-AI connect to my LinkedIn account?", answer: "Through a secure server-side browser session. Credentials are never stored in plain text and session data is stored encrypted. Use an account without 2FA, since automated sessions can't complete 2FA prompts." },
  { question: "Is LinkedIn automation safe? Will my account get banned?", answer: "A built-in cap of 15 invites per day per account plus rate limiting lowers risk, but no automation tool can guarantee zero platform restrictions." },
  { question: "Can I use Raasta-AI just for recruiting?", answer: "Yes. The hiring module works on its own: AI job posts, LinkedIn publishing, a public application form, and resume parsing." },
  { question: "What does Agentic Mode do?", answer: "Coming soon: full-autopilot outreach from discovery to follow-up." },
  { question: "Can I run multiple LinkedIn accounts?", answer: "Yes, based on your plan (Starter 1, Pro up to 5)." },
  { question: "Can I get a refund?", answer: "TBD" },
] as const;

export function Faq() {
  const [open, setOpen] = useState(0);
  const reducedMotion = useHydratedReducedMotion();
  return (
    <section className="scroll-mt-16 py-16 md:py-24" data-testid="section-faq" id="faq">
      <Reveal className="mx-auto grid w-[min(100%-32px,1200px)] gap-12 md:grid-cols-2 md:gap-20">
        <div className="self-start md:sticky md:top-24">
          <Eyebrow>FAQ</Eyebrow>
          <h2 className="mt-4 max-w-[360px] font-medium leading-[1.1] tracking-[-0.03em] text-ink">Frequently Asked Questions</h2>
          <p className="mt-6 text-base leading-[1.6] text-muted">Still have questions? Email us at <a className="font-medium text-primary underline underline-offset-4" href="mailto:support@raasta-ai.com">support@raasta-ai.com</a></p>
        </div>
        <div className="border-b border-border">
          {questions.map((item, index) => {
            const isOpen = open === index;
            return (
              <div className="border-t border-border" data-testid="faq-item" key={item.question}>
                <button aria-expanded={isOpen} className="flex w-full items-center gap-5 p-6 text-left text-[15px] font-semibold text-ink" onClick={() => setOpen(isOpen ? -1 : index)} type="button">
                  <span className="flex-1">{item.question}</span>
                  <m.span animate={{ rotate: isOpen ? 180 : 0 }} className="grid size-7 shrink-0 place-items-center rounded-full border border-border text-primary" transition={{ duration: reducedMotion ? 0 : 0.2 }}>{isOpen ? <Minus size={14} /> : <Plus size={14} />}</m.span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen ? <m.div animate={{ height: "auto", opacity: 1, y: 0 }} exit={{ height: 0, opacity: 0, y: -6 }} initial={{ height: 0, opacity: 0, y: -6 }} transition={{ duration: reducedMotion ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}><p className="max-w-[620px] px-6 pb-6 pr-12 text-base leading-[1.6] text-muted">{item.answer}</p></m.div> : null}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </Reveal>
    </section>
  );
}

