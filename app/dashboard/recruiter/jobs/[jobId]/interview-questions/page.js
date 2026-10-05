"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { useDialog } from "@/components/ui/DialogProvider";
import DashboardShell from "@/components/layout/DashboardShell";
import {
  ArrowLeft, Loader2, Sparkles, Plus, GripVertical, Pencil, Trash2, ChevronDown,
  AlertTriangle, RefreshCw, MessageCircleQuestion, EyeOff,
} from "lucide-react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { getHiringConfig } from "@/libs/hiring/config";

const CATEGORY_BADGE = { technical: "badge-primary", role: "badge-secondary", behavioral: "badge-info" };
const DIFFICULTY_BADGE = { easy: "badge-success", medium: "badge-warning", hard: "badge-error" };
const EMPTY_FORM = { question: "", category: "technical", difficulty: "medium", idealAnswer: "", expectedKeywords: "", scoreWeight: 1 };

function QuestionCard({ question, index, onEdit, onToggle, onDelete, sortable = true }) {
  const [open, setOpen] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: question.id,
    disabled: !sortable,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const missingAnswer = question.isActive && !question.idealAnswer?.trim();

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-base-200 rounded-xl border border-base-300 ${isDragging ? "shadow-lg z-10 relative" : ""} ${question.isActive ? "" : "opacity-60"}`}
    >
      <div className="flex items-start gap-2 p-3">
        {sortable ? (
          <button
            className="btn btn-ghost btn-xs px-1 cursor-grab active:cursor-grabbing mt-0.5"
            aria-label="Drag to reorder"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        ) : (
          <span className="w-6" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            {index != null && <span className="text-xs text-base-content/50 mt-0.5 w-5 shrink-0">{index + 1}.</span>}
            <p className="text-sm font-medium flex-1">{question.question}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-2 ml-7">
            <span className={`badge badge-xs ${CATEGORY_BADGE[question.category] || "badge-ghost"}`}>{question.category}</span>
            <span className={`badge badge-xs badge-outline ${DIFFICULTY_BADGE[question.difficulty] || ""}`}>{question.difficulty}</span>
            <span className="badge badge-xs badge-ghost">weight {question.scoreWeight}</span>
            <span className="badge badge-xs badge-ghost">{question.source === "manual" ? "manual" : "AI"}</span>
            {missingAnswer && (
              <span className="badge badge-xs badge-warning gap-1"><AlertTriangle className="h-3 w-3" />no ideal answer</span>
            )}
            <button className="btn btn-ghost btn-xs gap-1 ml-auto" onClick={() => setOpen((o) => !o)}>
              Ideal answer <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <input
            type="checkbox"
            className="toggle toggle-xs toggle-primary"
            checked={question.isActive}
            onChange={() => onToggle(question)}
            title={question.isActive ? "Active — used in interviews" : "Inactive — not used"}
          />
          <button className="btn btn-ghost btn-xs" onClick={() => onEdit(question)} title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
          <button className="btn btn-ghost btn-xs text-error" onClick={() => onDelete(question)} title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      {open && (
        <div className="border-t border-base-300 px-4 py-3 ml-9 space-y-2">
          <p className="text-sm text-base-content/80 whitespace-pre-wrap">
            {question.idealAnswer || <span className="text-base-content/40">No ideal answer yet.</span>}
          </p>
          <div className="flex flex-wrap gap-1">
            {(question.expectedKeywords || []).map((k) => (
              <span key={k} className="badge badge-sm badge-outline">{k}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function QuestionModal({ initial, onClose, onSave, saving }) {
  const [form, setForm] = useState(initial);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-2xl">
        <h3 className="font-bold text-lg mb-4">{initial.id ? "Edit question" : "Add question"}</h3>
        <div className="space-y-3">
          <label className="form-control">
            <span className="label-text text-xs mb-1">Question</span>
            <textarea className="textarea textarea-bordered" rows={2} value={form.question} onChange={set("question")} />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="form-control">
              <span className="label-text text-xs mb-1">Category</span>
              <select className="select select-bordered select-sm" value={form.category} onChange={set("category")}>
                <option value="technical">Technical</option>
                <option value="role">Role</option>
                <option value="behavioral">Behavioral</option>
              </select>
            </label>
            <label className="form-control">
              <span className="label-text text-xs mb-1">Difficulty</span>
              <select className="select select-bordered select-sm" value={form.difficulty} onChange={set("difficulty")}>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </label>
            <label className="form-control">
              <span className="label-text text-xs mb-1">Score weight (1–5)</span>
              <input type="number" min={1} max={5} className="input input-bordered input-sm" value={form.scoreWeight} onChange={set("scoreWeight")} />
            </label>
          </div>
          <label className="form-control">
            <span className="label-text text-xs mb-1">Ideal answer (used to score answers)</span>
            <textarea className="textarea textarea-bordered" rows={4} value={form.idealAnswer} onChange={set("idealAnswer")} />
          </label>
          <label className="form-control">
            <span className="label-text text-xs mb-1">Expected keywords (comma separated)</span>
            <input className="input input-bordered input-sm" value={form.expectedKeywords} onChange={set("expectedKeywords")} />
          </label>
        </div>
        <div className="modal-action">
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary btn-sm gap-1" onClick={() => onSave(form)} disabled={saving || !form.question.trim()}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
          </button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </div>
  );
}

export default function InterviewQuestionsPage({ params }) {
  const { confirm } = useDialog();
  const { jobId } = params;
  const router = useRouter();
  const [job, setJob] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(null); // "append" | "replace" | null
  const [count, setCount] = useState(8);
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/hiring/jobs/${jobId}/interview-questions`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setJob(data.job);
      setQuestions(data.questions || []);
      return data;
    } catch (err) {
      toast.error(err.message || "Failed to load questions");
      return null;
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    load().then((data) => {
      if (data?.job) setCount(getHiringConfig(data.job).questionCount);
    });
  }, [load]);

  const active = questions.filter((q) => q.isActive);
  const inactive = questions.filter((q) => !q.isActive);
  const missingAnswers = active.filter((q) => !q.idealAnswer?.trim()).length;

  const generate = async (mode) => {
    if (mode === "replace") {
      const ok = await confirm({
        title: "Replace all AI questions?",
        message: "The AI questions are regenerated from scratch. Questions you wrote yourself are kept.",
        confirmText: "Replace",
        tone: "warning",
      });
      if (!ok) return;
    }
    setGenerating(mode);
    try {
      const res = await fetch(`/api/hiring/jobs/${jobId}/interview-questions/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, count: Number(count) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Generated ${data.created} question(s)`);
      await load();
    } catch (err) {
      toast.error(err.message || "Generation failed");
    } finally {
      setGenerating(null);
    }
  };

  const patch = async (question, changes) => {
    const res = await fetch(`/api/hiring/interview-questions/${question.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.details?.join(", ") || data.error);
    return data.question;
  };

  const toggle = async (question) => {
    try {
      const updated = await patch(question, { isActive: !question.isActive });
      setQuestions((qs) => qs.map((q) => (q.id === updated.id ? updated : q)));
    } catch (err) {
      toast.error(err.message || "Failed to update");
    }
  };

  const remove = async (question) => {
    const ok = await confirm({ title: "Delete this question?", message: "Candidates won't be asked it in future interviews.", confirmText: "Delete", tone: "danger" });
    if (!ok) return;
    try {
      const res = await fetch(`/api/hiring/interview-questions/${question.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(data.deleted === "soft" ? "Used in an interview, so it was deactivated instead" : "Question deleted");
      await load();
    } catch (err) {
      toast.error(err.message || "Failed to delete");
    }
  };

  const save = async (form) => {
    setSaving(true);
    const payload = {
      question: form.question,
      category: form.category,
      difficulty: form.difficulty,
      idealAnswer: form.idealAnswer,
      expectedKeywords: form.expectedKeywords.split(",").map((k) => k.trim()).filter(Boolean),
      scoreWeight: Number(form.scoreWeight),
    };
    try {
      if (form.id) {
        const updated = await patch(form, payload);
        setQuestions((qs) => qs.map((q) => (q.id === updated.id ? updated : q)));
        toast.success("Question updated");
      } else {
        const res = await fetch(`/api/hiring/jobs/${jobId}/interview-questions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.details?.join(", ") || data.error);
        setQuestions((qs) => [...qs, data.question]);
        toast.success("Question added");
      }
      setModal(null);
    } catch (err) {
      toast.error(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const onDragEnd = async ({ active: dragged, over }) => {
    if (!over || dragged.id === over.id) return;
    const previous = questions;
    const oldIndex = active.findIndex((q) => q.id === dragged.id);
    const newIndex = active.findIndex((q) => q.id === over.id);
    const reordered = arrayMove(active, oldIndex, newIndex);
    setQuestions([...reordered, ...inactive]);
    try {
      const res = await fetch(`/api/hiring/jobs/${jobId}/interview-questions/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...reordered, ...inactive].map((q) => q.id) }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
    } catch (err) {
      setQuestions(previous);
      toast.error(err.message || "Failed to reorder");
    }
  };

  const openEdit = (q) => setModal({ ...q, expectedKeywords: (q.expectedKeywords || []).join(", ") });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <DashboardShell title="Interview questions" activeSection="recruiter-jobs">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center gap-3">
          <button className="btn btn-ghost btn-sm" onClick={() => router.push(`/dashboard/recruiter/jobs/${jobId}/candidates`)}>
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold truncate flex items-center gap-2">
              <MessageCircleQuestion className="h-5 w-5 text-primary" /> {job?.title || "Job"} — Interview questions
            </h1>
            <p className="text-xs text-base-content/60 mt-0.5">
              {active.length} active question{active.length !== 1 ? "s" : ""}. The Raasta AI Interviewer asks them in this order.
            </p>
          </div>
        </div>

        <div className="bg-base-200 rounded-xl border border-base-300 p-4 flex flex-wrap items-end gap-3">
          <label className="form-control w-24">
            <span className="label-text text-xs mb-1">How many</span>
            <input type="number" min={1} max={15} className="input input-bordered input-sm" value={count} onChange={(e) => setCount(e.target.value)} />
          </label>
          <button className="btn btn-primary btn-sm gap-1" onClick={() => generate("append")} disabled={generating !== null}>
            {generating === "append" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Generate with AI
          </button>
          <button
            className="btn btn-outline btn-sm gap-1"
            onClick={() => generate("replace")}
            disabled={generating !== null || active.length === 0}
            title="Replace AI questions; manual questions are kept"
          >
            {generating === "replace" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Regenerate
          </button>
          <button className="btn btn-ghost btn-sm gap-1 ml-auto" onClick={() => setModal({ ...EMPTY_FORM })}>
            <Plus className="h-4 w-4" /> Add question
          </button>
        </div>

        {missingAnswers > 0 && (
          <div className="alert alert-warning py-2 text-sm">
            <AlertTriangle className="h-4 w-4" />
            <span>
              {missingAnswers} active question{missingAnswers > 1 ? "s have" : " has"} no ideal answer. Answers to {missingAnswers > 1 ? "them" : "it"} can&apos;t be scored properly.
            </span>
          </div>
        )}

        {active.length === 0 ? (
          <div className="text-center py-12 text-base-content/60">
            <MessageCircleQuestion className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>No active questions yet.</p>
            <p className="text-xs mt-1">Generate a bank with AI or add your own questions.</p>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={active.map((q) => q.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {active.map((q, i) => (
                  <QuestionCard key={q.id} question={q} index={i} onEdit={openEdit} onToggle={toggle} onDelete={remove} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        {inactive.length > 0 && (
          <div>
            <button className="btn btn-ghost btn-xs gap-1" onClick={() => setShowInactive((s) => !s)}>
              <EyeOff className="h-3.5 w-3.5" /> {showInactive ? "Hide" : "Show"} inactive ({inactive.length})
            </button>
            {showInactive && (
              <DndContext sensors={sensors}>
                <SortableContext items={inactive.map((q) => q.id)}>
                  <div className="space-y-2 mt-2">
                    {inactive.map((q) => (
                      <QuestionCard key={q.id} question={q} sortable={false} onEdit={openEdit} onToggle={toggle} onDelete={remove} />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        )}
      </div>

      {modal && <QuestionModal initial={modal} onClose={() => setModal(null)} onSave={save} saving={saving} />}
    </DashboardShell>
  );
}
