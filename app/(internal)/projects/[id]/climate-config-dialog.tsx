"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import type { Project } from "@/lib/types";
import { updateProjectClimateConfig } from "../climate-actions";
import styles from "./climate-config.module.css";

export function ClimateConfigDialog({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return <Dialog open={open} onOpenChange={value => { if (!pending) { setOpen(value); setError(null); } }}>
    <DialogTrigger asChild><Button size="sm" variant="secondary"><Settings2 size={14} aria-hidden="true" />Configurar clima</Button></DialogTrigger>
    <DialogContent title={<span className="inline-flex items-center gap-1.5">Clima de la obra<InfoTooltip label="Clima de la obra" content="Usa la ubicación para consultar lluvia y preparar evidencia. No confirma jornadas ni modifica plazos; las reglas del PBC se configuran por separado." /></span>} className={styles.dialog}>
      <form className={styles.form} onSubmit={async event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setPending(true); setError(null);
        try {
          const result = await updateProjectClimateConfig(project.id, {
            latitude: Number(form.get("latitude")), longitude: Number(form.get("longitude")),
            weatherTrackingEnabled: form.get("tracking") === "on",
            precipitationThresholdMm: Number(form.get("threshold")),
            weatherSource: String(form.get("source")),
            weatherStationId: project.weather_station_id, weatherStationName: project.weather_station_name,
          });
          if (result.error) { setError(result.error); return; }
          setOpen(false); router.refresh();
        } catch { setError("No se pudo guardar la configuración. Reintentá."); }
        finally { setPending(false); }
      }}>
        <div className={styles.body}>
          <fieldset disabled={pending} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="climate-lat">Latitud</Label><Input id="climate-lat" name="latitude" type="number" step="any" min="-90" max="90" defaultValue={project.latitude ?? ""} required /></div>
              <div><Label htmlFor="climate-lon">Longitud</Label><Input id="climate-lon" name="longitude" type="number" step="any" min="-180" max="180" defaultValue={project.longitude ?? ""} required /></div>
            </div>
            <div><Label htmlFor="climate-source">Fuente meteorológica</Label><Select id="climate-source" name="source" defaultValue={project.weather_source ?? "dmh-dinac"}>
              <option value="dmh-dinac">DMH / DINAC, con respaldo Open-Meteo</option><option value="open-meteo">Open-Meteo (modelo meteorológico)</option>
            </Select></div>
            <div><div className="flex items-center gap-1"><Label htmlFor="climate-threshold">Umbral de lluvia (mm)</Label><InfoTooltip label="Umbral de lluvia" content="Las condiciones contractuales del PBC se configuran por separado." /></div><Input id="climate-threshold" name="threshold" type="number" min="0" step="any" defaultValue={project.precipitation_threshold_mm ?? 15} required /></div>
            <label className="flex items-center gap-2 text-sm"><input name="tracking" type="checkbox" defaultChecked={project.weather_tracking_enabled === true} />Activar seguimiento climático</label>
          </fieldset>
          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        </div>
        <footer className={styles.footer}><Button type="button" variant="secondary" disabled={pending} onClick={() => setOpen(false)}>Cancelar</Button><Button type="submit" disabled={pending}>{pending ? "Guardando…" : "Guardar configuración"}</Button></footer>
      </form>
    </DialogContent>
  </Dialog>;
}
