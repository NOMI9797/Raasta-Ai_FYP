// Section heading: left-aligned, static. Inter Tight at weight 500 for display, Inter for body.
const headingBase =
  "text-balance font-display text-[30px] font-medium leading-[1.08] tracking-[-0.025em] md:text-[40px] md:leading-[1.05]";

export const headingClass = `${headingBase} text-raasta-navy`;
export const leadClass = "text-[17px] leading-[1.6] text-raasta-slate";

const SectionHeading = ({ title, sub, id, className = "", tone = "light", children }) => (
  <div className={`flex max-w-[640px] flex-col gap-5 ${className}`}>
    <h2 id={id} className={`${headingBase} ${tone === "dark" ? "text-raasta-white" : "text-raasta-navy"}`}>
      {title}
    </h2>
    {sub && (
      <p className={`max-w-[560px] text-[17px] leading-[1.6] ${tone === "dark" ? "text-raasta-white/80" : "text-raasta-slate"}`}>
        {sub}
      </p>
    )}
    {children}
  </div>
);

export default SectionHeading;
