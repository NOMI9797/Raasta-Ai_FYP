import { Children, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface CellRowProps {
  children: ReactNode;
  className?: string;
  cellClassName?: string;
}

export function CellRow({ children, className, cellClassName }: CellRowProps) {
  const cells = Children.toArray(children);

  return (
    <div
      className={cn("grid border-y border-border", className)}
      style={{ gridTemplateColumns: `repeat(${Math.max(cells.length, 1)}, minmax(0, 1fr))` }}
    >
      {cells.map((cell, index) => (
        <div key={index} className={cn("min-w-0 border-border px-5 py-4", index > 0 && "border-l", cellClassName)}>
          {cell}
        </div>
      ))}
    </div>
  );
}