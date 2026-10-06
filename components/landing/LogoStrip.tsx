import { Bot, Boxes, Database, Linkedin, Search } from "lucide-react";
import { CellRow } from "@/components/ui/CellRow";

const integrations = [
  [Linkedin, "LinkedIn"],
  [Search, "Google"],
  [Bot, "OpenAI"],
  [Database, "PostgreSQL"],
  [Boxes, "Redis"],
] as const;

export function LogoStrip() {
  return (
    <div className="mx-auto w-[min(100%-32px,1200px)]">
      <p className="mb-3 text-center text-[13px] leading-[1.5] font-medium text-muted">Works with</p>
      <CellRow className="grid-cols-2 sm:grid-cols-5" cellClassName="group flex h-[88px] items-center justify-center gap-2.5 px-3 text-muted transition-colors duration-150 hover:text-ink motion-reduce:transition-none">
        {integrations.map(([Icon, label]) => (
          <div className="flex items-center justify-center gap-2.5" key={label}>
            <Icon aria-hidden="true" className="size-5" strokeWidth={1.7} />
            <span className="hidden text-lg font-semibold tracking-[-0.02em] sm:inline">{label}</span>
          </div>
        ))}
      </CellRow>
    </div>
  );
}