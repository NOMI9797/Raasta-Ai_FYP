import { Linkedin, MessageCircle, Send, Zap } from "lucide-react";

const columns = [
  { title: "Product", links: ["Features", "Workflow", "Pricing", "FAQ"] },
  { title: "Resources", links: ["Guides", "Support"] },
  { title: "Legal", links: ["Terms of Service", "Privacy Policy"] },
] as const;

export function Footer() {
  return (
    <footer className="relative z-20 mx-4 mb-4 -mt-40 rounded-lg bg-dark p-6 text-on-dark sm:mx-6 sm:mb-6" data-testid="section-footer">
      <div className="grid gap-10 md:grid-cols-5">
        <div className="md:col-span-2">
          <div className="flex items-center gap-2 text-base font-semibold"><span className="grid size-8 place-items-center rounded-full bg-primary"><Zap className="size-4" fill="currentColor" /></span>Raasta-AI</div>
          <p className="mt-4 max-w-[380px] text-[13px] leading-[1.5] text-on-dark/60">AI-powered LinkedIn outreach and recruitment automation.</p>
        </div>
        {columns.map((column) => (
          <div key={column.title}>
            <h3 className="text-sm font-semibold">{column.title}</h3>
            <ul className="mt-4 space-y-3">{column.links.map((link) => <li key={link}><a className="footer-link text-sm text-on-dark/60" href={"#" + link.toLowerCase().replaceAll(" ", "-")}>{link}</a></li>)}</ul>
          </div>
        ))}
      </div>
      <div className="mt-10 flex flex-col gap-5 border-t border-on-dark/15 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] leading-[1.5] text-on-dark/60">{"\u00A9"} 2026 Raasta-AI. All rights reserved.</p>
        <div className="flex gap-2">
          {[Linkedin, MessageCircle, Send].map((Icon, index) => <span aria-hidden="true" className="grid size-9 place-items-center rounded-full border border-on-dark/15 text-on-dark/60" key={index}><Icon className="size-4" /></span>)}
        </div>
      </div>
    </footer>
  );
}

