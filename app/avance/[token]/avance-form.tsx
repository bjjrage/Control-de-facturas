"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { submitAvance } from "./actions";
import { CapturaVerificada, type VerifiedPhoto } from "@/components/captura-verificada";

const MAX_PHOTOS = 5;

type BudgetItem = { id: string; code: string; description: string; unit: string | null; quantity: number | null };

export function AvanceForm({ token, budgetItems }: { token: string; budgetItems: BudgetItem[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [photos, setPhotos] = useState<VerifiedPhoto[]>([]);
  const [formKey, setFormKey] = useState(0); // fuerza reset de los <input> nativos
  const [selectedItemId, setSelectedItemId] = useState("");
  const router = useRouter();
  // Guard síncrono contra doble click/tap — ver certificate-form.tsx, donde
  // este mismo hueco duplicó un envío en producción.
  const submittingRef = useRef(false);
  const today = new Date().toISOString().slice(0, 10);

  const selectedItem = budgetItems.find((i) => i.id === selectedItemId) ?? null;

  function resetForm() {
    setPhotos([]);
    setSelectedItemId("");
    setFormKey((k) => k + 1);
  }

  if (sent) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-[var(--ok)]/30 bg-[var(--ok-bg)] p-4 text-[13px] text-[var(--ok)]">
          Avance registrado.
        </div>
        <button
          type="button"
          onClick={() => { setSent(false); router.refresh(); }}
          className="w-full h-9 rounded-md border border-[var(--border)] bg-[var(--panel-2)] text-[13px] font-medium"
        >
          + Cargar otro avance
        </button>
      </div>
    );
  }

  return (
    <form
      key={formKey}
      className="space-y-3"
      action={async (formData: FormData) => {
        if (submittingRef.current) return;
        submittingRef.current = true;
        setPending(true);
        setError(null);
        photos.forEach((p) => formData.append("photos", p.blob, "foto.jpg"));
        formData.set(
          "photos_meta",
          JSON.stringify(
            photos.map((p) => ({
              capturedAt: p.capturedAt,
              lat: p.lat,
              lng: p.lng,
              accuracy: p.accuracy,
              source: p.source,
            }))
          )
        );
        const result = await submitAvance(token, formData);
        setPending(false);
        submittingRef.current = false;
        if (result.error) {
          setError(result.error);
          return;
        }
        resetForm();
        setSent(true);
      }}
    >
      {error ? (
        <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
          {error}
        </div>
      ) : null}
      <div>
        <label className="text-[12px] font-medium text-[var(--muted)] mb-1 block">Ítem del presupuesto</label>
        <select
          name="budget_item_id"
          required
          value={selectedItemId}
          onChange={(e) => setSelectedItemId(e.target.value)}
          className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px]"
        >
          <option value="">Seleccioná un ítem…</option>
          {budgetItems.map((i) => (
            <option key={i.id} value={i.id}>
              {i.code} — {i.description} ({i.unit})
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[12px] font-medium text-[var(--muted)] mb-1 block">
            Cantidad ejecutada{selectedItem?.unit ? ` (${selectedItem.unit})` : ""}
          </label>
          <input
            name="quantity_executed"
            type="number"
            step="any"
            min="0.001"
            required
            placeholder={selectedItem?.unit ? `en ${selectedItem.unit}` : undefined}
            className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px]"
          />
        </div>
        <div>
          <label className="text-[12px] font-medium text-[var(--muted)] mb-1 block">Fecha</label>
          <input
            name="entry_date"
            type="date"
            defaultValue={today}
            required
            className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px]"
          />
        </div>
      </div>
      <div>
        <label className="text-[12px] font-medium text-[var(--muted)] mb-1 block">Notas</label>
        <textarea
          name="notes"
          className="w-full rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-2 text-[13px] min-h-16"
        />
      </div>
      <div>
        <label className="text-[12px] font-medium text-[var(--muted)] mb-1 block">Fotos (máx. {MAX_PHOTOS})</label>
        <CapturaVerificada maxPhotos={MAX_PHOTOS} onChange={setPhotos} />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="btn-primary w-full h-9 rounded-md text-[13px] disabled:opacity-50"
      >
        {pending ? "Registrando…" : "Registrar avance"}
      </button>
    </form>
  );
}
