"use client";

import { useEffect, useState } from "react";
import { Clock, Languages, MessageSquareText, Mic, PauseCircle, Volume2, Monitor } from "lucide-react";

export default function WelcomeStep({ token, info, onAccepted }) {
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    setNarrow(window.innerWidth < 768);
  }, []);

  const recording = info.recordVideo ? "audio and video" : "audio";

  async function submit(event) {
    event.preventDefault();
    if (!accepted) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/interview/${encodeURIComponent(token)}/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accepted: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not save your consent. Please try again.");
      onAccepted();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const expectations = [
    {
      icon: MessageSquareText,
      text: info.maxFollowUps > 0
        ? `${info.questionCount} question${info.questionCount === 1 ? "" : "s"}, with follow-ups when time allows (up to ${info.maxFollowUps} per question)`
        : `${info.questionCount} question${info.questionCount === 1 ? "" : "s"}`,
    },
    { icon: Clock, text: `Up to ${info.maxMinutes} minutes in total; a countdown shows how much time is left` },
    { icon: Languages, text: "The interview is conducted in English only; please answer in English throughout" },
    { icon: Mic, text: "Answer by speaking; press “I've finished my answer” when you're done" },
    { icon: PauseCircle, text: "The interview can't be paused once it starts" },
    { icon: Volume2, text: "Find a quiet room; headphones help" },
  ];

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <form className="card bg-base-100 shadow-sm max-w-xl w-full" onSubmit={submit}>
        <div className="card-body gap-4">
          {narrow && (
            <div role="alert" className="alert alert-warning">
              <Monitor className="w-5 h-5" aria-hidden="true" />
              <span>Please use a computer for the best experience.</span>
            </div>
          )}
          <h1 className="text-2xl font-bold">
            Hi {info.candidateFirstName}, welcome to your interview for <span className="text-primary">{info.jobTitle}</span>
          </h1>
          <p className="text-base-content/70">
            You&apos;ll talk with the {info.interviewerName}{info.companyName ? ` on behalf of ${info.companyName}` : ""}. Here&apos;s what to expect:
          </p>
          <ul className="space-y-2">
            {expectations.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3">
                <Icon className="w-5 h-5 text-primary mt-0.5 shrink-0" aria-hidden="true" />
                <span>{text}</span>
              </li>
            ))}
          </ul>

          <label className="flex items-start gap-3 cursor-pointer bg-base-200 rounded-lg p-4 mt-2">
            <input
              type="checkbox"
              className="checkbox checkbox-primary mt-0.5"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              required
            />
            <span className="text-sm">
              I agree that this interview will be recorded ({recording}) and evaluated with the help of AI
              {info.trackBehavior ? ", including analysis of my eye movement, head movement and facial expressions on camera," : ""} and
              that the results will be shared with the hiring team.
            </span>
          </label>

          {error && <p className="text-error text-sm" role="alert">{error}</p>}

          <div className="card-actions justify-end">
            <button type="submit" className="btn btn-primary" disabled={!accepted || saving}>
              {saving && <span className="loading loading-spinner loading-sm" />}
              Continue
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
