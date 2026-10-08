"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, Mic, Video, Volume2, Wifi } from "lucide-react";
import { MEDIA_CONSTRAINTS, createAudioContext, playTestTone, readLevel } from "../lib/audio";
import { loadFaceLandmarker } from "../lib/behavior-tracker";

const SPEECH_LEVEL = 0.04;     // RMS that counts as speaking
const SPEECH_NEEDED_MS = 1000; // cumulative speech before the mic passes
const SLOW_NETWORK_MS = 1500;

function Check({ ok, label, children, icon: Icon }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-base-200 last:border-0">
      <Icon className="w-5 h-5 text-primary mt-0.5 shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 font-medium">
          {label}
          {ok ? <CheckCircle2 className="w-4 h-4 text-success" aria-label="passed" /> : <Circle className="w-4 h-4 text-base-content/30" aria-label="pending" />}
        </div>
        <div className="text-sm text-base-content/70 mt-1">{children}</div>
      </div>
    </div>
  );
}

export default function DeviceCheck({ token, info, onReady }) {
  const [stream, setStream] = useState(null);
  const [error, setError] = useState(null);
  const [level, setLevel] = useState(0);
  const [micOk, setMicOk] = useState(false);
  const [heard, setHeard] = useState(false);
  const [latency, setLatency] = useState(null);
  const [face, setFace] = useState(null); // camera analysis check: loading | ok | none | unavailable
  const videoRef = useRef(null);
  const ctxRef = useRef(null);
  const handedOver = useRef(false);

  // Ask for the microphone (and camera) once
  useEffect(() => {
    let cancelled = false;
    let acquired = null;
    navigator.mediaDevices.getUserMedia(MEDIA_CONSTRAINTS(info.recordVideo))
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        acquired = s;
        setStream(s);
      })
      .catch((err) => {
        setError(err?.name === "NotAllowedError"
          ? `Please allow access to your microphone${info.recordVideo ? " and camera" : ""} in the browser's address bar, then reload the page.`
          : `We couldn't open your microphone${info.recordVideo ? " or camera" : ""}. Check that ${info.recordVideo ? "they are" : "it is"} connected and not used by another app.`);
      });
    return () => {
      cancelled = true;
      if (acquired && !handedOver.current) acquired.getTracks().forEach((t) => t.stop());
      if (ctxRef.current && !handedOver.current) ctxRef.current.close().catch(() => {});
    };
  }, [info.recordVideo]);

  // Camera preview
  useEffect(() => {
    if (stream && videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  // Face check. Not required to start: it only helps the candidate fix lighting or framing now
  useEffect(() => {
    if (!stream || !info.recordVideo || !info.trackBehavior) return undefined;
    let cancelled = false;
    let landmarker = null;
    let timer = null;
    setFace("loading");
    loadFaceLandmarker({ numFaces: 1 })
      .then((model) => {
        if (cancelled) {
          model.close();
          return;
        }
        landmarker = model;
        setFace("none");
        const tick = () => {
          const video = videoRef.current;
          if (video && video.readyState >= 2 && video.videoWidth) {
            try {
              setFace(model.detectForVideo(video, performance.now()).faceLandmarks.length ? "ok" : "none");
            } catch {
              // a bad frame: try again on the next tick
            }
          }
          timer = setTimeout(tick, 500);
        };
        tick();
      })
      .catch(() => {
        if (!cancelled) setFace("unavailable");
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      try { landmarker?.close(); } catch { /* already closed */ }
    };
  }, [stream, info.recordVideo, info.trackBehavior]);

  // Mic level meter: pass after ~1 s of speech
  useEffect(() => {
    if (!stream) return undefined;
    const ctx = ctxRef.current || createAudioContext();
    ctxRef.current = ctx;
    const source = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const buffer = new Float32Array(analyser.fftSize);
    let spoken = 0;
    let last = performance.now();
    let raf;
    const tick = (now) => {
      const rms = readLevel(analyser, buffer);
      setLevel(Math.min(1, rms * 6));
      if (rms > SPEECH_LEVEL) spoken += now - last;
      last = now;
      if (spoken >= SPEECH_NEEDED_MS) setMicOk(true);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      try { source.disconnect(); } catch { /* ignore */ }
    };
  }, [stream]);

  // Network check
  useEffect(() => {
    const started = performance.now();
    fetch(`/api/interview/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(() => setLatency(Math.round(performance.now() - started)))
      .catch(() => setLatency(-1));
  }, [token]);

  async function testSound() {
    const ctx = ctxRef.current || createAudioContext();
    ctxRef.current = ctx;
    await ctx.resume();
    playTestTone(ctx);
  }

  async function start() {
    const ctx = ctxRef.current || createAudioContext();
    ctxRef.current = ctx;
    await ctx.resume(); // inside the click: allowed to play audio
    handedOver.current = true;
    onReady({ stream, ctx });
  }

  const networkOk = latency !== null && latency >= 0 && latency < SLOW_NETWORK_MS;
  const canStart = Boolean(stream) && micOk && heard && latency !== null;

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="card bg-base-100 shadow-sm max-w-2xl w-full">
        <div className="card-body">
          <h1 className="text-2xl font-bold">Check your microphone{info.recordVideo ? ", camera" : ""} and sound</h1>
          {error && <div role="alert" className="alert alert-error my-2"><span>{error}</span></div>}

          <div className={`grid gap-6 ${info.recordVideo ? "md:grid-cols-[1fr_240px]" : ""}`}>
            <div>
              <Check icon={Mic} ok={micOk} label="Microphone">
                <p>Say &ldquo;hello&rdquo; to test your mic.</p>
                <progress className={`progress w-full mt-2 ${micOk ? "progress-success" : "progress-primary"}`} value={Math.round(level * 100)} max="100" aria-label="Microphone level" />
              </Check>
              <Check icon={Volume2} ok={heard} label="Speakers or headphones">
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" className="btn btn-sm btn-outline" onClick={testSound}>Play test sound</button>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" className="checkbox checkbox-sm checkbox-primary" checked={heard} onChange={(e) => setHeard(e.target.checked)} />
                    <span>I can hear it</span>
                  </label>
                </div>
              </Check>
              <Check icon={Wifi} ok={networkOk} label="Connection">
                {latency === null && "Checking…"}
                {latency !== null && latency >= 0 && latency < SLOW_NETWORK_MS && `Good (${latency} ms)`}
                {latency !== null && (latency < 0 || latency >= SLOW_NETWORK_MS) && (
                  <span className="text-warning">Your connection looks slow. You can continue, but a stable connection works best.</span>
                )}
              </Check>
            </div>
            {info.recordVideo && (
              <div>
                <div className="flex items-center gap-2 font-medium mb-2"><Video className="w-5 h-5 text-primary" aria-hidden="true" /> Camera</div>
                <video ref={videoRef} autoPlay muted playsInline className="w-full rounded-lg bg-base-300 aspect-video object-cover -scale-x-100" aria-label="Camera preview" />
                {face && face !== "unavailable" && (
                  <p className={`text-sm mt-2 flex items-center gap-1.5 ${face === "ok" ? "text-success" : "text-base-content/70"}`} aria-live="polite">
                    {face === "ok" && <><CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Your face is visible</>}
                    {face === "loading" && <><span className="loading loading-spinner loading-xs" /> Checking that your face can be seen…</>}
                    {face === "none" && "We can't see your face yet. Face the camera, in good light."}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="card-actions justify-end mt-4">
            <button type="button" className="btn btn-primary" disabled={!canStart} onClick={start}>
              {info.canResume ? "Resume interview" : "Start interview"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
