"use client";

import { useRef, useState } from "react";
import { AvanceForm } from "./avance-form";
import { submitResidentRain } from "./actions";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { CapturaVerificada, type VerifiedPhoto } from "@/components/captura-verificada";
import { climateToday } from "@/lib/procurement/climate-entry";

type Item = { id: string; code: string; description: string; unit: string | null; quantity: number | null };
export function ResidentWorkflows({ token, budgetItems }: { token: string; budgetItems: Item[] }) {
  const [tab, setTab] = useState<"progress" | "rain">("progress");
  return <div className="space-y-4">
    <div className="segmented-control grid grid-cols-2 gap-1 p-1" role="group" aria-label="Registro del residente">
      <Button variant="ghost" className={`segmented-item ${tab === "progress" ? "segmented-item-active" : ""}`} aria-pressed={tab === "progress"} onClick={() => setTab("progress")}>Parte diario</Button>
      <Button variant="ghost" className={`segmented-item ${tab === "rain" ? "segmented-item-active" : ""}`} aria-pressed={tab === "rain"} onClick={() => setTab("rain")}>Registrar lluvia</Button>
    </div>
    <div hidden={tab !== "progress"}>{budgetItems.length ? <AvanceForm token={token} budgetItems={budgetItems} /> : <p className="text-xs text-[var(--muted)]">Cargá el presupuesto para reportar avance. Podés registrar lluvia desde la otra pestaña.</p>}</div>
    <div hidden={tab !== "rain"}><ResidentRainForm token={token} /></div>
  </div>;
}

export function ResidentRainForm({ token }: { token: string }) {
  const guard = useRef(false);
  const [pending, setPending] = useState(false);
  const [photos, setPhotos] = useState<VerifiedPhoto[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [key, setKey] = useState(0);
  return <form key={key} className="space-y-4" onSubmit={async e => {
    e.preventDefault();
    if (guard.current) return;
    guard.current = true;
    setMessage(null); setSent(false); setPending(true);
    const owner = e.currentTarget;
    try {
      if (photos.length !== 1) { setMessage("Adjuntá la foto del pluviómetro."); return; }
      const data = new FormData(owner);
      data.set("photo", photos[0].blob, "pluviometro.jpg");
      const result = await submitResidentRain(token, data);
      if (result.error) { setMessage(result.error); return; }
      setSent(true); setMessage("Medición y foto registradas. Pendiente de revisión humana.");
      setPhotos([]); setKey(k => k + 1);
    } catch { setMessage("No se pudo enviar. Reintentá el mismo reporte."); }
    finally { guard.current = false; setPending(false); }
  }}>
    <p className="text-xs text-[var(--muted)]">La medición aporta evidencia. La empresa confirma o corrige la jornada.</p>
    <div className="grid grid-cols-2 gap-3">
      <div><Label htmlFor="rain-date">Fecha</Label><Input id="rain-date" name="date" type="date" defaultValue={climateToday()} max={climateToday()} required disabled={pending} /></div>
      <div><Label htmlFor="rain-mm">Pluviómetro (mm)</Label><Input id="rain-mm" name="precipitation_mm" type="number" min="0" max="999999.99" step="0.01" required disabled={pending} /></div>
    </div>
    <div><Label>Foto del pluviómetro · obligatoria</Label><fieldset disabled={pending}><CapturaVerificada maxPhotos={1} onChange={setPhotos} /></fieldset></div>
    <div><Label htmlFor="rain-notes">Nota (opcional)</Label><Textarea id="rain-notes" name="notes" maxLength={500} disabled={pending} /></div>
    {message ? <p role={sent ? "status" : "alert"} className="text-xs">{message}</p> : null}
    <Button type="submit" className="w-full" disabled={pending || photos.length !== 1}>{pending ? "Guardando…" : "Enviar medición y foto"}</Button>
  </form>;
}
