"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, CheckCircle2, Loader2, MessageCircleQuestion, Send } from "lucide-react";
import { categoryLabel } from "@/libs/sales/knowledge/categories";

const EXAMPLES = ["How much does a mobile app cost?", "Can you sign an NDA?", "How fast can a developer start?", "Do you build with Flutter?"];

/** Try the knowledge base: the answer the agent would give, and the passages it came from. */
export default function AskKnowledge({ disabled }) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const ask = async (q = question) => {
    if (!q.trim()) return;
    setQuestion(q);
    setBusy(true);
    try {
      const res = await fetch("/api/sales/knowledge/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not answer");
      setResult(data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-base-300 bg-base-100 p-4 space-y-3">
      <div>
        <h2 className="font-semibold flex items-center gap-2"><MessageCircleQuestion className="h-4 w-4 text-primary" /> Ask the knowledge base</h2>
        <p className="text-xs text-base-content/60 mt-0.5">Ask what a client might ask, and see what the agent would answer.</p>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="join w-full">
        <input className="input input-bordered input-sm join-item flex-1" placeholder="e.g. What do you charge for a website?" value={question} onChange={(e) => setQuestion(e.target.value)} disabled={disabled} />
        <button type="submit" className="btn btn-primary btn-sm join-item" disabled={busy || disabled || !question.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>
      {!result && (
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((q) => (
            <button key={q} type="button" className="badge badge-ghost badge-sm cursor-pointer hover:badge-primary" disabled={busy || disabled} onClick={() => ask(q)}>{q}</button>
          ))}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <div className={`rounded-lg p-3 text-sm ${result.covered ? "bg-success/10" : "bg-warning/10"}`}>
            <p className="flex items-center gap-1.5 text-xs font-semibold mb-1">
              {result.covered ? <><CheckCircle2 className="h-3.5 w-3.5 text-success" /> Answered from the knowledge base</> : <><AlertTriangle className="h-3.5 w-3.5 text-warning" /> Not covered: the agent would ask you before replying</>}
            </p>
            <p className="whitespace-pre-line">{result.answer}</p>
          </div>
          {result.passages?.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-base-content/60">Passages found</p>
              {result.passages.map((p, i) => {
                const used = result.sources.includes(i + 1);
                return (
                  <details key={p.id} className={`rounded-lg border text-xs ${used ? "border-primary/40 bg-primary/5" : "border-base-300"}`}>
                    <summary className="cursor-pointer px-2.5 py-1.5 flex items-center gap-2">
                      <span className="font-mono opacity-60">[{i + 1}]</span>
                      <span className="flex-1 truncate">{p.title}</span>
                      <span className="badge badge-ghost badge-xs">{categoryLabel(p.category)}</span>
                      <span className="opacity-60" title="How close in meaning (0-1)">{p.similarity.toFixed(2)}</span>
                      {used && <span className="badge badge-primary badge-xs">used</span>}
                    </summary>
                    <p className="px-2.5 pb-2 whitespace-pre-line text-base-content/80">{p.content}</p>
                  </details>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
