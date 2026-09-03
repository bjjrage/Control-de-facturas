"use client";

import { useRouter } from "next/navigation";

export function BackButton({ label = "Atrás" }: { label?: string }) {
  const router = useRouter();
  return (
    <button type="button" onClick={() => router.back()} className="text-action text-[12px] text-[var(--muted)]">
      ← {label}
    </button>
  );
}
