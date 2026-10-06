"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { AlertTriangle, Bot, Check, Hand, Loader2, Mail, Play, Search } from "lucide-react";

const OUTREACH = ["send_email", "send_invite", "send_linkedin_message", "send_reply", "send_follow_up"];
const MODES = [
  { value: "semi_auto", key: "assisted", label: "Semi-auto", hint: "Asks you before anything is sent" },
  { value: "full_auto", key: "autopilot", label: "Auto", hint: "Sends on its own, within the daily limits" },
];

/** Start the sales agent on a campaign. */
export default function LaunchSalesAgent({ setup, policy, defaults, onStarted }) {
  const [campaigns, setCampaigns] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState({
    campaignId: "",
    mode: "semi_auto",
    dailyEmailCap: defaults?.dailyEmailCap ?? 20,
    minFitScore: defaults?.minFitScore ?? 50,
    accountId: "",
    searchOn: false,
    search: { query: "", location: "", country: "pk", hoursOld: "", limit: 15 },
    repeatSearch: false,
  });
  const [starting, setStarting] = useState(false);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const setSearch = (key, value) => setForm((f) => ({ ...f, search: { ...f.search, [key]: value } }));

  useEffect(() => {
    fetch("/api/campaigns").then((r) => r.json()).then((d) => {
      const list = d.campaigns || [];
      setCampaigns(list);
      if (list[0]) setForm((f) => ({ ...f, campaignId: f.campaignId || list[0].id }));
    }).catch(() => {});
    fetch("/api/linkedin/accounts").then((r) => r.json()).then((d) => setAccounts(d.accounts || [])).catch(() => {});
  }, []);

  const campaign = campaigns.find((c) => c.id === form.campaignId);
  const takesIndeed = (campaign?.sources || []).includes("indeed");
  const modeKey = MODES.find((m) => m.value === form.mode)?.key;
  const outreachPolicy = useMemo(() => (policy?.[modeKey] || []).filter((p) => OUTREACH.includes(p.action)), [policy, modeKey]);

  const start = async (e) => {
    e.preventDefault();
    setStarting(true);
    try {
      const config = {
        campaignId: form.campaignId,
        dailyEmailCap: Number(form.dailyEmailCap),
        minFitScore: Number(form.minFitScore),
        ...(form.accountId ? { accountId: form.accountId } : {}),
        ...(form.searchOn && takesIndeed
          ? {
              search: { ...form.search, limit: Number(form.search.limit) || 15, ...(form.search.hoursOld ? { hoursOld: Number(form.search.hoursOld) } : { hoursOld: undefined }) },
              repeatSearch: form.repeatSearch,
            }
          : {}),
      };
      const res = await fetch("/api/agents/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipelineType: "sales_operator", mode: form.mode, config }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start the agent");
      toast.success("Sales agent started");
      onStarted?.(data.run);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setStarting(false);
    }
  };

  const email = setup?.email;
  const research = setup?.research;

  return (
    <form onSubmit={start} className="rounded-xl border border-base-300 bg-base-100 p-5 space-y-5">
      <div className="flex items-center gap-2">
        <Bot className="h-5 w-5 text-primary" />
        <h2 className="font-semibold">Start the sales agent</h2>
      </div>

      {email && (
        <div className={`alert text-sm items-start ${email.testRecipient ? "alert-info" : email.transport === "smtp" ? "alert-success" : "alert-warning"}`}>
          <Mail className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            {email.testRecipient ? (
              <p><span className="font-semibold">Test mode:</span> every email goes to {email.testRecipient}, not to the companies. Remove SALES_EMAIL_TEST_RECIPIENT from .env.local to send for real.</p>
            ) : email.transport === "smtp" ? (
              <p>Emails are sent for real through your SMTP account.</p>
            ) : (
              <p>No SMTP account is set up: emails are saved to the local outbox folder, not sent.</p>
            )}
            {research?.searchProvider !== "serper" && (
              <p className="text-xs opacity-80 mt-1">Research uses free search, which blocks after a few searches: add SERPER_API_KEY for websites and decision-makers.</p>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <label className="form-control">
          <span className="label-text text-xs mb-1">Campaign</span>
          <select className="select select-bordered select-sm" value={form.campaignId} onChange={(e) => set("campaignId", e.target.value)} required>
            {campaigns.length === 0 && <option value="">No campaigns yet</option>}
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {campaigns.length === 0 && <Link href="/dashboard/sales/campaigns" className="link link-primary text-xs mt-1">Create a campaign</Link>}
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="form-control">
            <span className="label-text text-xs mb-1">Emails per day</span>
            <input type="number" min={1} max={200} className="input input-bordered input-sm" value={form.dailyEmailCap} onChange={(e) => set("dailyEmailCap", e.target.value)} />
          </label>
          <label className="form-control">
            <span className="label-text text-xs mb-1">Minimum fit (0-100)</span>
            <input type="number" min={0} max={100} className="input input-bordered input-sm" value={form.minFitScore} onChange={(e) => set("minFitScore", e.target.value)} />
          </label>
        </div>
      </div>

      <div className="space-y-2">
        <span className="label-text text-xs">Mode</span>
        <div className="grid gap-3 sm:grid-cols-2">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => set("mode", m.value)}
              className={`text-left rounded-xl border-2 p-3 transition-all ${form.mode === m.value ? "border-primary bg-primary/5" : "border-base-300 hover:border-primary/40"}`}
            >
              <p className="font-semibold text-sm">{m.label}</p>
              <p className="text-xs text-base-content/60">{m.hint}</p>
            </button>
          ))}
        </div>
        <ul className="text-xs text-base-content/70 flex flex-wrap gap-x-4 gap-y-1">
          <li className="flex items-center gap-1"><Check className="h-3 w-3 text-success" /> Finds, researches, scores and writes on its own</li>
          {outreachPolicy.map((p) => (
            <li key={p.action} className="flex items-center gap-1">
              {p.route === "ask" ? <Hand className="h-3 w-3 text-warning" /> : <Check className="h-3 w-3 text-success" />}
              {p.label}: {p.route === "ask" ? "asks you" : "automatic"}
            </li>
          ))}
          <li className="flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-warning" /> Always asks when there&apos;s no address, the fit is borderline or the lead was contacted before</li>
          <li className="flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-warning" /> Always asks before answering when the knowledge base doesn&apos;t cover it, the client is unhappy, or it&apos;s about discounts or contract terms</li>
        </ul>
      </div>

      <div className="rounded-lg border border-base-300 p-3 space-y-3">
        <label className={`flex items-center gap-2 text-sm ${takesIndeed ? "cursor-pointer" : "opacity-50"}`}>
          <input type="checkbox" className="checkbox checkbox-sm" disabled={!takesIndeed} checked={form.searchOn && takesIndeed} onChange={(e) => set("searchOn", e.target.checked)} />
          <Search className="h-4 w-4" /> Find new companies on Indeed first
          {!takesIndeed && <span className="text-xs">(this campaign doesn&apos;t take Indeed leads)</span>}
        </label>
        {form.searchOn && takesIndeed && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <input className="input input-bordered input-sm" placeholder="Job title, e.g. React developer" value={form.search.query} onChange={(e) => setSearch("query", e.target.value)} />
            <input className="input input-bordered input-sm" placeholder="City, e.g. Lahore" value={form.search.location} onChange={(e) => setSearch("location", e.target.value)} />
            <select className="select select-bordered select-sm" value={form.search.hoursOld} onChange={(e) => setSearch("hoursOld", e.target.value)}>
              <option value="">Posted any time</option>
              <option value="24">Last 24 hours</option>
              <option value="72">Last 3 days</option>
              <option value="168">Last 7 days</option>
              <option value="720">Last 30 days</option>
            </select>
            <input type="number" min={1} max={100} className="input input-bordered input-sm" title="How many job posts" value={form.search.limit} onChange={(e) => setSearch("limit", e.target.value)} />
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" className="checkbox checkbox-xs" checked={form.repeatSearch} onChange={(e) => set("repeatSearch", e.target.checked)} /> Search again every day
            </label>
          </div>
        )}
      </div>

      <label className="form-control max-w-md">
        <span className="label-text text-xs mb-1">LinkedIn account (for LinkedIn leads; not tested yet)</span>
        <select className="select select-bordered select-sm" value={form.accountId} onChange={(e) => set("accountId", e.target.value)}>
          <option value="">None: companies are emailed, LinkedIn people wait</option>
          {accounts.map((a) => (
            <option key={a.dbId || a.id} value={a.dbId || a.id}>{a.name || a.email}</option>
          ))}
        </select>
      </label>

      <div className="flex justify-end">
        <button type="submit" className="btn btn-primary btn-sm gap-2" disabled={starting || !form.campaignId}>
          {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Start agent
        </button>
      </div>
    </form>
  );
}
