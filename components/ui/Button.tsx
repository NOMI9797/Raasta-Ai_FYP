import { forwardRef, type ButtonHTMLAttributes } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

type ButtonVariant = "dark" | "light" | "primary";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  showArrow?: boolean;
}

const variants: Record<ButtonVariant, string> = {
  dark: "border-dark bg-dark text-on-dark",
  light: "border-border bg-surface text-ink",
  primary: "border-primary bg-primary text-on-primary",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, children, variant = "dark", showArrow = true, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      data-magnetic={variant === "dark" ? "" : undefined}
      className={cn(
        "magnetic-button group inline-flex h-11 items-center justify-center gap-3 rounded-full border px-5 text-sm font-medium",
        "transition-transform duration-150 ease-out hover:-translate-y-px",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        "disabled:pointer-events-none disabled:opacity-50 motion-reduce:transform-none motion-reduce:transition-none",
        variants[variant],
        className,
      )}
      {...props}
    >
      <span>{children}</span>
      {showArrow ? (
        <span
          aria-hidden="true"
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-full bg-primary text-on-primary",
            "transition-transform duration-150 ease-out group-hover:translate-x-0.5 motion-reduce:transform-none motion-reduce:transition-none",
            variant === "primary" && "bg-dark text-on-dark",
          )}
        >
          <ArrowRight size={13} strokeWidth={2} />
        </span>
      ) : null}
    </button>
  ),
);
Button.displayName = "Button";