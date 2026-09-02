"use client"

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const TabList = [
  { id: 'campaigns', title: 'Campaign Management', desc: 'Create and schedule multi-touch campaigns' },
  { id: 'generation', title: 'AI Message Generation', desc: 'Smart personalized messages' },
  { id: 'invites', title: 'Automated Invites & Follow-ups', desc: 'Auto-invite and follow-up sequences' },
  { id: 'recruiter', title: 'Recruiter Pipeline', desc: 'CV parsing and candidate flow' },
  { id: 'agentic', title: 'Agentic Mode (Full Autopilot)', desc: 'End-to-end autonomous hiring' },
];

export default function Home() {
  const [activeTab, setActiveTab] = useState('campaigns');
  const [typingText, setTypingText] = useState('');
  const fullAgentText = "Hi Sarah, I noticed your team at Acme Corp recently expanded into EMEA. Would you be open to a quick chat about hiring senior sales talent there?";
  const [inviteCount, setInviteCount] = useState(14);

  useEffect(() => {
    let idx = 0;
    setTypingText('');
    const t = setInterval(() => {
      setTypingText((s) => fullAgentText.slice(0, s.length + 1));
      idx++;
      if (idx > fullAgentText.length) clearInterval(t);
    }, 18);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    const iv = setInterval(() => setInviteCount((c) => (c < 20 ? c + 1 : 14)), 3500);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="min-h-screen bg-[#080B13] text-white selection:bg-[#6366F1]/30">
      <React.Suspense fallback={null}>
        <Header />
      </React.Suspense>

      {/* HERO */}
      <section className="relative overflow-hidden py-20">
        <div aria-hidden className="absolute inset-0 pointer-events-none -z-10 flex items-center justify-center">
          <div className="w-[900px] h-[900px] rounded-full" style={{ background: 'radial-gradient(circle at 30% 30%, rgba(99,102,241,0.12), rgba(124,58,237,0.06) 20%, transparent 40%)' }} />
        </div>

        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          {/* Left */}
          <div>
            <div className="inline-flex items-center gap-3 mb-4">
              <span className="font-mono text-xs bg-white/[0.03] px-3 py-1 rounded-full text-indigo-200">[AI-Powered LinkedIn Automation]</span>
              <div className="w-2 h-2 rounded-full bg-indigo-500/40 blur-sm" />
            </div>

            <h1 className="text-5xl font-bold leading-tight font-space text-white mb-4">Automate your LinkedIn outreach &amp; hiring at scale</h1>

            <p className="text-slate-300 max-w-xl mb-6">Raasta-AI runs your entire B2B sales and recruitment pipeline — from lead discovery to signed deals and hired talent — completely on autopilot.</p>

            <div className="flex flex-wrap gap-3 items-center">
              <Link href="/dashboard" className="inline-flex items-center bg-gradient-to-r from-[#6366F1] to-[#7C3AED] px-5 py-3 rounded-full text-sm font-semibold shadow-lg">Get Started</Link>
              <a href="#features" className="inline-flex items-center bg-white/[0.04] border border-white/[0.06] px-4 py-2 rounded-full text-sm">See How It Works</a>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <div className="-space-x-2 flex">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-xs font-bold">RA</div>
                <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center text-xs">JS</div>
                <div className="w-9 h-9 rounded-full bg-slate-600 flex items-center justify-center text-xs">MK</div>
              </div>
              <div className="text-sm text-slate-300">Trusted by 200+ sales reps &amp; recruiters</div>
            </div>
          </div>

          {/* Right - Live Simulation Card */}
          <div>
            <div className="rounded-2xl bg-[#0F1629] border border-white/[0.08] p-5 shadow-[0_20px_60px_rgba(124,58,237,0.15)]">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono bg-white/[0.03] px-2 py-1 rounded">LIVE CAMPAIGN</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs bg-white/[0.03] px-2 py-1 rounded text-slate-300">Running</span>
                </div>
                <div className="text-xs text-slate-400">Updated 2m ago</div>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="p-3 rounded-lg bg-[#0B1220] text-center">
                  <div className="text-sm text-slate-300">Invites Sent</div>
                  <div className="text-xl font-bold">142</div>
                </div>
                <div className="p-3 rounded-lg bg-[#0B1220] text-center">
                  <div className="text-sm text-slate-300">Accepted</div>
                  <div className="text-xl font-bold">38</div>
                </div>
                <div className="p-3 rounded-lg bg-[#0B1220] text-center">
                  <div className="text-sm text-slate-300">Replies</div>
                  <div className="text-xl font-bold">21</div>
                </div>
              </div>

              <div className="rounded-xl bg-[#081021] p-4 border border-white/[0.04]">
                <div className="text-sm text-slate-300 mb-2">Agent</div>
                <div className="text-sm text-slate-200 mb-2">{typingText}<span className="blinking">▌</span></div>

                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                    <div>Daily invites</div>
                    <div>{inviteCount} / 20</div>
                  </div>
                  <div className="w-full bg-white/[0.04] rounded-full h-2">
                    <div className="h-2 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all" style={{ width: `${(inviteCount / 20) * 100}%` }} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PROBLEM AGITATION */}
      <section className="py-12">
        <div className="max-w-5xl mx-auto px-6 bg-[#080B13] rounded-2xl p-8 text-center border border-white/[0.04]">
          <h2 className="text-3xl font-bold text-white font-space">Manual LinkedIn outreach is killing your pipeline</h2>
          <p className="text-slate-300 mt-4 max-w-2xl mx-auto">You spend hours every day copying profiles, writing messages, and tracking who replied — only to miss follow-ups and lose deals.</p>

          <div className="mt-8 flex flex-col md:flex-row items-center justify-center gap-6">
            <div className="flex items-center gap-3">
              <div className="text-2xl">⏳</div>
              <div className="text-sm">3+ hrs/day on manual DMs</div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-2xl">🔄</div>
              <div className="text-sm">Inconsistent follow-ups</div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-2xl">💸</div>
              <div className="text-sm">Deals & hires slip away</div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURE TABS */}
      <section id="features" className="max-w-7xl mx-auto my-16 p-8 md:p-14 bg-[#F8FAFC] rounded-3xl border border-slate-200/80 shadow-2xl text-[#0F172A]">
        <h3 className="text-4xl font-bold text-center mb-10 font-space">Everything you need to close more deals</h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="space-y-3">
            {TabList.map((t) => (
              <button key={t.id} onClick={() => setActiveTab(t.id)} className={`w-full text-left p-4 rounded-xl ${activeTab === t.id ? 'bg-white shadow' : 'bg-white/[0.6]'} transition`}> 
                <div className="font-semibold">{t.title}</div>
                <div className="text-sm text-slate-600 mt-1">{t.desc}</div>
              </button>
            ))}
          </div>

          <div className="md:col-span-2">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-lg p-8">
              <div className="flex items-center gap-3 mb-4">
                <span className="font-mono text-xs text-slate-500 bg-slate-50 px-2 py-1 rounded">[Automated]</span>
                <span className="font-mono text-xs text-slate-500 bg-slate-50 px-2 py-1 rounded">[AI-powered]</span>
                <span className="font-mono text-xs text-slate-500 bg-slate-50 px-2 py-1 rounded">[Real-time]</span>
              </div>

              {activeTab === 'campaigns' && (<div>
                <h4 className="text-xl font-semibold">Campaign Manager</h4>
                <p className="text-sm text-slate-600 mt-2">Drag, schedule and monitor multi-channel campaigns with live analytics.</p>
              </div>)}

              {activeTab === 'generation' && (<div>
                <h4 className="text-xl font-semibold">AI Message Generation</h4>
                <p className="text-sm text-slate-600 mt-2">One-click personalized messages tuned per role and company context.</p>
              </div>)}

              {activeTab === 'invites' && (<div>
                <h4 className="text-xl font-semibold">Automated Invites</h4>
                <p className="text-sm text-slate-600 mt-2">Auto-invite, follow-up and escalate sequences with retry logic.</p>
              </div>)}

              {activeTab === 'recruiter' && (<div>
                <h4 className="text-xl font-semibold">Recruiter Pipeline</h4>
                <p className="text-sm text-slate-600 mt-2">CV parsing, role matching and candidate workflows tailored for hiring teams.</p>
              </div>)}

              {activeTab === 'agentic' && (<div>
                <h4 className="text-xl font-semibold">Agentic Mode</h4>
                <p className="text-sm text-slate-600 mt-2">Hand off entire hiring workflows to autonomous agents that iterate and improve.</p>
              </div>)}
            </div>
          </div>
        </div>
      </section>

      {/* PRICING & FAQ */}
      <section id="pricing" className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-[#0F1629] border border-white/[0.08] text-white rounded-2xl p-8">
            <h4 className="text-xl font-semibold">Starter</h4>
            <div className="mt-4 text-3xl font-bold">$49</div>
            <ul className="mt-4 space-y-2 text-sm text-slate-300">
              <li>✓ Basic Campaigns</li>
              <li>✓ 5 seats</li>
              <li>✓ Email + LinkedIn</li>
            </ul>
            <a href="/signup" className="mt-6 inline-block bg-white/[0.04] px-4 py-2 rounded-full text-sm">Start</a>
          </div>

          <div className="bg-[#0F1629] border-2 border-indigo-500 text-white rounded-2xl p-8 relative">
            <div className="absolute -top-3 right-6 bg-indigo-600 text-xs px-3 py-1 rounded-full">Popular</div>
            <h4 className="text-xl font-semibold">Pro</h4>
            <div className="mt-4 text-3xl font-bold">$99</div>
            <ul className="mt-4 space-y-2 text-sm text-slate-300">
              <li>✓ Advanced Campaigns</li>
              <li>✓ 15 seats</li>
              <li>✓ ATS Integration</li>
            </ul>
            <a href="/signup" className="mt-6 inline-block bg-gradient-to-r from-[#6366F1] to-[#7C3AED] px-4 py-2 rounded-full text-sm text-white">Get Pro</a>
          </div>
        </div>

        {/* FAQ Accordion */}
        <div id="faq" className="mt-10 max-w-3xl mx-auto">
          <FAQAccordion />
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#080B13] border-t border-white/[0.08] text-slate-400">
        <div className="max-w-7xl mx-auto px-6 py-12">
          <Footer />
        </div>
      </footer>
    </div>
  );
}

function FAQAccordion() {
  const items = [
    { q: 'How does onboarding work?', a: 'Onboarding connects your accounts and we import historical leads to seed models.' },
    { q: 'Is my data private?', a: 'Yes — we provide team-scoped isolation and role-based access controls.' },
    { q: 'Can I pause campaigns?', a: 'Absolutely — campaigns are pausable and resumable with audit logs.' },
  ];
  const [open, setOpen] = useState(null);
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="bg-white/[0.03] p-4 rounded-lg border border-white/[0.04]">
          <button onClick={() => setOpen(open === i ? null : i)} className="w-full flex items-center justify-between">
            <div className="text-left">
              <div className="font-semibold text-white">{it.q}</div>
            </div>
            <div className="text-slate-300">{open === i ? '−' : '+'}</div>
          </button>
          {open === i && <div className="mt-3 text-sm text-slate-300">{it.a}</div>}
        </div>
      ))}
    </div>
  );
}