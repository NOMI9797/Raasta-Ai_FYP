"use client";

// The interviewer visual: an abstract orb that pulses while the interviewer speaks (no human avatar).
export default function InterviewerOrb({ active, listening }) {
  return (
    <div className="relative w-40 h-40 flex items-center justify-center" aria-hidden="true">
      <div className={`absolute inset-0 rounded-full bg-primary/20 ${active ? "animate-ping" : ""}`} style={{ animationDuration: "1.6s" }} />
      <div className={`absolute inset-4 rounded-full bg-primary/30 transition-transform duration-500 ${active ? "scale-110" : "scale-100"}`} />
      <div
        className={`relative w-24 h-24 rounded-full shadow-lg transition-all duration-500 ${
          listening ? "bg-success" : "bg-primary"
        } ${active ? "animate-pulse" : ""}`}
      />
    </div>
  );
}
