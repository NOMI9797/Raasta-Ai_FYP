"use client";

import { useState, useRef } from "react";

const features = [
  {
    title: "Campaign Management",
    description:
      "Build targeted LinkedIn outreach campaigns with smart lead lists. Paste profile URLs, track every lead's status, and manage multiple campaigns — all from one dashboard.",
    svg: (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    title: "AI Message Generation",
    description:
      "Stop writing the same message 200 times. Reachly's AI reads each lead's profile, recent posts, and company news to craft hyper-personalised connection requests and follow-up messages automatically.",
    svg: (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
      </svg>
    ),
  },
  {
    title: "Automated Invites & Follow-ups",
    description:
      "Set your daily invite limit, configure delays between actions, and let Reachly send invites and automatically message accepted connections — all within LinkedIn's safe limits.",
    svg: (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
      </svg>
    ),
  },
  {
    title: "Recruiter Pipeline",
    description:
      "Post AI-generated job listings, collect CVs through a public apply page, and screen candidates automatically with LLM-powered resume parsing — your hiring pipeline on autopilot.",
    svg: (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
      </svg>
    ),
  },
  {
    title: "Agentic Mode (Full Autopilot)",
    description:
      "Switch on an AI agent to run your entire pipeline from start to finish — scrape profiles, generate messages, send invites, check connections, and message accepted leads. You approve at key checkpoints or go fully autonomous.",
    svg: (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1 1 .03 2.798-1.442 2.798H4.24c-1.47 0-2.441-1.798-1.442-2.798L4.2 15.3" />
      </svg>
    ),
  },
];

const Item = ({ feature, isOpen, setFeatureSelected }) => {
  const accordion = useRef(null);
  const { title, description, svg } = feature;

  return (
    <li>
      <button
        className="relative flex gap-2 items-center w-full py-5 text-base font-medium text-left md:text-lg"
        onClick={(e) => {
          e.preventDefault();
          setFeatureSelected();
        }}
        aria-expanded={isOpen}
      >
        <span className={`duration-100 ${isOpen ? "text-primary" : ""}`}>
          {svg}
        </span>
        <span className={`flex-1 text-base-content ${isOpen ? "text-primary font-semibold" : ""}`}>
          <h3 className="inline">{title}</h3>
        </span>
      </button>

      <div
        ref={accordion}
        className="transition-all duration-300 ease-in-out text-base-content/70 overflow-hidden"
        style={
          isOpen
            ? { maxHeight: accordion?.current?.scrollHeight, opacity: 1 }
            : { maxHeight: 0, opacity: 0 }
        }
      >
        <div className="pb-5 leading-relaxed">{description}</div>
      </div>
    </li>
  );
};

const FeaturesAccordion = () => {
  const [featureSelected, setFeatureSelected] = useState(0);

  return (
    <section
      className="py-24 md:py-32 max-w-7xl mx-auto bg-base-100"
      id="features"
    >
      <div className="px-8">
        <h2 className="font-extrabold text-4xl lg:text-6xl tracking-tight mb-4">
          Everything you need to{" "}
          <span className="bg-neutral text-neutral-content px-2 md:px-4 leading-relaxed whitespace-nowrap">
            close more deals
          </span>
        </h2>
        <p className="text-base-content/60 text-lg mb-16 max-w-xl">
          From first touch to signed contract — Reachly handles the full
          LinkedIn outreach and recruitment workflow.
        </p>

        <div className="flex flex-col md:flex-row gap-12 md:gap-24">
          <div className="grid grid-cols-1 items-stretch gap-8 sm:gap-12 lg:grid-cols-2 lg:gap-20 w-full">
            <ul className="w-full">
              {features.map((feature, i) => (
                <Item
                  key={feature.title}
                  index={i}
                  feature={feature}
                  isOpen={featureSelected === i}
                  setFeatureSelected={() => setFeatureSelected(i)}
                />
              ))}
            </ul>

            <div className="rounded-2xl bg-base-200 border border-base-300 p-8 flex flex-col gap-6 justify-center">
              <div className="text-5xl">{["📊", "✍️", "🚀", "👥", "🤖"][featureSelected]}</div>
              <h3 className="text-xl font-bold text-base-content">
                {features[featureSelected].title}
              </h3>
              <p className="text-base-content/60 leading-relaxed">
                {features[featureSelected].description}
              </p>
              <div className="flex gap-2 flex-wrap">
                {["Automated", "AI-powered", "Real-time"].map((tag) => (
                  <span key={tag} className="badge badge-outline badge-sm">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default FeaturesAccordion;
