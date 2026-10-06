import { BarChart3, Briefcase, Check, Eye, LayoutGrid, Megaphone, PenLine, Send, UserCheck, Users } from "lucide-react";
import BrandMark from "./BrandMark";

// Static product preview with sample data. One status set across the whole mock, and
// every row agrees with itself: status, last activity and the invite field never disagree.
// Nothing in here looks clickable: no buttons, no chevrons, no close icon.

const STATUS = {
  queued: { label: "Queued", cls: "border border-raasta-line bg-raasta-white text-raasta-slate" },
  drafted: { label: "Note drafted", cls: "bg-raasta-mist text-raasta-navy" },
  sent: { label: "Invite sent", cls: "bg-raasta-wash text-raasta-cobaltDeep" },
  accepted: { label: "Accepted", cls: "bg-raasta-successWash text-raasta-success" },
  replied: { label: "Replied", cls: "bg-raasta-success text-raasta-white" },
};

// Fictional people and companies.
const rows = [
  { name: "Ayesha Rahman", company: "Indus Cloud Labs", source: "LinkedIn", activity: "Accepted your invite, 2h ago", status: "accepted" },
  { name: "Bilal Qureshi", company: "Margalla Software", source: "LinkedIn", activity: "Replied yesterday", status: "replied" },
  { name: "Hamza Siddiqui", company: "Ravi Logistics", source: "Rozee.pk", activity: "Invite sent today, 10:40", status: "sent" },
  { name: "Mariam Javed", company: "Karakoram Fintech", source: "LinkedIn", activity: "Note drafted, waiting for review", status: "drafted" },
  { name: "Usman Khalid", company: "Saffron Retail", source: "Indeed", activity: "Added from Indeed today", status: "queued" },
  { name: "Sana Tariq", company: "Clifton HealthTech", source: "LinkedIn", activity: "Added from CSV today", status: "queued" },
];

// The selected lead's history, oldest first. Ends in "Accepted", matching her row.
const timeline = [
  { icon: Eye, title: "Read 5 recent public posts", meta: "Topics: hiring, go-to-market, AI tools" },
  { icon: PenLine, title: "Note drafted and approved", meta: "Mentions her post on growing an SDR team" },
  { icon: Send, title: "Invite sent", meta: "Yesterday, 11:05" },
  { icon: UserCheck, title: "Accepted", meta: "2 hours ago", done: true },
];

const nav = [
  { icon: LayoutGrid, label: "Overview" },
  { icon: Megaphone, label: "Campaigns", active: true },
  { icon: Users, label: "Leads" },
  { icon: Briefcase, label: "Hiring" },
  { icon: BarChart3, label: "Analytics" },
];

const Pill = ({ status }) => (
  <span className={`inline-flex whitespace-nowrap rounded-chip px-1.5 py-0.5 text-[11px] font-semibold ${STATUS[status].cls}`}>
    {STATUS[status].label}
  </span>
);

const MockDashboard = () => (
  <div
    className="w-full cursor-default select-none overflow-hidden rounded-window bg-raasta-white font-display text-[12px] text-raasta-navy shadow-e3"
    role="img"
    aria-label="Raasta-AI campaign screen with sample data. Ayesha Rahman from Indus Cloud Labs accepted the invite two hours ago, after Raasta-AI read five of her posts and drafted a note. Below, six leads are shown as accepted, replied, invite sent, note drafted and queued. Nine of fifteen daily invites are used."
  >
    <div className="flex" aria-hidden="true">
      <aside className="hidden w-[176px] shrink-0 border-r border-raasta-line bg-raasta-white p-3 sm:block">
        <div className="mb-5 flex items-center gap-2 px-1">
          <BrandMark size={22} />
          <span className="text-[13px] font-extrabold tracking-[-0.01em]">Raasta-AI</span>
        </div>
        <ul className="space-y-0.5">
          {nav.map(({ icon: Icon, label, active }) => (
            <li
              key={label}
              className={`flex items-center gap-2 rounded-control px-2 py-1.5 ${
                active ? "bg-raasta-wash font-semibold text-raasta-cobaltDeep" : "text-raasta-slate"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </li>
          ))}
        </ul>
        <p className="mb-1 mt-6 px-2 text-[11px] font-semibold text-raasta-slate">Today&apos;s invites</p>
        <div className="px-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-raasta-line">
            <div className="h-full w-[60%] rounded-full bg-raasta-cobalt" />
          </div>
          <p className="mt-1.5 tabular-nums text-raasta-slate">9 of 15 used</p>
        </div>
      </aside>

      <div className="min-w-0 flex-1 p-4 sm:p-5">
        <p className="text-[11px] text-raasta-slate">Campaign: Lahore SaaS founders</p>
        <p className="mt-0.5 text-[17px] font-extrabold tracking-[-0.01em]">Ayesha Rahman</p>
        <p className="text-raasta-slate">Head of Growth, Indus Cloud Labs</p>

        <dl className="mt-4 grid grid-cols-2 overflow-hidden rounded-control border border-raasta-line md:grid-cols-4">
          {[
            ["Source", "LinkedIn"],
            ["City", "Lahore"],
            ["Invite", "Accepted"],
            ["Last activity", "2 hours ago"],
          ].map(([k, v], i) => (
            <div
              key={k}
              className={`border-raasta-line px-3 py-2 ${i % 2 === 0 ? "border-r" : "md:border-r"} ${
                i < 2 ? "border-b md:border-b-0" : ""
              } ${i === 3 ? "md:border-r-0" : ""}`}
            >
              <dt className="text-[11px] text-raasta-slate">{k}</dt>
              <dd className="mt-0.5 font-semibold">{v}</dd>
            </div>
          ))}
        </dl>

        <p className="mb-1.5 mt-4 font-bold">History</p>
        <ol className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-4">
          {timeline.map(({ icon: Icon, title, meta, done }) => (
            <li key={title} className="flex items-start gap-2 border-t border-raasta-line py-2">
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                  done ? "bg-raasta-successWash text-raasta-success" : "bg-raasta-wash text-raasta-cobaltDeep"
                }`}
              >
                {done ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold">{title}</span>
                <span className="block text-[11px] text-raasta-slate">{meta}</span>
              </span>
            </li>
          ))}
        </ol>

        <table className="mt-4 w-full table-fixed text-left">
          <thead className="text-[11px] text-raasta-slate">
            <tr className="border-b border-raasta-line">
              <th className="w-[34%] py-1.5 font-semibold sm:w-[22%]">Lead</th>
              <th className="hidden py-1.5 font-semibold md:table-cell">Company</th>
              <th className="hidden w-[14%] py-1.5 font-semibold sm:table-cell">Source</th>
              <th className="hidden py-1.5 font-semibold lg:table-cell">Last activity</th>
              <th className="w-[104px] py-1.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className={`border-b border-raasta-line/70 ${r.status === "accepted" ? "bg-raasta-mist" : ""}`}>
                <td className="truncate py-1.5 pl-1 font-semibold">{r.name}</td>
                <td className="hidden truncate py-1.5 text-raasta-slate md:table-cell">{r.company}</td>
                <td className="hidden truncate py-1.5 text-raasta-slate sm:table-cell">{r.source}</td>
                <td className="hidden truncate py-1.5 text-raasta-slate lg:table-cell">{r.activity}</td>
                <td className="py-1.5">
                  <Pill status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  </div>
);

export default MockDashboard;
