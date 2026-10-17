"use client";

import { Select } from "@/components/ui/select";

import { useId, useState } from "react";
import { Label } from "@/components/ui/input";

export function PaymentTermsFields() {
  const id = useId();
  const [mode, setMode] = useState("");
  const [days, setDays] = useState("");
  const terms = mode === "CONTADO" ? "Contado" : mode === "CREDITO" && days ? `Crédito a ${days} días` : "";
  return <fieldset className="rounded-xl border border-white/15 bg-white/[0.03] p-4">
    <legend className="px-2 text-sm font-semibold">Condiciones de pago</legend>
    <input type="hidden" name="payment_terms" value={terms} />
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <Label htmlFor={`${id}-mode`}>Forma de pago</Label>
        <Select id={`${id}-mode`} value={mode} onChange={e => setMode(e.target.value)} required className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 text-sm">
          <option value="">Elegí una opción</option>
          <option value="CONTADO">Contado</option>
          <option value="CREDITO">Crédito</option>
        </Select>
      </div>
      {mode === "CREDITO" && <div>
        <Label htmlFor={`${id}-days`}>Plazo de crédito</Label>
        <Select id={`${id}-days`} value={days} onChange={e => setDays(e.target.value)} required className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 text-sm">
          <option value="">Elegí el plazo</option>
          {[30, 60, 90, 120, 160, 180].map(d => <option key={d} value={d}>{d} días</option>)}
        </Select>
      </div>}
    </div>
  </fieldset>;
}
