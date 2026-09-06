import { cn } from "@/lib/cn";
import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] border-transparent",
  secondary: "bg-[var(--panel-2)] text-[var(--foreground)] hover:bg-[var(--hover)] border-[var(--border)]",
  ghost: "bg-transparent text-[var(--foreground)] hover:bg-[var(--hover)] border-transparent",
  danger: "bg-[var(--panel-2)] text-[var(--error)] hover:bg-[var(--error-bg)] border-[var(--border)]",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }
>(function Button({ className, variant = "primary", ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md border px-3 h-8 text-[13px] font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none",
        variants[variant],
        className
      )}
      {...props}
    />
  );
});
