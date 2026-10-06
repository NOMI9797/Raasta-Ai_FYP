import Container from "./ui/Container";
import SectionHeading from "./ui/SectionHeading";

// Three problems, each shown with a small, static fragment of what the work looks like today.

const Fragment = ({ children }) => (
  <div aria-hidden="true" className="flex h-[176px] items-center justify-center rounded-[10px] bg-raasta-mist px-5">
    {children}
  </div>
);

const TabsFragment = () => (
  <Fragment>
    <div className="w-full max-w-[300px] rounded-control border border-raasta-line bg-raasta-white text-[12px]">
      <div className="flex gap-1 overflow-hidden border-b border-raasta-line px-2 pt-2">
        {["Ayesha R.", "Daniyal O.", "Hamza S.", "Mariam J.", "+14"].map((t, i) => (
          <span
            key={t}
            className={`shrink-0 rounded-t-chip px-2 py-1 ${i === 0 ? "bg-raasta-mist font-medium text-raasta-navy" : "text-raasta-slate"}`}
          >
            {t}
          </span>
        ))}
      </div>
      <div className="space-y-1.5 p-3">
        <p className="text-raasta-slate">Head of Growth, Indus Cloud Labs</p>
        <p className="text-raasta-slate">Last post: 2 days ago</p>
        <p className="mt-2 rounded-chip border border-dashed border-raasta-line px-2 py-1.5 text-raasta-navy">Writing note 3 of 40</p>
      </div>
    </div>
  </Fragment>
);

const SourcesFragment = () => (
  <Fragment>
    <ul className="w-full max-w-[300px] divide-y divide-raasta-line rounded-control border border-raasta-line bg-raasta-white text-[12px]">
      {[
        ["Rozee.pk applicants", "31"],
        ["Indeed applicants", "18"],
        ["CVs in the inbox", "23"],
        ["LinkedIn messages", "12"],
        ["cv_final_v3.xlsx", "57 rows"],
      ].map(([where, count]) => (
        <li key={where} className="flex justify-between px-3 py-1.5">
          <span className="text-raasta-navy">{where}</span>
          <span className="tabular-nums text-raasta-slate">{count}</span>
        </li>
      ))}
    </ul>
  </Fragment>
);

const TemplateFragment = () => (
  <Fragment>
    <div className="w-full max-w-[300px] rounded-control border border-raasta-line bg-raasta-white p-3 text-[12px] leading-relaxed text-raasta-navy">
      <p>
        Hi <span className="rounded-chip bg-raasta-wash px-1 text-raasta-cobaltDeep">{"{first_name}"}</span>, I came across your
        profile and thought you&apos;d be a great fit for our{" "}
        <span className="rounded-chip bg-raasta-wash px-1 text-raasta-cobaltDeep">{"{product}"}</span>.
      </p>
      <p className="mt-2 flex justify-between border-t border-raasta-line pt-2 text-raasta-slate">
        <span>Sent to 200 people</span>
        <span>0 replies</span>
      </p>
    </div>
  </Fragment>
);

const problems = [
  {
    Fragment: TabsFragment,
    title: "Research eats the day",
    body: "Reps open profile after profile, skim posts and write each note by hand. Forty leads can take a whole afternoon.",
  },
  {
    Fragment: SourcesFragment,
    title: "CVs live in five places",
    body: "LinkedIn, Rozee.pk, Indeed, email and a spreadsheet. Nobody can compare applicants side by side.",
  },
  {
    Fragment: TemplateFragment,
    title: "Templates get ignored",
    body: "A message with a name swapped in reads like spam. People reply when you mention something they actually said.",
  },
];

const Problem = () => (
  <section id="problem" aria-labelledby="problem-title" className="border-t border-raasta-line bg-raasta-mist py-20 md:py-32">
    <Container>
      <SectionHeading id="problem-title" title="Three things that slow small sales and hiring teams down" />

      <ul className="mt-12 grid gap-6 md:mt-16 md:grid-cols-3">
        {problems.map(({ Fragment: F, title, body }) => (
          <li key={title} className="rounded-card border border-raasta-line bg-raasta-white p-3">
            <F />
            <h3 className="mt-5 px-2 font-display text-[20px] font-medium tracking-[-0.01em] text-raasta-navy">{title}</h3>
            <p className="mt-2 px-2 pb-3 text-[16px] leading-[1.6] text-raasta-slate">{body}</p>
          </li>
        ))}
      </ul>
    </Container>
  </section>
);

export default Problem;
