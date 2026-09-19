import { cn } from "@/lib/cn";
import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "btn-primary",
  secondary: "bg-white/[0.045] text-[var(--foreground)] hover:bg-white/[0.075] border-white/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]",
  ghost: "bg-transparent text-[var(--foreground)] hover:bg-white/[0.055] border-transparent",
  danger: "bg-[var(--error-bg)]/70 text-[var(--error)] hover:bg-[var(--error-bg)] border-[var(--error)]/20",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }
>(function Button({ className, variant = "primary", ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-xl border px-3.5 h-9 text-[12px] font-medium transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none",
        variants[variant],
        className
      )}
      {...props}
    />
  );
});
