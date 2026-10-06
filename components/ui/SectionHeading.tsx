import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Eyebrow } from "./Eyebrow";

export interface SectionHeadingProps {
  eyebrow: ReactNode;
  children: ReactNode;
  className?: string;
  align?: "left" | "center";
}

export function SectionHeading({ eyebrow, children, className, align = "left" }: SectionHeadingProps) {
  return (
    <div className={cn("space-y-4", align === "center" && "mx-auto text-center", className)}>
      <Eyebrow className={cn(align === "center" && "justify-center")}>{eyebrow}</Eyebrow>
      <h2 className="text-[clamp(2rem,5vw,3rem)] font-medium leading-[1.1] tracking-[-0.03em] text-ink">
        {children}
      </h2>
    </div>
  );
}