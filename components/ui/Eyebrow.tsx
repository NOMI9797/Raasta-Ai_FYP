import type { ReactNode } from "react";
import { Sparkles, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";


export interface EyebrowProps {
  children: ReactNode;
  className?: string;
  icon?: LucideIcon;
}

export function Eyebrow({ children, className, icon: Icon = Sparkles }: EyebrowProps) {
  return (
    <p className={cn("flex items-center gap-2 text-[13px] leading-[1.5] font-medium text-muted", className)}>
      <Icon aria-hidden="true" className="size-3.5 shrink-0 text-primary" size={14} />
      <span>{children}</span>
    </p>
  );
}
