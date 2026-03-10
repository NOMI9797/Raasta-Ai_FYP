"use client";

import { useRef, useState } from "react";

const faqList = [
  {
    question: "How does Reachly connect to my LinkedIn account?",
    answer: (
      <div className="space-y-2 leading-relaxed">
        <p>
          You provide your LinkedIn email and password once. Reachly uses a
          secure browser automation session to log in on your behalf, capture
          your session cookies, and store them encrypted in the database. Your
          credentials are never stored in plain text.
        </p>
        <p>
          We recommend using a LinkedIn account that does <strong>not</strong>{" "}
          have Two-Factor Authentication (2FA) enabled, as automated sessions
          cannot handle 2FA prompts.
        </p>
      </div>
    ),
  },
  {
    question: "Is LinkedIn automation safe? Will my account get banned?",
    answer: (
      <p>
        Reachly is built with safety-first defaults — daily invite limits (10–20
        per day), randomised delays between actions, and human-like interaction
        patterns to stay within LinkedIn&apos;s acceptable use boundaries. No
        tool can guarantee zero risk, but we mirror natural usage behaviour as
        closely as possible.
      </p>
    ),
  },
  {
    question: "Can I use Reachly just for recruiting (not sales)?",
    answer: (
      <p>
        Absolutely. The Recruiter role gives you access to job management, an
        AI-generated job post workflow, a public apply page for candidates, CV
        parsing powered by LLMs, and a full candidate pipeline — all separate
        from the sales outreach features.
      </p>
    ),
  },
  {
    question: "What does Agentic Mode do?",
    answer: (
      <div className="space-y-2 leading-relaxed">
        <p>
          Agentic Mode lets an AI agent execute your entire outreach pipeline
          automatically: scrape leads, generate personalised messages, send
          invites, wait for acceptances, and then send follow-up messages — all
          without you lifting a finger.
        </p>
        <p>
          You can choose <strong>semi-auto</strong> (agent pauses at key
          checkpoints for your approval) or <strong>full-auto</strong> (runs
          end-to-end unattended).
        </p>
      </div>
    ),
  },
  {
    question: "Can I run multiple LinkedIn accounts?",
    answer: (
      <p>
        Yes. The Pro plan supports up to 5 LinkedIn accounts. Each account has
        its own daily limit settings and can be assigned to different campaigns
        or agent runs independently.
      </p>
    ),
  },
  {
    question: "Can I get a refund?",
    answer: (
      <p>
        Yes — if you&apos;re not satisfied within the first 7 days of your paid
        plan, email us at support@reachly.ai and we&apos;ll issue a full refund,
        no questions asked.
      </p>
    ),
  },
];

const Item = ({ item }) => {
  const accordion = useRef(null);
  const [isOpen, setIsOpen] = useState(false);

  return (
    <li>
      <button
        className="relative flex gap-2 items-center w-full py-5 text-base font-semibold text-left border-t md:text-lg border-base-content/10"
        onClick={(e) => {
          e.preventDefault();
          setIsOpen(!isOpen);
        }}
        aria-expanded={isOpen}
      >
        <span className={`flex-1 text-base-content ${isOpen ? "text-primary" : ""}`}>
          {item?.question}
        </span>
        <svg
          className="flex-shrink-0 w-4 h-4 ml-auto fill-current"
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect y="7" width="16" height="2" rx="1"
            className={`transform origin-center transition duration-200 ease-out ${isOpen && "rotate-180"}`}
          />
          <rect y="7" width="16" height="2" rx="1"
            className={`transform origin-center rotate-90 transition duration-200 ease-out ${isOpen && "rotate-180 hidden"}`}
          />
        </svg>
      </button>

      <div
        ref={accordion}
        className="transition-all duration-300 ease-in-out opacity-80 overflow-hidden"
        style={
          isOpen
            ? { maxHeight: accordion?.current?.scrollHeight, opacity: 1 }
            : { maxHeight: 0, opacity: 0 }
        }
      >
        <div className="pb-5 leading-relaxed text-base-content/70">{item?.answer}</div>
      </div>
    </li>
  );
};

const FAQ = () => {
  return (
    <section className="bg-base-200" id="faq">
      <div className="py-24 px-8 max-w-7xl mx-auto flex flex-col md:flex-row gap-12">
        <div className="flex flex-col text-left basis-1/2">
          <p className="inline-block font-semibold text-primary mb-4">FAQ</p>
          <p className="sm:text-4xl text-3xl font-extrabold text-base-content">
            Frequently Asked Questions
          </p>
          <p className="mt-4 text-base-content/60 leading-relaxed">
            Still have questions? Email us at{" "}
            <a href="mailto:support@reachly.ai" className="text-primary underline">
              support@reachly.ai
            </a>
          </p>
        </div>

        <ul className="basis-1/2">
          {faqList.map((item, i) => (
            <Item key={i} item={item} />
          ))}
        </ul>
      </div>
    </section>
  );
};

export default FAQ;
