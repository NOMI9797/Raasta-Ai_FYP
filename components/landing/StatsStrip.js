import Container from "./ui/Container";

// Product limits, stated as limits. Static on purpose: these are rules, not achievements.
const limits = [
  { value: "15 a day", label: "Most LinkedIn invites Raasta-AI will send from one account. It never goes past this." },
  { value: "4–5 posts", label: "Read from each lead's public activity before a note is drafted." },
  { value: "5 MB", label: "Largest CV it accepts, as a PDF or DOCX file." },
];

const StatsStrip = () => (
  <div className="border-y border-raasta-line bg-raasta-mist">
    <Container>
      <dl className="grid divide-raasta-line sm:grid-cols-3 sm:divide-x">
        {limits.map((l) => (
          <div
            key={l.value}
            className="flex flex-col-reverse justify-end gap-2 border-raasta-line py-7 max-sm:border-b max-sm:last:border-b-0 sm:px-8 sm:first:pl-0 md:py-9"
          >
            <dt className="max-w-[280px] text-[15px] leading-[1.5] text-raasta-slate">{l.label}</dt>
            <dd className="font-display text-[28px] font-medium leading-none tracking-[-0.02em] tabular-nums text-raasta-navy">
              {l.value}
            </dd>
          </div>
        ))}
      </dl>
    </Container>
  </div>
);

export default StatsStrip;
