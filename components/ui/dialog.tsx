"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { cn } from "@/lib/cn";

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;

export function DialogContent({
  className,
  children,
  title,
}: {
  className?: string;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 bg-[#02060d]/72 backdrop-blur-sm z-40" />
      <RadixDialog.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg rounded-2xl border border-white/[0.11] bg-[#0d1a2c]/95 p-5 shadow-[0_30px_90px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.045)] backdrop-blur-2xl max-h-[85vh] overflow-y-auto",
          className
        )}
      >
        <RadixDialog.Title className="text-[16px] tracking-[-0.015em] font-semibold mb-4">{title}</RadixDialog.Title>
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
