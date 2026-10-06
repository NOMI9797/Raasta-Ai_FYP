/* eslint-disable @next/next/no-img-element */
import Container from "./ui/Container";

// The three sites Raasta-AI searches. Static, in their real colours, no carousel.
// (CSV and Excel uploads are covered in the Integrations tab.)
const sources = [
  { name: "LinkedIn", logo: "/logos/linkedin.svg" },
  { name: "Rozee.pk", wordmark: "/logos/rozee.svg" },
  { name: "Indeed", logo: "/logos/indeed.svg" },
];

const PlatformStrip = () => (
  <section id="platforms" aria-labelledby="platforms-title" className="bg-raasta-white py-10 md:py-12">
    <Container className="flex flex-col gap-5 md:flex-row md:items-center md:gap-14">
      <h2 id="platforms-title" className="shrink-0 text-[15px] font-medium text-raasta-slate">
        Searches for prospects and candidates on
      </h2>
      <ul className="flex flex-wrap items-center gap-x-12 gap-y-4">
        {sources.map((s) => (
          <li key={s.name} className="flex h-8 items-center gap-2.5">
            {s.wordmark ? (
              <img src={s.wordmark} alt={s.name} className="h-7 w-auto" />
            ) : (
              <>
                <img src={s.logo} alt="" className="h-6 w-6" />
                <span className="font-display text-[19px] font-semibold tracking-[-0.01em] text-raasta-navy">{s.name}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </Container>
  </section>
);

export default PlatformStrip;
