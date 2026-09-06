"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { addExecutionEntry, updateExecutionEntryPhotos } from "../actions";
import { createClient } from "@/lib/supabase/browser";
import { BudgetItem } from "@/lib/types";

const MAX_PHOTOS = 5;

// Las fotos de celular vienen de 4-8MB. Se redimensionan client-side a
// máximo 1600px de lado mayor y se comprimen a JPEG 0.8 antes de subir —
// no tiene sentido guardarlas al tamaño original.
async function compressImage(file: File, maxSize = 1600, quality = 0.8): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxSize || height > maxSize) {
        if (width > height) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("canvas no soportado")); return; }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) { reject(new Error("no se pudo comprimir la imagen")); return; }
          resolve(new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }));
        },
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("no se pudo leer la imagen")); };
    img.src = url;
  });
}

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
  const [photos, setPhotos] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [selectedItemId, setSelectedItemId] = useState("");
  const router = useRouter();
  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);

  const eligible = budgetItems.filter((i) => i.unit && i.quantity != null);
  const selectedItem = eligible.find((i) => i.id === selectedItemId) ?? null;

  async function handlePhotoSelect(files: FileList | null) {
    if (!files || files.length === 0) return;
    const remaining = MAX_PHOTOS - photos.length;
    const toAdd = Array.from(files).slice(0, remaining);
    if (toAdd.length === 0) return;

    try {
      const compressed = await Promise.all(toAdd.map((f) => compressImage(f)));
      setPhotos((prev) => [...prev, ...compressed]);
      setPreviews((prev) => [...prev, ...compressed.map((f) => URL.createObjectURL(f))]);
    } catch {
      setError("No se pudo procesar alguna foto. Probá con otra.");
    }
  }

  function removePhoto(idx: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
    setPreviews((prev) => {
      URL.revokeObjectURL(prev[idx]);
      return prev.filter((_, i) => i !== idx);
    });
  }

  function resetForm() {
    previews.forEach((p) => URL.revokeObjectURL(p));
    setPhotos([]);
    setPreviews([]);
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
        setPending(true);
        setError(null);
        const result = await addExecutionEntry(projectId, formData);
        if (result.error || !result.entryId) {
          setPending(false);
          setError(result.error);
          return;
        }

        // La entrada de avance ya está guardada acá. Si algo falla de acá en
        // adelante, el dato de ejecución no se pierde — solo las fotos.
        if (photos.length > 0) {
          const uploadedPaths: string[] = [];
          for (let i = 0; i < photos.length; i++) {
            setProgress(`Subiendo foto ${i + 1} de ${photos.length}…`);
            const path = `${projectId}/${result.entryId}/${i}.jpg`;
            const up = await supabase.storage
              .from("execution-photos")
              .upload(path, photos[i], { contentType: "image/jpeg" });
            if (!up.error) uploadedPaths.push(path);
          }
          if (uploadedPaths.length > 0) {
            await updateExecutionEntryPhotos(result.entryId, uploadedPaths);
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
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            disabled={photos.length >= MAX_PHOTOS}
            onChange={(e) => {
              handlePhotoSelect(e.target.files);
              e.target.value = "";
            }}
            className="w-full text-[12px] file:mr-3 file:rounded-md file:border file:border-[var(--border)] file:bg-[var(--panel)] file:px-3 file:py-1.5 file:text-[12px] file:cursor-pointer disabled:opacity-50"
          />
          {previews.length > 0 ? (
            <div className="flex gap-2 mt-2 flex-wrap">
              {previews.map((p, idx) => (
                <div key={idx} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p} alt="" className="h-16 w-16 object-cover rounded border border-[var(--border)]" />
                  <button
                    type="button"
                    onClick={() => removePhoto(idx)}
                    className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-[var(--error)] text-white text-[10px] flex items-center justify-center"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
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
