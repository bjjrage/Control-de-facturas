"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitAvance } from "./actions";

const MAX_PHOTOS = 5;

type BudgetItem = { id: string; code: string; description: string; unit: string | null; quantity: number | null };

// Copia de la compresión usada en el formulario interno (add-execution-entry-form.tsx)
// — mismo criterio: fotos de celular de 4-8MB no tiene sentido subirlas enteras.
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

export function AvanceForm({ token, budgetItems }: { token: string; budgetItems: BudgetItem[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [formKey, setFormKey] = useState(0); // fuerza reset de los <input> nativos
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);

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
        setPending(true);
        setError(null);
        photos.forEach((p) => formData.append("photos", p));
        const result = await submitAvance(token, formData);
        setPending(false);
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
          <label className="text-[12px] font-medium text-[var(--muted)] mb-1 block">Cantidad ejecutada</label>
          <input
            name="quantity_executed"
            type="number"
            step="any"
            min="0.001"
            required
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
      <button
        type="submit"
        disabled={pending}
        className="w-full h-9 rounded-md bg-[var(--primary)] text-white text-[13px] font-medium disabled:opacity-50"
      >
        {pending ? "Registrando…" : "Registrar avance"}
      </button>
    </form>
  );
}
