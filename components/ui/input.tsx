import { cn } from "@/lib/cn";
import { InputHTMLAttributes, forwardRef, TextareaHTMLAttributes } from "react";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-8 w-full rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px] outline-none focus:border-[var(--primary)] disabled:bg-[var(--hover)] disabled:text-[var(--muted)]",
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
        "w-full rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-2 text-[13px] outline-none focus:border-[var(--primary)] min-h-16",
        className
      )}
      {...props}
    />
  );
});

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("text-[12px] font-medium text-[var(--muted)] mb-1 block", className)}
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
        "h-8 w-full rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2 text-[13px] outline-none focus:border-[var(--primary)]",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
});
