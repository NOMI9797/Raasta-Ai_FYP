import { DitherField } from "@/components/ui/DitherField";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";

const articles = [
  { title: "Getting started: connect your LinkedIn", excerpt: "Connect your account securely and prepare it for thoughtful, automated outreach.", date: "September 18, 2026" },
  { title: "Writing outreach that references real posts", excerpt: "Turn a lead's recent posts into relevant messages that feel personal and timely.", date: "September 25, 2026" },
  { title: "Setting up your first hiring pipeline", excerpt: "Build a clear candidate pipeline and move applicants from review to interview.", date: "October 2, 2026" },
] as const;

export function Resources() {
  return (
    <section className="py-16 md:py-24" data-testid="section-resources">
      <Reveal className="mx-auto w-[min(100%-32px,1200px)]">
        <div className="text-center">
          <Eyebrow className="justify-center">Insights &amp; Resources</Eyebrow>
          <h2 className="mx-auto mt-4 max-w-[680px] text-4xl font-medium leading-[1.12] tracking-[-0.03em] text-ink">Learn how teams automate outreach and hiring.</h2>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {articles.map((article, index) => (
            <article data-spotlight data-tilt className={index === 1 ? "resource-featured rounded-lg border border-border bg-surface p-6" : "rounded-lg border border-transparent bg-surface p-6"} key={article.title}>
              <div className="relative aspect-[16/10] overflow-hidden rounded-[4px] bg-primary"><DitherField variant="card" /></div>
              <div className="pt-6">
                <h3 className="text-[15px] font-semibold leading-snug text-ink">{article.title}</h3>
                <p className="mt-3 line-clamp-2 text-[13px] leading-5 text-muted">{article.excerpt}</p>
                <time className="mt-5 block text-[13px] leading-[1.5] text-muted">{article.date}</time>
              </div>
            </article>
          ))}
        </div>
        <div className="mt-10 text-center"><Button variant="dark">View More</Button></div>
      </Reveal>
    </section>
  );
}

