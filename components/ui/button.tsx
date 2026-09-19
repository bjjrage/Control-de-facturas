import { cn } from "@/lib/cn";
import { ButtonHTMLAttributes, forwardRef } from "react";

export type ButtonVariant = "primary" | "secondary" | "neutral" | "success" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const variants: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  neutral: "btn-neutral",
  success: "btn-success",
  danger: "btn-danger",
  ghost: "btn-ghost",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-2.5 text-[11px] rounded-lg",
  md: "h-9 px-3.5 text-[12px] rounded-xl",
  lg: "h-11 px-4.5 text-[13px] rounded-xl",
  icon: "h-8 w-8 p-0 rounded-lg",
};

export function buttonClassName({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}) {
  return cn(
    "btn-base inline-flex items-center justify-center gap-1.5 border font-medium whitespace-nowrap disabled:pointer-events-none",
    variants[variant],
    sizes[size],
    className
  );
}

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
  }
>(function Button({ className, variant = "primary", size = "md", ...props }, ref) {
  return (
    <button
      ref={ref}
      className={buttonClassName({ variant, size, className })}
      {...props}
    />
  );
});
