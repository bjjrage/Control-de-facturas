import { cn } from "@/lib/cn";
import { InputHTMLAttributes, forwardRef, TextareaHTMLAttributes } from "react";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-9 w-full rounded-lg border border-white/[0.09] bg-white/[0.035] px-3 text-[12px] outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] transition-all focus:border-[var(--primary)]/70 focus:bg-white/[0.05] focus:ring-2 focus:ring-[var(--primary)]/10 disabled:bg-[var(--hover)] disabled:text-[var(--muted)]",
          className
        )}
        {...props}
      />
    );
  }
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-lg border border-white/[0.09] bg-white/[0.035] px-3 py-2.5 text-[12px] outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] transition-all focus:border-[var(--primary)]/70 focus:bg-white/[0.05] focus:ring-2 focus:ring-[var(--primary)]/10 min-h-20",
        className
      )}
      {...props}
    />
  );
});

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("text-[11px] font-medium text-[#8fa2bf] mb-1.5 block", className)}
      {...props}
    />
  );
}

export const Select = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        "h-9 w-full rounded-lg border border-white/[0.09] bg-white/[0.035] px-3 text-[12px] outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] transition-all focus:border-[var(--primary)]/70 focus:bg-white/[0.05] focus:ring-2 focus:ring-[var(--primary)]/10",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
});
