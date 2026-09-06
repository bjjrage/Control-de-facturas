import { cn } from "@/lib/cn";
import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

// Gradiente + brillo + el wrapper entero reacciona al hover (antes era un
// azul plano donde solo el texto cambiaba de intensidad, apenas visible).
// Exportado aparte porque un par de lugares usan un <Link> con look de
// botón primario en vez de <Button> — así no duplican el gradiente a mano.
export const primaryButtonClass =
  "text-white border-transparent bg-gradient-to-b from-[#7690fb] to-[#4a68e0] " +
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2px_6px_rgba(74,104,224,0.4)] " +
  "transition-all duration-150 " +
  "hover:from-[#869dfc] hover:to-[#5674e6] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_4px_14px_rgba(74,104,224,0.55)] hover:-translate-y-px " +
  "active:translate-y-0 active:from-[#4a68e0] active:to-[#3c58cc] active:shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]";

const variants: Record<Variant, string> = {
  primary: primaryButtonClass,
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
        "inline-flex items-center justify-center gap-1.5 rounded-md border px-3 h-8 text-[13px] font-medium transition-all duration-150 disabled:opacity-50 disabled:pointer-events-none",
        variants[variant],
        className
      )}
      {...props}
    />
  );
});
