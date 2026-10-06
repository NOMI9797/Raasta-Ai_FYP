"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  AlertTriangle, BookOpen, CheckCircle2, CircleDashed, Clock, FileText, Globe, Layers, Loader2, PenLine, Pencil, Plus, Search, Sparkles, Trash2, X,
} from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";
import AddKnowledge from "@/components/sales/knowledge/AddKnowledge";
import AskKnowledge from "@/components/sales/knowledge/AskKnowledge";
import { useDialog } from "@/components/ui/DialogProvider";
import { KB_CATEGORIES, categoryLabel } from "@/libs/sales/knowledge/categories";

const KIND = {
  note: { icon: PenLine, label: "Written" },
  file: { icon: FileText, label: "File" },
  web: { icon: Globe, label: "Web page" },
};
// What the agent can't do when a category is empty
const MISSING_HINT = {
  services: "The agent can't say what you offer.",
  pricing: "Price questions go to you.",
  process: "It can't explain how projects run.",
  faq: "Common questions go to you.",
  case_study: "It has no past work to mention.",
  about: "It can't say who you are.",
};

const ago = (d) => {
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return new Date(d).toLocaleDateString([], { day: "numeric", month: "short" });
};

function Modal({ title, onClose, children, wide = false }) {
  return (
    <dialog className="modal modal-open">
      <div className={`modal-box p-0 ${wide ? "max-w-4xl" : "max-w-3xl"}`}>
        <header className="flex items-center justify-between border-b border-base-300 px-5 py-3">
          <h3 className="font-semibold">{title}</h3>
          <button className="btn btn-ghost btn-sm btn-circle" onClick={onClose}><X className="h-4 w-4" /></button>
        </header>
        <div className="p-5">{children}</div>
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </dialog>
  );
}

function EditDocument({ doc, onClose, onSaved }) {
  const [draft, setDraft] = useState({ title: doc.title, category: doc.category, content: doc.content });
  const [busy, setBusy] = useState(false);
  const dirty = draft.title !== doc.title || draft.category !== doc.category || draft.content !== doc.content;

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/sales/knowledge/${doc.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save");
      toast.success(`Saved (${data.document.chunkCount} passages)`);
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Edit entry" onClose={onClose} wide>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_13rem]">
          <label className="form-control">
            <span className="label-text mb-1 text-xs">Title</span>
            <input className="input input-bordered input-sm" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </label>
          <label className="form-control">
            <span className="label-text mb-1 text-xs">Category</span>
            <select className="select select-bordered select-sm" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
              {KB_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
        </div>
        <textarea className="textarea textarea-bordered min-h-[24rem] w-full font-mono text-[13px] leading-relaxed" value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-base-content/55">{doc.source ? `From ${doc.source} · ` : ""}{draft.content.length.toLocaleString()} characters. Saving makes it searchable again.</p>
          <div className="flex gap-2">
            <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary btn-sm" disabled={busy || !dirty} onClick={save}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save changes"}</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Stat({ icon: Icon, label, value, sub, tone = "" }) {
  return (
    <div className="rounded-xl border border-base-300 bg-base-100 px-4 py-3 shadow-sm">
      <p className="flex items-center gap-1.5 text-xs font-medium text-base-content/55"><Icon className="h-3.5 w-3.5" /> {label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-base-content/50">{sub}</p>}
    </div>
  );
}

function DocumentRow({ doc, onOpen, onDelete }) {
  const kind = KIND[doc.kind] || KIND.note;
  return (
    <li className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-base-200/50">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-base-200 text-base-content/60"><kind.icon className="h-4 w-4" /></span>
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(doc)}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium group-hover:text-primary">{doc.title}</span>
          <span className="rounded bg-base-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-base-content/60">{categoryLabel(doc.category)}</span>
          {doc.isSample && <span className="rounded bg-info/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-info">Sample</span>}
          {doc.status === "failed" && <span className="inline-flex items-center gap-1 rounded bg-error/10 px-1.5 py-0.5 text-[10px] font-medium text-error"><AlertTriangle className="h-3 w-3" /> Not searchable</span>}
        </div>
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-base-content/60">{doc.content.replace(/^#+\s*/gm, "").replace(/\s+/g, " ")}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-base-content/45">
          <span>{kind.label}{doc.source ? ` · ${doc.source}` : ""}</span>
          <span>{doc.chunkCount} passage{doc.chunkCount === 1 ? "" : "s"}</span>
          <span>Updated {ago(doc.updatedAt)}</span>
        </p>
      </button>
      <div className="flex shrink-0 gap-0.5 opacity-60 group-hover:opacity-100">
        <button className="btn btn-ghost btn-xs btn-square" title="Edit" onClick={() => onOpen(doc)}><Pencil className="h-3.5 w-3.5" /></button>
        <button className="btn btn-ghost btn-xs btn-square hover:text-error" title="Remove" onClick={() => onDelete(doc)}><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
    </li>
  );
}

export default function KnowledgeBasePage() {
  const { confirm } = useDialog();
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [sampleBusy, setSampleBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/sales/knowledge");
    const json = await res.json();
    if (res.ok) setData(json);
    else toast.error(json.error || "Could not load the knowledge base");
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (doc) => {
    const ok = await confirm({ title: `Remove "${doc.title}"?`, message: "The agent will no longer use this information.", confirmText: "Remove", tone: "warning" });
    if (!ok) return;
    const res = await fetch(`/api/sales/knowledge/${doc.id}`, { method: "DELETE" });
    if (res.ok) load();
    else toast.error("Could not remove it");
  };

  const sample = async (method) => {
    if (method === "DELETE") {
      const ok = await confirm({ title: "Remove the sample data?", message: "Sample entries you haven't edited are removed. Entries you edited are kept as your own.", confirmText: "Remove", tone: "warning" });
      if (!ok) return;
    }
    setSampleBusy(true);
    try {
      const res = await fetch("/api/sales/knowledge/sample", { method });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast.success(method === "POST" ? `Loaded ${json.added} sample entries` : `Removed ${json.removed} sample entries`);
      await load();
    } catch (err) {
      toast.error(err.message || "Failed");
    } finally {
      setSampleBusy(false);
    }
  };

  const docs = useMemo(() => data?.documents || [], [data]);
  const stats = data?.stats || {};
  const countBy = useMemo(() => Object.fromEntries(KB_CATEGORIES.map((c) => [c.key, docs.filter((d) => d.category === c.key).length])), [docs]);
  const covered = KB_CATEGORIES.filter((c) => c.key !== "other" && countBy[c.key] > 0).length;
  const coreTotal = KB_CATEGORIES.filter((c) => c.key !== "other").length;
  const lastUpdate = docs.reduce((latest, d) => (!latest || new Date(d.updatedAt) > new Date(latest) ? d.updatedAt : latest), null);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs
      .filter((d) => category === "all" || d.category === category)
      .filter((d) => !q || d.title.toLowerCase().includes(q) || d.content.toLowerCase().includes(q));
  }, [docs, category, query]);

  return (
    <DashboardShell title="Knowledge base" activeSection="sales-knowledge">
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><BookOpen className="h-6 w-6" /></span>
            <div>
              <h1 className="text-2xl font-bold leading-tight">Knowledge base</h1>
              <p className="max-w-2xl text-sm text-base-content/60">What the sales agent knows about your company. It answers clients only from this, and asks you when the answer isn&apos;t here.</p>
            </div>
          </div>
          <button className="btn btn-primary btn-sm gap-1" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add information</button>
        </header>

        {!data ? (
          <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
        ) : docs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-base-300 bg-base-100 p-12 text-center">
            <BookOpen className="mx-auto h-10 w-10 opacity-30" />
            <p className="mt-3 text-lg font-semibold">Teach the agent about your company</p>
            <p className="mx-auto mt-1 max-w-lg text-sm text-base-content/60">Add your services, pricing, process, FAQs and past work. Write it, upload a PDF or Word file, or copy a page of your website.</p>
            <div className="mt-5 flex justify-center gap-2">
              <button className="btn btn-primary btn-sm gap-1" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add information</button>
              <button className="btn btn-outline btn-sm gap-1" disabled={sampleBusy} onClick={() => sample("POST")}>
                {sampleBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Try with sample data
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat icon={FileText} label="Entries" value={stats.documents} sub={stats.samples ? `${stats.samples} sample` : "your own"} />
              <Stat icon={Layers} label="Searchable passages" value={stats.chunks} sub="what the agent searches" />
              <Stat icon={CheckCircle2} label="Topics covered" value={`${covered} / ${coreTotal}`} sub={covered < coreTotal ? `${coreTotal - covered} missing` : "all covered"} tone={covered < coreTotal ? "text-warning" : "text-success"} />
              <Stat icon={Clock} label="Last updated" value={lastUpdate ? ago(lastUpdate) : "—"} />
            </div>

            {stats.samples > 0 && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-info/30 bg-info/5 px-4 py-2.5 text-sm">
                <Sparkles className="h-4 w-4 text-info" />
                <span className="flex-1">You&apos;re using <span className="font-medium">sample data</span> for a made-up software house. Replace it with your real company information before going live.</span>
                <button className="btn btn-ghost btn-xs" disabled={sampleBusy} onClick={() => sample("DELETE")}>Remove sample data</button>
              </div>
            )}

            <div className="grid items-start gap-5 lg:grid-cols-[13rem_1fr] xl:grid-cols-[13rem_1fr_22rem]">
              {/* Categories */}
              <nav className="rounded-xl border border-base-300 bg-base-100 p-2 shadow-sm lg:sticky lg:top-4">
                <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-base-content/45">Topics</p>
                {[{ key: "all", label: "All entries" }, ...KB_CATEGORIES].map((c) => {
                  const n = c.key === "all" ? docs.length : countBy[c.key];
                  const missing = c.key !== "all" && c.key !== "other" && !n;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setCategory(c.key)}
                      title={missing ? MISSING_HINT[c.key] : c.hint || ""}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${category === c.key ? "bg-primary/10 font-medium text-primary" : "hover:bg-base-200"}`}
                    >
                      {missing ? <CircleDashed className="h-3.5 w-3.5 text-warning" /> : <span className="h-3.5 w-3.5" />}
                      <span className="flex-1 truncate">{c.label}</span>
                      <span className={`text-xs tabular-nums ${missing ? "text-warning" : "text-base-content/45"}`}>{missing ? "missing" : n}</span>
                    </button>
                  );
                })}
              </nav>

              {/* Entries */}
              <section className="min-w-0 overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-sm">
                <header className="flex flex-wrap items-center gap-3 border-b border-base-300 px-4 py-3">
                  <h2 className="text-sm font-semibold">{category === "all" ? "All entries" : categoryLabel(category)}</h2>
                  <span className="rounded-full bg-base-200 px-2 py-0.5 text-xs tabular-nums text-base-content/70">{shown.length}</span>
                  <span className="flex-1" />
                  <label className="input input-bordered input-sm flex w-full items-center gap-2 sm:w-60">
                    <Search className="h-3.5 w-3.5 opacity-50" />
                    <input className="grow" placeholder="Search entries" value={query} onChange={(e) => setQuery(e.target.value)} />
                  </label>
                </header>
                {shown.length === 0 ? (
                  <div className="px-6 py-10 text-center">
                    <CircleDashed className="mx-auto h-7 w-7 text-warning" />
                    <p className="mt-2 text-sm font-medium">{query ? "No entry matches" : `Nothing about ${categoryLabel(category).toLowerCase()} yet`}</p>
                    {!query && MISSING_HINT[category] && <p className="text-xs text-base-content/55">{MISSING_HINT[category]}</p>}
                    {!query && <button className="btn btn-outline btn-xs mt-3 gap-1" onClick={() => setAdding(true)}><Plus className="h-3 w-3" /> Add it</button>}
                  </div>
                ) : (
                  <ul className="divide-y divide-base-200">
                    {shown.map((d) => <DocumentRow key={d.id} doc={d} onOpen={setEditing} onDelete={remove} />)}
                  </ul>
                )}
              </section>

              {/* Ask */}
              <div className="lg:col-span-2 xl:sticky xl:top-4 xl:col-span-1">
                <AskKnowledge disabled={docs.length === 0} />
              </div>
            </div>
          </>
        )}
      </div>

      {adding && (
        <Modal title="Add information" onClose={() => setAdding(false)}>
          <AddKnowledge bare defaultCategory={category !== "all" ? category : undefined} onAdded={() => { setAdding(false); load(); }} />
        </Modal>
      )}
      {editing && <EditDocument doc={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </DashboardShell>
  );
}
