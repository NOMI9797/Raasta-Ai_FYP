"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

const storageKey = "raasta-announcement-dismissed";

export function AnnouncementBar() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      setVisible(sessionStorage.getItem(storageKey) !== "true");
    } catch {
      setVisible(true);
    }
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      sessionStorage.setItem(storageKey, "true");
    } catch {
      // Storage can be unavailable in privacy-restricted contexts.
    }
  };

  if (!visible) return null;

  return (
    <div className="relative flex h-9 items-center justify-center bg-primary px-12 text-center text-[13px] font-medium text-on-primary">
      <span>New: publish jobs to LinkedIn and parse resumes automatically {"\u2192"}</span>
      <button
        aria-label="Dismiss announcement"
        className="absolute right-4 grid size-7 place-items-center rounded-full text-on-primary transition-opacity duration-150 hover:opacity-70 motion-reduce:transition-none"
        onClick={dismiss}
        type="button"
      >
        <X size={15} />
      </button>
    </div>
  );
}
