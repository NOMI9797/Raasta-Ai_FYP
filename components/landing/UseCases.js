import Container from "./ui/Container";
import SectionHeading from "./ui/SectionHeading";

// Three roles, three plain cards. Rows are a subgrid, so role, headline, body and the
// "instead of" line align across cards whatever the copy length. Static: nothing here
// is clickable, so nothing pretends to be.
const cases = [
  {
    role: "Sales and BD reps",
    headline: "More conversations, less research",
    after: "Upload a list, review notes that mention each lead's own posts, then send them. On Pro, autopilot can send for you.",
    before: "Instead of a morning spent opening profiles and writing notes one by one.",
  },
  {
    role: "Recruiters and HR",
    headline: "One application link per job",
    after: "Post once, collect every CV through one form, and see skills and experience already pulled out.",
    before: "Instead of CVs spread across job boards, inboxes and a shared spreadsheet.",
  },
  {
    role: "Founders and admins",
    headline: "The right access for each person",
    after: "Give every teammate a role with only the workflows they need. Daily LinkedIn limits are applied for you.",
    before: "Instead of shared logins and guessing who can see what.",
  },
];

const UseCases = () => (
  <section id="use-cases" aria-labelledby="use-cases-title" className="border-t border-raasta-line bg-raasta-white py-20 md:py-32">
    <Container>
      <SectionHeading id="use-cases-title" title="Who uses Raasta-AI, and what changes for them" />

      <ul className="mt-12 grid gap-6 md:mt-16 md:grid-cols-3 md:grid-rows-[auto_auto_1fr_auto]">
        {cases.map((c) => (
          <li
            key={c.role}
            className="grid gap-3 rounded-card border border-raasta-line bg-raasta-mist p-7 md:row-span-4 md:grid-rows-subgrid"
          >
            <p className="text-[14px] font-semibold text-raasta-cobaltDeep">{c.role}</p>
            <h3 className="font-display text-[24px] font-medium leading-tight tracking-[-0.015em] text-raasta-navy">{c.headline}</h3>
            <p className="text-[16px] leading-[1.6] text-raasta-navy">{c.after}</p>
            <p className="border-t border-raasta-line pt-4 text-[15px] leading-[1.55] text-raasta-slate">{c.before}</p>
          </li>
        ))}
      </ul>
    </Container>
  </section>
);

export default UseCases;
