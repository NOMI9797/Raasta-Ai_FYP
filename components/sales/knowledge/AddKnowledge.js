"use client";

import { useRef, useState } from "react";
import toast from "react-hot-toast";
import { FileUp, Globe, Loader2, PenLine, Plus } from "lucide-react";
import { KB_CATEGORIES } from "@/libs/sales/knowledge/categories";

const TABS = [
  { key: "note", label: "Write", icon: PenLine },
  { key: "file", label: "Upload a file", icon: FileUp },
  { key: "web", label: "From a web page", icon: Globe },
];

/** Add to the knowledge base: a written entry, a file, or a web page. */
export default function AddKnowledge({ onAdded, bare = false, defaultCategory }) {
  const [tab, setTab] = useState("note");
  const [category, setCategory] = useState(defaultCategory || "services");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const hint = KB_CATEGORIES.find((c) => c.key === category)?.hint;

  const reset = () => {
    setTitle("");
    setContent("");
    setUrl("");
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      let res;
      if (tab === "note") {
        res = await fetch("/api/sales/knowledge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, category, content }),
        });
      } else if (tab === "file") {
        const form = new FormData();
        form.append("file", file);
        form.append("category", category);
        if (title.trim()) form.append("title", title);
        res = await fetch("/api/sales/knowledge/upload", { method: "POST", body: form });
      } else {
        res = await fetch("/api/sales/knowledge/web", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, category, title }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not add it");
      toast.success(`Added "${data.document.title}" (${data.document.chunkCount} passage${data.document.chunkCount === 1 ? "" : "s"})`);
      reset();
      onAdded?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const ready = tab === "note" ? title.trim() && content.trim().length >= 20 : tab === "file" ? Boolean(file) : url.trim();

  return (
    <form onSubmit={submit} className={bare ? "space-y-4" : "rounded-xl border border-base-300 bg-base-100 p-4 space-y-3"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {bare ? <p className="text-sm text-base-content/60">How do you want to add it?</p> : <h2 className="font-semibold flex items-center gap-2"><Plus className="h-4 w-4" /> Add information</h2>}
        <div role="tablist" className="tabs tabs-boxed tabs-sm">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" className={`tab gap-1 ${tab === t.key ? "tab-active" : ""}`} onClick={() => setTab(t.key)}>
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="form-control">
          <span className="label-text text-xs mb-1">Category</span>
          <select className="select select-bordered select-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
            {KB_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          {hint && <span className="text-xs text-base-content/50 mt-1">{hint}</span>}
        </label>
        <label className="form-control">
          <span className="label-text text-xs mb-1">Title{tab !== "note" && " (optional)"}</span>
          <input className="input input-bordered input-sm" placeholder={tab === "note" ? "e.g. Mobile app pricing" : "Taken from the file or page if empty"} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
      </div>

      {tab === "note" && (
        <textarea
          className={`textarea textarea-bordered w-full text-sm ${bare ? "min-h-[16rem]" : "min-h-[9rem]"}`}
          placeholder={"Write it the way you'd explain it to a client. Headings on their own line help, e.g.\n\n## Mobile apps\nWe build iOS and Android apps with Flutter. A typical app takes 8-14 weeks..."}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      )}
      {tab === "file" && (
        <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" className="file-input file-input-bordered file-input-sm w-full" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      )}
      {tab === "web" && (
        <input className="input input-bordered input-sm w-full" placeholder="https://yourcompany.com/services" value={url} onChange={(e) => setUrl(e.target.value)} />
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-base-content/50">
          {tab === "file" ? "PDF, DOCX, TXT or Markdown, up to 10 MB." : tab === "web" ? "One public page; its text is copied in, so add it again if the page changes." : "The agent only tells clients what is written here."}
        </p>
        <button type="submit" className="btn btn-primary btn-sm gap-1" disabled={busy || !ready}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {busy ? "Reading and indexing…" : "Add"}
        </button>
      </div>
    </form>
  );
}
