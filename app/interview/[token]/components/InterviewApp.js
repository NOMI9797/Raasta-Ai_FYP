"use client";

import { useCallback, useEffect, useState } from "react";
import StatusScreen from "./StatusScreen";
import WelcomeStep from "./WelcomeStep";
import DeviceCheck from "./DeviceCheck";
import InterviewRoom from "./InterviewRoom";
import CompletedStep from "./CompletedStep";
import { browserSupport } from "../lib/audio";

// Steps: loading → welcome (consent) → devices → interview → completed, or a status screen
export default function InterviewApp({ token }) {
  const [step, setStep] = useState("loading");
  const [info, setInfo] = useState(null);
  const [problem, setProblem] = useState(null); // { code, message }
  const [media, setMedia] = useState(null);     // { stream, ctx } from the device check
  const [uploads, setUploads] = useState(null); // UploadQueue, handed to the completed screen

  const load = useCallback(async () => {
    const support = browserSupport();
    if (!support.ok) {
      setProblem({ code: "unsupported" });
      setStep("status");
      return;
    }
    try {
      const res = await fetch(`/api/interview/${encodeURIComponent(token)}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProblem({ code: body.code || "not_found", message: body.error });
        setStep("status");
        return;
      }
      setInfo(body.interview);
      setStep(body.interview.consentGiven ? "devices" : "welcome");
    } catch {
      setProblem({ code: "network" });
      setStep("status");
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // Stop the camera and microphone when the room is left
  useEffect(() => () => media?.stream?.getTracks().forEach((t) => t.stop()), [media]);

  if (step === "loading") {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="loading loading-spinner loading-lg text-primary" aria-label="Loading" />
      </div>
    );
  }
  if (step === "status") return <StatusScreen problem={problem} onRetry={problem?.code === "network" ? load : null} />;
  if (step === "welcome") return <WelcomeStep token={token} info={info} onAccepted={() => setStep("devices")} />;
  if (step === "devices") {
    return (
      <DeviceCheck
        token={token}
        info={info}
        onReady={(m) => {
          setMedia(m);
          setStep("interview");
        }}
      />
    );
  }
  if (step === "interview") {
    return (
      <InterviewRoom
        token={token}
        info={info}
        media={media}
        onComplete={(queue) => {
          setUploads(queue);
          setStep("completed");
        }}
        onFatal={(p) => {
          media?.stream?.getTracks().forEach((t) => t.stop());
          setProblem(p);
          setStep("status");
        }}
      />
    );
  }
  return <CompletedStep info={info} uploads={uploads} onDone={() => media?.stream?.getTracks().forEach((t) => t.stop())} />;
}
