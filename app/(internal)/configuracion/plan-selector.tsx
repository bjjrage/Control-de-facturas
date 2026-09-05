"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateEmpresaPlan } from "./actions";
import { EmpresaPlan } from "@/lib/auth";

const PLANS: { value: EmpresaPlan; label: string; desc: string }[] = [
  { value: "basico", label: "Básico", desc: "Compras y ventas — el sistema actual" },
  { value: "pro", label: "Pro", desc: "Básico + gestión de proyectos de construcción" },
  { value: "caterpillar", label: "Caterpillar", desc: "Pro + partes diarios y subcontratistas" },
];

export function PlanSelector({ currentPlan }: { currentPlan: EmpresaPlan }) {
  const [plan, setPlan] = useState(currentPlan);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleChange(next: EmpresaPlan) {
    setPlan(next);
    setError(null);
    startTransition(async () => {
      const result = await updateEmpresaPlan(next);
      if (result.error) {
        setError(result.error);
        setPlan(currentPlan);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <h2 className="text-[15px] font-semibold">Plan del sistema</h2>
      <p className="text-[13px] text-[var(--muted)]">
        Cada plan suma funciones sobre el anterior — nunca saca las que ya tenías.
      </p>
      {error ? (
        <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
          {error}
        </div>
      ) : null}
      <div className="grid grid-cols-3 gap-2">
        {PLANS.map((p) => (
          <button
            key={p.value}
            type="button"
            disabled={pending}
            onClick={() => handleChange(p.value)}
            className={`text-left rounded-lg border p-3 transition-colors disabled:opacity-50 ${
              plan === p.value
                ? "border-[var(--primary)] bg-[var(--primary)]/5"
                : "border-[var(--border)] bg-[var(--panel)] hover:bg-[var(--hover)]"
            }`}
          >
            <div className="text-[13px] font-semibold">{p.label}</div>
            <div className="text-[11px] text-[var(--muted)] mt-0.5">{p.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
