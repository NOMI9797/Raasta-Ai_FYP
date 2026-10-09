"use client";

import { Linkedin, Mail } from "lucide-react";
import { PLATFORM_META } from "@/libs/platforms/meta";

/**
 * Where a lead came from (LinkedIn, Rozee.pk, Indeed) and how we talk to them (email or LinkedIn
 * messages): a Rozee.pk company can be written to on LinkedIn, so both are shown.
 */
export default function SourceTag({ source, channel, size = "xs" }) {
  const meta = PLATFORM_META[source];
  const ChannelIcon = channel === "linkedin" ? Linkedin : Mail;
  const sm = size === "sm";
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {meta && (
        <span
          className={`inline-flex items-center gap-1 rounded-full border border-base-300 bg-base-100 font-medium text-base-content/70 ${sm ? "py-0.5 pl-0.5 pr-2 text-xs" : "py-px pl-px pr-1.5 text-[10px]"}`}
          title={`Lead from ${meta.label}`}
        >
          <span className={`inline-flex items-center justify-center rounded-full font-bold text-white ${meta.accent} ${sm ? "h-4 w-4 text-[8px]" : "h-3.5 w-3.5 text-[7px]"}`}>{meta.initials}</span>
          {meta.label}
        </span>
      )}
      {channel && (
        <span className="inline-flex items-center gap-0.5 text-base-content/45" title={channel === "linkedin" ? "Conversation on LinkedIn messages" : "Conversation by email"}>
          <ChannelIcon className={sm ? "h-3.5 w-3.5" : "h-3 w-3"} />
          {sm && <span className="text-xs">{channel === "linkedin" ? "LinkedIn" : "Email"}</span>}
        </span>
      )}
    </span>
  );
}
