"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  AlertTriangle, Briefcase, Building2, ExternalLink, Globe, Linkedin, Loader2, Mail, Merge, Phone, Search, UserRound,
} from "lucide-react";
import { companyNameOf, findDuplicateCompanies, jobsOf } from "@/libs/sales/companies";

const STATUS = {
  done: { label: "Researched", cls: "badge-success" },
  partial: { label: "Website only", cls: "badge-warning" },
  not_found: { label: "Nothing found", cls: "badge-error" },
};

const ROLE_LABEL = { leadership: "Leadership", hiring: "Hiring", other: "Staff" };

function CompanyCard({ lead, busy, onResearch }) {
  const research = lead.sourceData?.research;
  const jobs = jobsOf(lead);
  const known = lead.sourceData?.company || {};
  const status = research ? STATUS[research.status] : null;

  return (
    <article className="rounded-xl border border-base-300 bg-base-100 p-4 space-y-3">
      <header className="flex flex-wrap items-start gap-3">
        <div className="h-10 w-10 rounded-lg bg-base-200 flex items-center justify-center shrink-0">
          {known.logo ? (
            // Logos come from many hosts (Indeed's CDN and others), so next/image's host allow-list doesn't fit
            // eslint-disable-next-line @next/next/no-img-element
            <img src={known.logo} alt="" className="h-10 w-10 rounded-lg object-cover" />
          ) : (
            <Building2 className="h-5 w-5 opacity-50" />
          )}
        </div>
        <div className="flex-1 min-w-[12rem]">
          <h3 className="font-semibold">{companyNameOf(lead) || "Unknown company"}</h3>
          <p className="text-xs text-base-content/60">
            {[known.industry, known.employees && `${known.employees} staff`, research?.title && !known.industry ? research.title : null].filter(Boolean).join(" · ") || "No company details yet"}
          </p>
        </div>
        {status && <span className={`badge badge-sm ${status.cls}`}>{status.label}</span>}
        <button className="btn btn-sm btn-outline gap-1 !normal-case" disabled={busy} onClick={() => onResearch(lead)}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {research ? "Research again" : "Research"}
        </button>
      </header>

      <div className="flex flex-wrap gap-1.5">
        <span className="text-xs text-base-content/60 flex items-center gap-1 mr-1">
          <Briefcase className="h-3.5 w-3.5" /> Hiring for {jobs.length}:
        </span>
        {jobs.slice(0, 6).map((job) => (
          <a key={job.url} href={job.url} target="_blank" rel="noopener noreferrer" className="badge badge-ghost badge-sm hover:badge-primary">
            {job.title || "Job post"}
          </a>
        ))}
        {jobs.length > 6 && <span className="badge badge-ghost badge-sm">+{jobs.length - 6} more</span>}
      </div>

      {research && (
        <div className="grid gap-3 md:grid-cols-2 text-sm">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-base-content/50">Company</p>
            {research.website ? (
              <a href={research.website} target="_blank" rel="noopener noreferrer" className="link link-primary flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5" /> {research.website.replace(/^https?:\/\//, "")}
                <span className="text-xs text-base-content/40 no-underline">({research.websiteSource})</span>
              </a>
            ) : (
              <p className="text-base-content/50 flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" /> No website found</p>
            )}
            {research.website && research.websiteConfirmed === false && (
              <p className="flex items-start gap-1.5 rounded-md bg-warning/15 px-2 py-1 text-xs text-warning-content">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                Check this is the company&apos;s website: nothing on it points to Pakistan. The agent asks you before emailing it.
              </p>
            )}
            {research.emailSource === "web search" && research.emails.length > 0 && (
              <p className="text-xs text-base-content/50">Emails found on the web (not on their website)</p>
            )}
            {research.emails.map((email) => (
              <a key={email} href={`mailto:${email}`} className="flex items-center gap-1.5 hover:text-primary">
                <Mail className="h-3.5 w-3.5" /> {email}
              </a>
            ))}
            {research.phones.map((phone) => (
              <p key={phone} className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" /> {phone}</p>
            ))}
            {research.socials?.linkedin && (
              <a href={research.socials.linkedin} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 hover:text-primary">
                <Linkedin className="h-3.5 w-3.5" /> Company page
              </a>
            )}
            {research.description && <p className="text-xs text-base-content/60 line-clamp-3">{research.description}</p>}
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-base-content/50">Who to contact</p>
            {research.decisionMakers.length === 0 && research.contacts.length === 0 && (
              <p className="text-base-content/50 text-xs">Nobody found yet.</p>
            )}
            {research.decisionMakers.map((person) => (
              <a key={person.linkedinUrl} href={person.linkedinUrl} target="_blank" rel="noopener noreferrer" className="flex items-start gap-1.5 hover:text-primary">
                <UserRound className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  <span className="font-medium">{person.name}</span>{" "}
                  <span className="badge badge-outline badge-xs align-middle">{ROLE_LABEL[person.role]}</span>
                  <span className="block text-xs text-base-content/60">{person.title}</span>
                </span>
              </a>
            ))}
            {research.contacts.map((c) => (
              <a key={c.email} href={`mailto:${c.email}`} className="flex items-start gap-1.5 hover:text-primary">
                <Mail className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  <span className="font-medium">{c.name || c.email}</span>
                  <span className="block text-xs text-base-content/60">{[c.title, c.name ? c.email : null].filter(Boolean).join(" · ")}</span>
                </span>
              </a>
            ))}
          </div>

          {research.notes?.length > 0 && (
            <ul className="md:col-span-2 text-xs text-base-content/50 list-disc pl-4">
              {research.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}

/** Research step for company leads (Rozee.pk, Indeed). */
export default function CompanyResearch({ campaignId, platform }) {
  const [leads, setLeads] = useState(null);
  const [status, setStatus] = useState(null);
  const [busyIds, setBusyIds] = useState(new Set());
  const [batch, setBatch] = useState(null); // { done, total } while "Research all" runs
  const [merging, setMerging] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/campaigns/${campaignId}/leads`);
    const data = await res.json();
    setLeads((data.leads || []).filter((l) => l.source === platform));
  }, [campaignId, platform]);

  useEffect(() => {
    setLeads(null);
    load().catch(() => setLeads([]));
  }, [load]);

  useEffect(() => {
    fetch("/api/sales/research/status").then((r) => r.json()).then(setStatus).catch(() => {});
  }, []);

  const duplicates = useMemo(() => (leads ? findDuplicateCompanies(leads) : []), [leads]);
  const duplicateCount = duplicates.reduce((n, d) => n + d.merge.length, 0);
  const researched = leads ? leads.filter((l) => l.sourceData?.research).length : 0;

  const setBusy = (id, on) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const researchOne = async (lead, { quiet = false } = {}) => {
    setBusy(lead.id, true);
    try {
      const res = await fetch(`/api/sales/companies/${lead.id}/research`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Research failed");
      setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, sourceData: data.lead.sourceData } : l)));
      if (!quiet) toast.success(`${companyNameOf(lead)} researched`);
    } catch (err) {
      if (!quiet) toast.error(err.message);
    } finally {
      setBusy(lead.id, false);
    }
  };

  const runResearch = async (todo, doneText) => {
    if (!todo.length) return;
    // Free search blocks quickly, so go one at a time without a search key
    const parallel = status?.searchProvider === "serper" ? 3 : 1;
    setBatch({ done: 0, total: todo.length });
    const queue = [...todo];
    const worker = async () => {
      while (queue.length) {
        const lead = queue.shift();
        await researchOne(lead, { quiet: true });
        setBatch((b) => b && { ...b, done: b.done + 1 });
      }
    };
    await Promise.all(Array.from({ length: parallel }, worker));
    setBatch(null);
    toast.success(doneText);
  };
  const researchAll = () => runResearch(leads.filter((l) => !l.sourceData?.research && companyNameOf(l)), "Research finished");
  // Researched before the wider email search existed (more pages, "@domain" on the web): look again
  const missingEmail = (leads || []).filter((l) => l.sourceData?.research && !l.sourceData.research.emails?.length && !l.sourceData.research.contacts?.length && companyNameOf(l));
  const onLinkedInOnly = missingEmail.filter((l) => l.sourceData.research.decisionMakers?.length).length;
  const lookAgain = () => runResearch(missingEmail, "Looked again for missing emails");

  const combine = async () => {
    setMerging(true);
    try {
      const res = await fetch("/api/sales/companies/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Combined ${data.merged} job post${data.merged === 1 ? "" : "s"} into their companies`);
      await load();
    } catch (err) {
      toast.error(err.message || "Could not combine");
    } finally {
      setMerging(false);
    }
  };

  if (!leads) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!leads.length) {
    return <p className="text-sm text-base-content/60 rounded-lg border border-dashed border-base-300 p-6 text-center">No companies from this platform yet. Find some in step 2.</p>;
  }

  return (
    <div className="space-y-4">
      {status?.searchProvider === "duckduckgo" && (
        <div role="alert" className="alert alert-warning text-sm items-start">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Using free search, which blocks after a few searches</p>
            <p className="text-xs opacity-80">
              Websites and contact details still work. For reliable website and decision-maker search add a free SERPER_API_KEY (serper.dev, 2,500 searches) to .env.local
              {status.hunter ? "." : ", and optionally HUNTER_API_KEY (hunter.io) for named email contacts."}
            </p>
          </div>
        </div>
      )}

      {duplicateCount > 0 && (
        <div role="status" className="alert text-sm">
          <Merge className="h-4 w-4" />
          <span className="flex-1">
            {duplicateCount} job post{duplicateCount === 1 ? " belongs" : "s belong"} to companies already in this list. Combine them so each company is one lead.
          </span>
          <button className="btn btn-sm" onClick={combine} disabled={merging}>
            {merging && <Loader2 className="h-4 w-4 animate-spin" />} Combine
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <p><span className="font-semibold">{researched}</span> of <span className="font-semibold">{leads.length}</span> companies researched</p>
          {missingEmail.length > 0 && (
            <p className="text-xs text-base-content/60">
              {missingEmail.length} without an email: {onLinkedInOnly} can be reached on LinkedIn (decision-maker found), {missingEmail.length - onLinkedInOnly} need a contact
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {missingEmail.length > 0 && (
            <button className="btn btn-outline btn-sm gap-2" onClick={lookAgain} disabled={Boolean(batch)} title="Reads more of their website and searches the web for addresses on their domain">
              <Mail className="h-4 w-4" /> Look again for {missingEmail.length} missing email{missingEmail.length === 1 ? "" : "s"}
            </button>
          )}
          <button className="btn btn-primary btn-sm gap-2" onClick={researchAll} disabled={Boolean(batch) || researched === leads.length}>
            {batch ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {batch ? `Researching ${batch.done} of ${batch.total}…` : "Research the rest"}
          </button>
        </div>
      </div>
      {batch && <progress className="progress progress-primary w-full" value={batch.done} max={batch.total} />}

      <div className="space-y-3">
        {leads.map((lead) => (
          <CompanyCard key={lead.id} lead={lead} busy={busyIds.has(lead.id)} onResearch={researchOne} />
        ))}
      </div>

      <p className="text-xs text-base-content/50 flex items-center gap-1">
        <ExternalLink className="h-3 w-3" /> Job titles open the original job post.
      </p>
    </div>
  );
}
