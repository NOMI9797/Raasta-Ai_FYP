import Link from "next/link";
import { Loader2 } from "lucide-react";

// One button system for the landing page.
//   primary     cobalt fill: the one main action in a viewport
//   secondary   white with a hairline border
//   tertiary    text link
//   destructive red text on white: cancel / remove, never confused with primary
//   outlineLight: secondary on navy
// Size: 44px (h-11) on the page. States: hover, pressed (scale), focus-visible ring,
// disabled, loading (spinner, aria-busy, label kept). No arrows appended to labels.

const base =
  "inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-control text-[16px] font-medium leading-none transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-raasta-cobalt focus-visible:ring-offset-2 focus-visible:ring-offset-raasta-mist disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100 aria-disabled:cursor-not-allowed aria-disabled:opacity-45";

const variants = {
  primary: "h-11 px-5 bg-raasta-cobalt text-raasta-white hover:bg-raasta-cobaltDeep active:bg-raasta-cobaltDeep",
  secondary:
    "h-11 px-5 border border-raasta-line bg-raasta-white text-raasta-navy hover:border-raasta-slate/50 active:bg-raasta-mist",
  tertiary:
    "h-11 px-1 text-raasta-cobalt underline-offset-[5px] hover:text-raasta-cobaltDeep hover:underline active:scale-100",
  // On navy
  outlineLight:
    "h-11 px-5 border border-raasta-white/40 text-raasta-white hover:border-raasta-white hover:bg-raasta-white/10 active:bg-raasta-white/15",
  destructive:
    "h-11 px-5 border border-raasta-danger/30 bg-raasta-white text-raasta-danger hover:bg-raasta-dangerWash active:bg-raasta-dangerWash",
};

export const buttonClass = ({ variant = "primary", className = "" } = {}) =>
  `${base} ${variants[variant]} ${className}`;

const Button = ({
  href,
  variant = "primary",
  loading = false,
  className = "",
  children,
  onClick,
  type = "button",
  disabled,
  ...rest
}) => {
  const cls = buttonClass({ variant, className });
  const content = (
    <>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </>
  );

  if (href) {
    if (href.startsWith("mailto:") || href.startsWith("http")) {
      return (
        <a href={href} className={cls} onClick={onClick} {...rest}>
          {content}
        </a>
      );
    }
    return (
      <Link href={href} className={cls} onClick={onClick} {...rest}>
        {content}
      </Link>
    );
  }

  return (
    <button
      type={type}
      onClick={onClick}
      className={cls}
      disabled={loading || disabled}
      aria-busy={loading || undefined}
      {...rest}
    >
      {content}
    </button>
  );
};

export default Button;
