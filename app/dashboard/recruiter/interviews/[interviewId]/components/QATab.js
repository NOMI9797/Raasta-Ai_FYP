"use client";

import { MessageSquare } from "lucide-react";
import ScoreBadge from "../../../components/ScoreBadge";

const CATEGORY_BADGE = { technical: "badge-primary", role: "badge-secondary", behavioral: "badge-info" };
const DIFFICULTY_BADGE = { easy: "badge-success", medium: "badge-warning", hard: "badge-error" };

function barColor(score) {
  if (score >= 75) return "progress-success";
  if (score >= 50) return "progress-warning";
  return "progress-error";
}

function Keywords({ covered, missed }) {
  if (!covered?.length && !missed?.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {(covered || []).map((k) => <span key={`c-${k}`} className="badge badge-sm badge-success badge-outline">{k}</span>)}
      {(missed || []).map((k) => <span key={`m-${k}`} className="badge badge-sm badge-error badge-outline">{k}</span>)}
    </div>
  );
}

function Answer({ response, label }) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-base-content/50">{label}</span>
        {response.score != null && <ScoreBadge label="Score" score={response.score} size="badge-sm" />}
      </div>
      <p className="text-sm whitespace-pre-wrap">{response.answer || <span className="text-base-content/40">No answer</span>}</p>
      {response.score != null ? (
        <progress className={`progress w-full ${barColor(response.score)}`} value={response.score} max="100" aria-label="Answer score" />
      ) : (
        <p className="text-xs text-base-content/40">Not scored yet</p>
      )}
      {response.scoreReasoning && <p className="text-xs text-base-content/60">{response.scoreReasoning}</p>}
      <Keywords covered={response.keywordsCovered} missed={response.keywordsMissed} />
    </div>
  );
}

export default function QATab({ detail }) {
  const { questions, responses } = detail;
  const byQuestion = new Map();
  for (const r of responses) {
    const list = byQuestion.get(r.questionId) || [];
    list.push(r);
    byQuestion.set(r.questionId, list);
  }
  const known = new Set(questions.map((q) => q.id));
  const strays = responses.filter((r) => !known.has(r.questionId));

  if (!questions.length && !responses.length) {
    return (
      <div className="bg-base-200 border border-dashed border-base-300 rounded-xl p-8 text-center">
        <MessageSquare className="mx-auto mb-2 text-base-content/20" size={24} />
        <p className="font-semibold">No questions asked yet</p>
        <p className="text-sm text-base-content/60 mt-1">Answers appear here as the candidate responds.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-base-content/60">
        Green keywords were covered in the answer, red ones were expected but missing. Scores compare the answer with the question&apos;s ideal answer.
      </p>
      {questions.map((q, index) => {
        const list = (byQuestion.get(q.id) || []).slice().sort((a, b) => new Date(a.answeredAt) - new Date(b.answeredAt));
        const base = list.find((r) => !r.isFollowUp);
        const followUps = list.filter((r) => r.isFollowUp);
        return (
          <div key={q.id} className="bg-base-200 border border-base-300 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="font-medium text-sm">
                <span className="text-base-content/50 mr-1.5">Q{index + 1}</span>{q.question}
              </p>
              <div className="flex gap-1.5">
                {q.category && <span className={`badge badge-sm ${CATEGORY_BADGE[q.category] || "badge-ghost"}`}>{q.category}</span>}
                {q.difficulty && <span className={`badge badge-sm ${DIFFICULTY_BADGE[q.difficulty] || "badge-ghost"}`}>{q.difficulty}</span>}
                {q.candidateId && <span className="badge badge-sm badge-outline">personalised</span>}
              </div>
            </div>
            {base ? <Answer response={base} label="Answer" /> : <p className="text-sm text-base-content/50">Not answered.</p>}
            {followUps.length > 0 && (
              <div className="border-l-2 border-base-300 pl-4 space-y-3">
                {followUps.map((r, i) => (
                  <div key={r.id} className="space-y-1">
                    <p className="text-xs text-base-content/60">Follow-up {i + 1}: {r.questionText}</p>
                    <Answer response={r} label="Answer" />
                  </div>
                ))}
              </div>
            )}
            {q.idealAnswer && (
              <details className="text-xs text-base-content/60">
                <summary className="cursor-pointer">Ideal answer</summary>
                <p className="mt-1 whitespace-pre-wrap">{q.idealAnswer}</p>
              </details>
            )}
          </div>
        );
      })}
      {strays.length > 0 && (
        <div className="bg-base-200 border border-base-300 rounded-xl p-4 space-y-3">
          <p className="text-sm font-medium">Other answers</p>
          {strays.map((r) => (
            <div key={r.id} className="space-y-1">
              <p className="text-xs text-base-content/60">{r.questionText}</p>
              <Answer response={r} label="Answer" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
