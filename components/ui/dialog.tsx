"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { cn } from "@/lib/cn";

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

export function DialogContent({
  className,
  children,
  title,
  onCloseAutoFocus,
}: {
  className?: string;
  children: React.ReactNode;
  title: React.ReactNode;
  onCloseAutoFocus?: React.ComponentPropsWithoutRef<typeof RadixDialog.Content>["onCloseAutoFocus"];
}) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 bg-[#02060d]/72 backdrop-blur-sm z-40" />
      <RadixDialog.Content
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={(event) => {
          // Radix listens in capture phase, before the tooltip's own handler.
          // Let the first Escape close focused help; the next closes the dialog.
          if (event.target instanceof HTMLElement && event.target.closest(".erp-info-tooltip--open")) event.preventDefault();
        }}
        className={cn(
          "erp-card fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg rounded-2xl border border-white/[0.11] bg-[#0d1a2c]/95 p-5 shadow-[0_30px_90px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.045)] backdrop-blur-2xl max-h-[85vh] overflow-y-auto",
          className
        )}
      >
        <RadixDialog.Title className="text-[16px] tracking-[-0.015em] font-semibold mb-4">{title}</RadixDialog.Title>
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
