"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  Briefcase,
  TrendingUp,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Linkedin,
  Loader2,
  Eye,
  EyeOff,
  X,
} from "lucide-react";
import { PLATFORM_META as SHARED_PLATFORM_META } from "@/libs/platforms/meta";

const MODES = [
  {
    id: "recruiter",
    title: "I'm a Recruiter",
    sub: "Hire candidates from job boards",
    icon: Briefcase,
  },
  {
    id: "sales",
    title: "I'm in Sales",
    sub: "Find clients & leads",
    icon: TrendingUp,
  },
];

const PLATFORMS_BY_MODE = {
  recruiter: ["linkedin", "rozee", "indeed"],
  sales: ["linkedin", "indeed"],
};

// Onboarding-specific connection endpoints merged with shared visual meta.
const PLATFORM_ENDPOINTS = {
  linkedin: { endpoint: "/api/linkedin/connect", listEndpoint: "/api/linkedin/accounts" },
  rozee: { endpoint: "/api/rozee/connect", listEndpoint: "/api/rozee/accounts" },
};

const PLATFORM_META = Object.fromEntries(
  Object.entries(SHARED_PLATFORM_META).map(([id, meta]) => [
    id,
    { ...meta, ...(PLATFORM_ENDPOINTS[id] || {}) },
  ])
);

export default function OnboardingPage() {
  const { data: session, status, update: updateSession } = useSession();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [selectedModes, setSelectedModes] = useState([]);
  const [savingModes, setSavingModes] = useState(false);
  const [connectedPlatforms, setConnectedPlatforms] = useState({});
  const [connectModal, setConnectModal] = useState(null);
  const [credentials, setCredentials] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.replace("/signin");
      return;
    }
    const modes = session.user?.modes ?? [];
    if (modes.length > 0) {
      // Already onboarded — bounce to dashboard.
      router.replace("/dashboard/home");
    }
  }, [session, status, router]);

  const toggleMode = (id) => {
    setSelectedModes((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const availablePlatforms = Array.from(
    new Set(selectedModes.flatMap((m) => PLATFORMS_BY_MODE[m] ?? []))
  );

  const handleSaveModes = async () => {
    if (selectedModes.length === 0) {
      toast.error("Pick at least one mode");
      return;
    }
    try {
      setSavingModes(true);
      const res = await fetch("/api/user/modes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modes: selectedModes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save modes");
      await updateSession();
      setStep(2);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingModes(false);
    }
  };

  const openConnect = (platform) => {
    if (PLATFORM_META[platform]?.comingSoon) return;
    setConnectModal(platform);
    setCredentials({ email: "", password: "" });
    setShowPassword(false);
  };

  const handleConnect = async () => {
    const platform = connectModal;
    if (!platform) return;
    if (!credentials.email || !credentials.password) {
      toast.error("Enter email and password");
      return;
    }
    setConnecting(true);
    try {
      const res = await fetch(PLATFORM_META[platform].endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to connect ${PLATFORM_META[platform].label}`);
      setConnectedPlatforms((prev) => ({ ...prev, [platform]: true }));
      setConnectModal(null);
      toast.success(`${PLATFORM_META[platform].label} connected`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setConnecting(false);
    }
  };

  const finish = () => {
    router.push("/dashboard/home");
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center">
        <div className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base-100 py-10 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-primary">Welcome to Raasta-AI</h1>
          <p className="text-base-content/70 mt-2">
            Let&apos;s set up your workspace in a few quick steps.
          </p>
        </div>

        <Stepper step={step} />

        {step === 1 && (
          <div className="card bg-base-200/40 border border-base-300 shadow-sm">
            <div className="card-body">
              <h2 className="card-title">How will you use Raasta-AI?</h2>
              <p className="text-sm text-base-content/60 mb-4">
                Pick one or both — you can change this later in Settings.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {MODES.map((m) => {
                  const Icon = m.icon;
                  const active = selectedModes.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleMode(m.id)}
                      className={`text-left p-5 rounded-xl border-2 transition-all ${
                        active
                          ? "border-primary bg-primary/5"
                          : "border-base-300 hover:border-base-content/30"
                      }`}
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${active ? "bg-primary text-primary-content" : "bg-base-300"}`}>
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="font-semibold">{m.title}</div>
                        {active && <CheckCircle2 className="h-5 w-5 text-primary ml-auto" />}
                      </div>
                      <div className="text-sm text-base-content/70">{m.sub}</div>
                    </button>
                  );
                })}
              </div>
              <div className="flex justify-end mt-6">
                <button
                  className="btn btn-primary gap-2"
                  onClick={handleSaveModes}
                  disabled={savingModes || selectedModes.length === 0}
                >
                  {savingModes ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Continue
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="card bg-base-200/40 border border-base-300 shadow-sm">
            <div className="card-body">
              <h2 className="card-title">Connect your platforms</h2>
              <p className="text-sm text-base-content/60 mb-4">
                Connect at least one to start scraping and outreach. You can add more later from Platforms.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {availablePlatforms.map((p) => {
                  const meta = PLATFORM_META[p];
                  const isConnected = connectedPlatforms[p];
                  return (
                    <div key={p} className="p-5 rounded-xl border border-base-300 bg-base-100">
                      <div className="flex items-center gap-2 mb-3">
                        <div className={`w-8 h-8 rounded flex items-center justify-center ${meta.accent}`}>
                          <span className="text-white text-xs font-bold">{meta.initials}</span>
                        </div>
                        <div className="font-semibold">{meta.label}</div>
                      </div>
                      {meta.comingSoon ? (
                        <div>
                          <span className="badge badge-ghost">Coming soon</span>
                          <p className="text-xs text-base-content/50 mt-3">
                            Indeed support is not live yet.
                          </p>
                        </div>
                      ) : isConnected ? (
                        <div>
                          <span className="badge badge-success gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Connected
                          </span>
                        </div>
                      ) : (
                        <button
                          className="btn btn-sm btn-outline w-full"
                          onClick={() => openConnect(p)}
                        >
                          Connect {meta.label}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between mt-6">
                <button className="btn btn-ghost gap-2" onClick={() => setStep(1)}>
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <div className="flex gap-2">
                  <button className="btn btn-ghost" onClick={finish}>
                    Skip for now
                  </button>
                  <button className="btn btn-primary gap-2" onClick={finish}>
                    Go to dashboard <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {connectModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-base-100 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-base-300">
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded flex items-center justify-center ${PLATFORM_META[connectModal].accent}`}>
                  <span className="text-white text-xs font-bold">{PLATFORM_META[connectModal].initials}</span>
                </div>
                <h3 className="font-semibold">Connect {PLATFORM_META[connectModal].label}</h3>
              </div>
              <button
                className="btn btn-sm btn-ghost btn-circle"
                onClick={() => setConnectModal(null)}
                disabled={connecting}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <input
                  type="email"
                  value={credentials.email}
                  onChange={(e) => setCredentials((p) => ({ ...p, email: e.target.value }))}
                  className="input input-bordered w-full"
                  disabled={connecting}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={credentials.password}
                    onChange={(e) => setCredentials((p) => ({ ...p, password: e.target.value }))}
                    className="input input-bordered w-full pr-10"
                    disabled={connecting}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-base-content/50"
                    onClick={() => setShowPassword((s) => !s)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  className="btn btn-ghost flex-1"
                  onClick={() => setConnectModal(null)}
                  disabled={connecting}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary flex-1 gap-2"
                  onClick={handleConnect}
                  disabled={connecting}
                >
                  {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Connect
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stepper({ step }) {
  const steps = [
    { n: 1, label: "Choose mode" },
    { n: 2, label: "Connect platforms" },
  ];
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
              step >= s.n ? "bg-primary text-primary-content" : "bg-base-300 text-base-content/60"
            }`}
          >
            {step > s.n ? <CheckCircle2 className="h-4 w-4" /> : s.n}
          </div>
          <span className={`text-sm ${step >= s.n ? "font-medium" : "text-base-content/60"}`}>
            {s.label}
          </span>
          {i < steps.length - 1 && <div className="w-8 h-px bg-base-300 mx-2" />}
        </div>
      ))}
    </div>
  );
}
