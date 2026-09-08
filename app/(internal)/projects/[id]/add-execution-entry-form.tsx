"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { addExecutionEntry, updateExecutionEntryPhotos } from "../actions";
import { createClient } from "@/lib/supabase/browser";
import { BudgetItem } from "@/lib/types";
import { CapturaVerificada, type VerifiedPhoto } from "@/components/captura-verificada";

const MAX_PHOTOS = 5;

export function AddExecutionEntryForm({
  projectId,
  budgetItems,
}: {
  projectId: string;
  budgetItems: BudgetItem[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [photos, setPhotos] = useState<VerifiedPhoto[]>([]);
  const [selectedItemId, setSelectedItemId] = useState("");
  const router = useRouter();
  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);
  const submittingRef = useRef(false);

  const eligible = budgetItems.filter((i) => i.unit && i.quantity != null);
  const selectedItem = eligible.find((i) => i.id === selectedItemId) ?? null;

  function resetForm() {
    setPhotos([]);
    setProgress(null);
    setSelectedItemId("");
    setOpen(false);
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)} disabled={eligible.length === 0}>
        + Registrar avance
      </Button>
    );
  }

  return (
    <form
      className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3 space-y-3"
      action={async (formData: FormData) => {
        if (submittingRef.current) return;
        submittingRef.current = true;
        setPending(true);
        setError(null);
        const result = await addExecutionEntry(projectId, formData);
        if (result.error || !result.entryId) {
          setPending(false);
          submittingRef.current = false;
          setError(result.error);
          return;
        }

        // La entrada de avance ya está guardada acá. Si algo falla de acá en
        // adelante, el dato de ejecución no se pierde — solo las fotos.
        if (photos.length > 0) {
          const uploaded: {
            path: string;
            capturedAt: string;
            lat: number | null;
            lng: number | null;
            accuracy: number | null;
            source: "camara" | "archivo";
          }[] = [];
          for (let i = 0; i < photos.length; i++) {
            setProgress(`Subiendo foto ${i + 1} de ${photos.length}…`);
            const path = `${projectId}/${result.entryId}/${i}.jpg`;
            const up = await supabase.storage
              .from("execution-photos")
              .upload(path, photos[i].blob, { contentType: "image/jpeg" });
            if (!up.error) {
              uploaded.push({
                path,
                capturedAt: photos[i].capturedAt,
                lat: photos[i].lat,
                lng: photos[i].lng,
                accuracy: photos[i].accuracy,
                source: photos[i].source,
              });
            }
          }
          if (uploaded.length > 0) {
            await updateExecutionEntryPhotos(result.entryId, uploaded);
          }
        }

        setPending(false);
        resetForm();
        router.refresh();
      }}
    >
      {error ? (
        <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
          {error}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label htmlFor="ee_item">Ítem del presupuesto</Label>
          <Select
            id="ee_item"
            name="budget_item_id"
            required
            value={selectedItemId}
            onChange={(e) => setSelectedItemId((e.target as HTMLSelectElement).value)}
          >
            <option value="">Seleccioná un ítem…</option>
            {eligible.map((i) => (
              <option key={i.id} value={i.id}>
                {i.code} — {i.description} ({i.unit})
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="ee_qty">Cantidad ejecutada{selectedItem?.unit ? ` (${selectedItem.unit})` : ""}</Label>
          <Input
            id="ee_qty"
            name="quantity_executed"
            type="number"
            step="any"
            min="0.001"
            required
            placeholder={selectedItem?.unit ? `en ${selectedItem.unit}` : undefined}
          />
        </div>
        <div>
          <Label htmlFor="ee_date">Fecha</Label>
          <Input id="ee_date" name="entry_date" type="date" defaultValue={today} required />
        </div>
        <div className="col-span-2">
          <Label htmlFor="ee_notes">Notas</Label>
          <Textarea id="ee_notes" name="notes" />
        </div>
        <div className="col-span-2">
          <Label>Fotos (máx. {MAX_PHOTOS})</Label>
          <CapturaVerificada maxPhotos={MAX_PHOTOS} onChange={setPhotos} />
        </div>
      </div>
      {progress ? <p className="text-[11px] text-[var(--muted)]">{progress}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={resetForm} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Registrando…" : "Registrar"}
        </Button>
      </div>
    </form>
  );
}
