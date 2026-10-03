import { AudioLines } from "lucide-react";
import config from "@/config";

// Public, minimal layout for the candidate interview room: no dashboard chrome, no auth.
export const metadata = {
  title: `Interview | ${config.appName}`,
  robots: { index: false, follow: false, nocache: true },
};

export default function InterviewLayout({ children }) {
  return (
    <div className="min-h-screen bg-base-200 flex flex-col">
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2 font-bold text-lg text-primary">
          <AudioLines className="w-6 h-6" aria-hidden="true" />
          <span>{config.appName}</span>
        </div>
        <a
          href={`mailto:${config.mailgun.supportEmail}?subject=${encodeURIComponent("Help with my interview")}`}
          className="link link-hover text-sm text-base-content/70"
        >
          Need help?
        </a>
      </header>
      <main className="flex-1 flex flex-col">{children}</main>
    </div>
  );
}
