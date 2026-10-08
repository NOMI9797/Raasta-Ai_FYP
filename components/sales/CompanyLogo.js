"use client";

import { useState } from "react";
import { Avatar } from "@/components/sales/conversations/ConversationThread";

/** A company's logo when the job board gave one, otherwise its initials. */
export default function CompanyLogo({ name, logo, size = "h-9 w-9" }) {
  const [failed, setFailed] = useState(false);
  if (logo && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- logos come from many hosts
      <img src={logo} alt="" className={`${size} shrink-0 rounded-lg border border-base-300 bg-white object-contain p-0.5`} onError={() => setFailed(true)} />
    );
  }
  return <Avatar name={name || "?"} size={`${size} text-xs rounded-lg`} />;
}
