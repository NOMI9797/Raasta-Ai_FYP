import Link from "next/link";
import config from "@/config";
import BrandMark from "./BrandMark";

const Logo = ({ className = "", tone = "light" }) => (
  <Link
    href="/"
    className={`inline-flex min-h-11 items-center gap-2.5 rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-raasta-cobalt ${className}`}
    aria-label={`${config.appName} home`}
  >
    <BrandMark size={30} />
    <span className={`font-display text-[19px] font-medium tracking-[-0.02em] ${tone === "dark" ? "text-raasta-white" : "text-raasta-navy"}`}>{config.appName}</span>
  </Link>
);

export default Logo;
