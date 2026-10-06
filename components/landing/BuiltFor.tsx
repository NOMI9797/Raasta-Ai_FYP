import { BriefcaseBusiness, UserRound, Users } from "lucide-react";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Reveal } from "@/components/ui/Reveal";

const cards = [
  { icon: BriefcaseBusiness, label: "Sales / BD Operator", quote: "Define your ICP, review every AI-written message, and approve sends. You stay in control while Raasta-AI does the grind." },
  { icon: Users, label: "Recruiter", quote: "Configure the role, refine the AI job post, publish to LinkedIn, and review parsed candidates in one pipeline." },
] as const;

export function BuiltFor() {
  return (
    <section className="py-16 md:py-24" data-testid="section-built-for">
      <Reveal className="mx-auto w-[min(100%-32px,1200px)]">
        <div className="grid gap-5 md:grid-cols-12 md:gap-x-8">
          <div className="md:col-span-3"><Eyebrow>Built for your team</Eyebrow></div>
          <h2 className="max-w-[720px] text-[clamp(2rem,5vw,2.5rem)] font-medium leading-[1.12] tracking-[-0.03em] text-ink md:col-span-9">Made for the people who run the pipeline.</h2>
        </div>
        {/* TODO: replace with real testimonials */}
        <div className="mt-12 grid gap-4 md:grid-cols-2">
          {cards.map(({ icon: Icon, label, quote }, index) => (
            <article data-spotlight data-tilt className={index === 0 ? "built-for-featured rounded-lg border border-border bg-surface p-6" : "rounded-lg border border-transparent bg-surface p-6"} key={label}>
              <div className="flex items-center gap-2 text-[13px] text-muted"><Icon className="size-4 text-primary" /><span>{label}</span></div>
              <blockquote className="mt-8 text-xl font-medium leading-[1.4] tracking-[-0.02em] text-ink">&ldquo;{quote}&rdquo;</blockquote>
              <div className="mt-10 flex items-center gap-3 border-t border-border pt-5">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-primary"><UserRound className="size-5" /></span>
                <div><p className="text-sm font-semibold text-ink">{label}</p><p className="mt-0.5 text-[13px] leading-[1.5] text-muted">Raasta-AI</p></div>
              </div>
            </article>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

