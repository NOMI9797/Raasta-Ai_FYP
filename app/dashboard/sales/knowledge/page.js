"use client";

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, BookOpen, FileText, Globe, Loader2, PenLine, Pencil, Sparkles, Trash2, X } from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";
import AddKnowledge from "@/components/sales/knowledge/AddKnowledge";
import AskKnowledge from "@/components/sales/knowledge/AskKnowledge";
import { useDialog } from "@/components/ui/DialogProvider";
import { KB_CATEGORIES } from "@/libs/sales/knowledge/categories";

const KIND_ICON = { note: PenLine, file: FileText, web: Globe };

function EditDocument({ doc, onClose, onSaved }) {
  const [draft, setDraft] = useState({ title: doc.title, category: doc.category, content: doc.content });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/sales/knowledge/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save");
      toast.success("Saved");
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog className="modal modal-open">
      <div className="modal-box max-w-3xl space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Edit entry</h3>
          <button className="btn btn-ghost btn-sm btn-circle" onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <input className="input input-bordered input-sm" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <select className="select select-bordered select-sm" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
            {KB_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
        <textarea className="textarea textarea-bordered w-full text-sm leading-relaxed min-h-[22rem]" value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
        <div className="modal-action mt-0">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </dialog>
  );
}

function DocumentCard({ doc, onEdit, onDelete }) {
  const Icon = KIND_ICON[doc.kind] || PenLine;
  return (
    <article className="rounded-lg border border-base-300 bg-base-100 p-3 space-y-1.5">
      <header className="flex items-start gap-2">
        <Icon className="h-4 w-4 mt-0.5 opacity-50 shrink-0" />
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm truncate">{doc.title}</h4>
          <p className="text-xs text-base-content/50 truncate">
            {doc.chunkCount} passage{doc.chunkCount === 1 ? "" : "s"}
            {doc.source && ` · ${doc.source}`}
            {doc.isSample && " · sample"}
          </p>
        </div>
        <button className="btn btn-ghost btn-xs btn-square" title="Edit" onClick={() => onEdit(doc)}><Pencil className="h-3.5 w-3.5" /></button>
        <button className="btn btn-ghost btn-xs btn-square" title="Remove" onClick={() => onDelete(doc)}><Trash2 className="h-3.5 w-3.5" /></button>
      </header>
      {doc.status === "failed" && (
        <p className="text-xs text-error flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Not searchable: {doc.error}. Open and save it to try again.</p>
      )}
      <p className="text-xs text-base-content/70 line-clamp-3 whitespace-pre-line">{doc.content}</p>
    </article>
  );
}

export default function KnowledgeBasePage() {
  const { confirm } = useDialog();
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
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

  const docs = data?.documents || [];
  const stats = data?.stats || {};
  const grouped = KB_CATEGORIES.map((c) => ({ ...c, docs: docs.filter((d) => d.category === c.key) })).filter((g) => g.docs.length);

  return (
    <DashboardShell title="Knowledge base" activeSection="sales-knowledge">
      <div className="p-4 md:p-6 space-y-5 max-w-6xl">
        <header>
          <h1 className="text-2xl font-bold flex items-center gap-2"><BookOpen className="h-6 w-6 text-primary" /> Knowledge base</h1>
          <p className="text-sm text-base-content/70 mt-1 max-w-3xl">
            What the sales agent knows about your company. When a client replies with a question, the agent finds the relevant passages here and answers only from them.
            If the answer isn&apos;t here, it asks you instead of guessing.
          </p>
        </header>

        {!data ? (
          <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
        ) : (
          <>
            {stats.samples > 0 && (
              <div className="alert alert-info text-sm">
                <Sparkles className="h-4 w-4" />
                <span className="flex-1">Sample data is loaded: a made-up software house, for testing. Replace it with your real company information before going live.</span>
                <button className="btn btn-sm btn-ghost" disabled={sampleBusy} onClick={() => sample("DELETE")}>Remove sample data</button>
              </div>
            )}

            <div className="grid gap-5 lg:grid-cols-[1fr_24rem] items-start">
              <div className="space-y-5 min-w-0">
                <AddKnowledge onAdded={load} />

                {docs.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-base-300 p-8 text-center space-y-3">
                    <BookOpen className="h-8 w-8 mx-auto opacity-40" />
                    <div>
                      <p className="font-semibold">Nothing here yet</p>
                      <p className="text-sm text-base-content/60">Add your services, pricing, process and common questions, or load sample data to try the agent first.</p>
                    </div>
                    <button className="btn btn-outline btn-sm gap-1" disabled={sampleBusy} onClick={() => sample("POST")}>
                      {sampleBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Load sample data
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-base-content/60">{stats.documents} entr{stats.documents === 1 ? "y" : "ies"}, {stats.chunks} searchable passages</p>
                    {grouped.map((g) => (
                      <section key={g.key} className="space-y-2">
                        <h3 className="text-sm font-semibold">{g.label} <span className="font-normal text-base-content/50">({g.docs.length})</span></h3>
                        <div className="grid gap-2 md:grid-cols-2">
                          {g.docs.map((d) => <DocumentCard key={d.id} doc={d} onEdit={setEditing} onDelete={remove} />)}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </div>

              <div className="lg:sticky lg:top-4">
                <AskKnowledge disabled={docs.length === 0} />
              </div>
            </div>
          </>
        )}
      </div>
      {editing && <EditDocument doc={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </DashboardShell>
  );
}

