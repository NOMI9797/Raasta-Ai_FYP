import Link from "next/link";
import { Hammer } from "lucide-react";

/** A tab whose screen is still being built: says what it will do and, if possible, where to do it today. */
export default function StageNotReady({ title, points = [], workaround }) {
  return (
    <div className="rounded-xl border border-dashed border-base-300 p-6 space-y-3">
      <p className="font-semibold flex items-center gap-2">
        <Hammer className="h-4 w-4 text-warning" /> {title}
      </p>
      {points.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-base-content/70 space-y-1">
          {points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {workaround && (
        <p className="text-sm">
          For now: {workaround.text}{" "}
          {workaround.href && (
            <Link href={workaround.href} className="link link-primary">
              {workaround.cta}
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
