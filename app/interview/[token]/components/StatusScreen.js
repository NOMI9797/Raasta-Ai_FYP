"use client";

import { AlertTriangle, CheckCircle2, Clock, Laptop, Link2Off, WifiOff } from "lucide-react";

const SCREENS = {
  expired: {
    icon: Clock,
    title: "This link has expired",
    text: "This interview link has expired. Contact the recruiter to request a new one.",
  },
  not_found: {
    icon: Link2Off,
    title: "Link no longer valid",
    text: "This link is no longer valid. Please use the link in your most recent email, or contact the recruiter.",
  },
  cancelled: {
    icon: Link2Off,
    title: "Link no longer valid",
    text: "This link is no longer valid. Please use the link in your most recent email, or contact the recruiter.",
  },
  unavailable: {
    icon: Link2Off,
    title: "Interview unavailable",
    text: "This interview is no longer available. Please contact the recruiter.",
  },
  completed: {
    icon: CheckCircle2,
    title: "Interview already completed",
    text: "You've already completed this interview. Thank you!",
  },
  unsupported: {
    icon: Laptop,
    title: "Browser not supported",
    text: "Please use Chrome or Edge on a computer.",
  },
  duplicate_session: {
    icon: AlertTriangle,
    title: "Interview open elsewhere",
    text: "This interview is already open in another window or tab. Close it there, then reload this page.",
  },
  connection_lost: {
    icon: WifiOff,
    title: "Connection lost",
    text: "We couldn't reconnect to the interviewer. Check your internet connection and reload this page — your interview will continue where it stopped.",
  },
  network: {
    icon: WifiOff,
    title: "Can't reach the server",
    text: "Please check your internet connection and try again.",
  },
  rate_limited: {
    icon: Clock,
    title: "Please wait a moment",
    text: "Too many attempts. Please wait a few minutes and reload the page.",
  },
};

export default function StatusScreen({ problem, onRetry }) {
  const screen = SCREENS[problem?.code] || {
    icon: AlertTriangle,
    title: "Something went wrong",
    text: problem?.message || "Please reload the page. If the problem continues, contact the recruiter.",
  };
  const Icon = screen.icon;
  const recoverable = ["connection_lost", "duplicate_session", "rate_limited"].includes(problem?.code);
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="card bg-base-100 shadow-sm max-w-md w-full">
        <div className="card-body items-center text-center">
          <Icon className="w-12 h-12 text-primary mb-2" aria-hidden="true" />
          <h1 className="card-title text-xl">{screen.title}</h1>
          <p className="text-base-content/70">{screen.text}</p>
          {(onRetry || recoverable) && (
            <button type="button" className="btn btn-primary mt-4" onClick={onRetry || (() => window.location.reload())}>
              {onRetry ? "Try again" : "Reload page"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
