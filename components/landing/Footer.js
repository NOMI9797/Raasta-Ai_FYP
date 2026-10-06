import Link from "next/link";
import Logo from "./Logo";
import config from "@/config";

// Blog is hidden until it has real posts.
const columns = [
  {
    title: "Product",
    links: [
      { label: "Client acquisition", href: "#workflow" },
      { label: "Hiring", href: "#hiring" },
      { label: "Pricing", href: "#pricing" },
      { label: "FAQ", href: "#faq" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy policy", href: "/privacy-policy" },
      { label: "Terms and conditions", href: "/tos" },
    ],
  },
];

const linkCls =
  "inline-flex min-h-11 items-center rounded-control text-[16px] text-raasta-white/70 transition-colors duration-150 hover:text-raasta-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-raasta-cobaltSoft";

const Footer = () => (
  <footer data-nav-theme="dark" className="border-t border-raasta-white/10 bg-raasta-navyDeep">
    <div className="mx-auto w-full max-w-[1200px] px-4 py-12 sm:px-6 md:py-16 lg:px-8">
      <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-4">
        <div className="col-span-2">
          <Logo tone="dark" />
          <p className="mt-4 max-w-[340px] text-[16px] leading-[1.6] text-raasta-white/70">
            The AI pipeline for client acquisition and hiring, built for small teams in Pakistan.
          </p>
          <a href={`mailto:${config.contactEmail}`} className={`${linkCls} mt-3 font-semibold !text-raasta-cobaltSoft hover:underline`}>
            {config.contactEmail}
          </a>
        </div>

        {columns.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <p className="font-display text-[15px] font-medium text-raasta-white">{col.title}</p>
            <ul className="mt-2">
              {col.links.map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className={linkCls}>
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="mt-12 flex flex-col gap-4 border-t border-raasta-white/10 pt-6 text-[14px] text-raasta-white/60 sm:flex-row sm:items-start sm:justify-between">
        <p>
          © {new Date().getFullYear()} {config.appName}. All rights reserved.
        </p>
        <p className="max-w-[440px] leading-[1.55] sm:text-right">
          LinkedIn, Rozee.pk and Indeed are trademarks of their owners. Their logos show supported sources, not a partnership.
        </p>
      </div>
    </div>
  </footer>
);

export default Footer;
