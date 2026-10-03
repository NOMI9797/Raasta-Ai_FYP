"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";

// Keeps the page open until the recording parts are uploaded
export default function CompletedStep({ info, uploads, onDone }) {
  const [status, setStatus] = useState(uploads?.status() || { pending: 0, uploaded: 0, failed: 0 });
  const [finished, setFinished] = useState(!uploads || uploads.pending === 0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const done = () => onDoneRef.current?.();
    if (!uploads) {
      done();
      return undefined;
    }
    const previous = uploads.onChange;
    uploads.onChange = (s) => {
      previous?.(s);
      setStatus(s);
    };
    let cancelled = false;
    uploads.drain().then(() => {
      if (cancelled) return;
      setStatus(uploads.status());
      setFinished(true);
      done();
    });
    const onBeforeUnload = (event) => {
      if (uploads.pending === 0) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      cancelled = true;
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [uploads]);

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="card bg-base-100 shadow-sm max-w-md w-full">
        <div className="card-body items-center text-center">
          <CheckCircle2 className="w-14 h-14 text-success mb-2" aria-hidden="true" />
          <h1 className="card-title text-2xl">Thank you, {info.candidateFirstName}!</h1>
          <p className="text-base-content/70">Your interview is complete. The hiring team will contact you.</p>
          <div className="mt-4" aria-live="polite">
            {finished ? (
              <p className="font-medium">
                {status.failed > 0
                  ? "Some of the recording couldn't be uploaded, but your answers were saved. You can close this window."
                  : "You can close this window."}
              </p>
            ) : (
              <div className="flex items-center gap-3">
                <span className="loading loading-spinner loading-sm text-primary" />
                <span>Finishing upload… please don&apos;t close this tab{status.pending ? ` (${status.pending} left)` : ""}.</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
