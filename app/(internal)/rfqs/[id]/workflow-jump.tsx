"use client";

import { Button } from "@/components/ui/button";

export function WorkflowJump({ targetId, children }: {
  targetId: string;
  children: React.ReactNode;
}) {
  return <Button type="button" onClick={() => {
    const target = document.getElementById(targetId);
    if (!target) return;
    if (target instanceof HTMLDetailsElement) target.open = true;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.focus({ preventScroll: true });
  }}>{children}</Button>;
}
