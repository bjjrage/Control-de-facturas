"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CloudRain, FileImage, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ClimateEvidence, ClimateEvent, ClimateReasonCode, Project, ProjectWorkdayStatus } from "@/lib/types";
import { createClient } from "@/lib/supabase/browser";
import {
  addClimateEvidence,
  confirmWeatherWorkday,
  createRainEffectWorkday,
  evaluateProjectWeatherDayAction,
} from "../climate-actions";

const REASONS: { value: ClimateReasonCode; label: string }[] = [
  { value: "TERRAIN_SATURATED", label: "Terreno saturado" },
  { value: "ACCESS_BLOCKED", label: "Acceso bloqueado" },
  { value: "FLOODED_EXCAVATION", label: "Excavación anegada" },
  { value: "UNSAFE_CONDITIONS", label: "Condiciones inseguras" },
  { value: "MATERIAL_IMPACT", label: "Impacto en materiales" },
  { value: "OTHER", label: "Otra causa" },
];

const CLASSIFICATION_LABEL: Record<ProjectWorkdayStatus["classification"], string> = {
  WORKABLE: "Trabajable",
  NON_WORKABLE_RAIN: "Día de lluvia",
  NON_WORKABLE_RAIN_EFFECT: "Efecto de lluvia",
  NON_WORKABLE_OTHER: "No trabajable",
};

function nextDay(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function safeFileName(name: string) {
  return name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "evidencia";
}

export function ClimateWorkdaysPanel({
  project,
  events,
  workdays,
  evidence,
}: {
  project: Project;
  events: ClimateEvent[];
  workdays: ProjectWorkdayStatus[];
  evidence: ClimateEvidence[];
}) {
  const router = useRouter();
  const [date, setDate] = useState(project.start_date ?? new Date().toISOString().slice(0, 10));
  const [effectDate, setEffectDate] = useState("");
  const [reason, setReason] = useState<ClimateReasonCode>("TERRAIN_SATURATED");
  const [parentId, setParentId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInputByEvent = useRef<Record<string, HTMLInputElement | null>>({});
  const eventById = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);
  const rows = useMemo(
    () => [...workdays].sort((a, b) => b.work_date.localeCompare(a.work_date)),
    [workdays],
  );

  const run = (action: () => Promise<{ error: string | null }>) => {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage(result.error ?? "Listo.");
      if (!result.error) router.refresh();
    });
  };

  const uploadEvidence = (event: ClimateEvent, workday: ProjectWorkdayStatus | undefined, file: File) => {
    setMessage(null);
    startTransition(async () => {
      const fileName = safeFileName(file.name);
      const path = `${project.id}/climate/${event.event_date}/${crypto.randomUUID()}-${fileName}`;
      const supabase = createClient();
      const upload = await supabase.storage.from("execution-photos").upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (upload.error) {
        setMessage(`No se pudo subir la evidencia: ${upload.error.message}`);
        return;
      }
      const result = await addClimateEvidence({
        projectId: project.id,
        climateEventId: event.id,
        workdayStatusId: workday?.id ?? null,
        evidenceType: "RAIN_GAUGE_PHOTO",
        storagePath: path,
        fileName: file.name,
        mimeType: file.type || null,
        sizeBytes: file.size,
      });
      setMessage(result.error ?? "Evidencia adjuntada.");
      if (!result.error) router.refresh();
    });
  };

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 space-y-4" aria-label="Climate Workdays">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <CloudRain className="h-4 w-4 text-blue-600" />
            <h3 className="text-sm font-semibold">Climate Workdays</h3>
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Umbral contractual: {project.precipitation_threshold_mm ?? 15} mm · fuente: {project.weather_source ?? "dmh-dinac"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label="Fecha a evaluar" type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-8 w-auto text-xs" />
          <Button
            type="button"
            className="h-8 gap-1.5 text-xs"
            disabled={pending || !date}
            onClick={() => run(async () => {
              const result = await evaluateProjectWeatherDayAction(project.id, date);
              return { error: result.error };
            })}
          >
            {pending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
            Evaluar clima
          </Button>
        </div>
      </div>

      {message ? <p className="text-xs text-[var(--muted)]" role="status">{message}</p> : null}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--border)] p-4 text-xs text-[var(--muted)]">
          Todavía no hay jornadas climáticas registradas.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-[var(--panel-2)] text-[var(--muted)]">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 text-right">DMH mm</th>
                <th className="px-3 py-2 text-right">Pluviómetro mm</th>
                <th className="px-3 py-2">Decisión</th>
                <th className="px-3 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {rows.map((workday) => {
                const event = workday.climate_event_id ? eventById.get(workday.climate_event_id) : undefined;
                const rowEvidence = evidence.filter((item) => item.workday_status_id === workday.id || item.climate_event_id === event?.id);
                const canEffect = workday.classification === "NON_WORKABLE_RAIN" && workday.decision_status === "CONFIRMED";
                return (
                  <tr key={workday.id}>
                    <td className="px-3 py-2 font-mono">{workday.work_date}</td>
                    <td className="px-3 py-2">
                      <span className={workday.classification === "NON_WORKABLE_RAIN" ? "text-blue-700 dark:text-blue-300" : "text-[var(--foreground)]"}>
                        {CLASSIFICATION_LABEL[workday.classification]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">{event?.external_precipitation_mm ?? "—"}</td>
                    <td className="px-3 py-2 text-right">{event?.local_precipitation_mm ?? "—"}</td>
                    <td className="px-3 py-2">{workday.decision_status === "CONFIRMED" ? "Confirmada" : "Propuesta"}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {workday.decision_status === "PROPOSED" ? (
                          <Button type="button" variant="secondary" className="h-7 text-[11px]" disabled={pending} onClick={() => run(() => confirmWeatherWorkday(project.id, workday.id))}>
                            Confirmar
                          </Button>
                        ) : null}
                        {event ? (
                          <>
                            <input
                              ref={(node) => { fileInputByEvent.current[event.id] = node; }}
                              type="file"
                              accept="image/*"
                              className="block h-7 w-44 text-[11px]"
                              aria-label={`Adjuntar evidencia ${workday.work_date}`}
                              onChange={(input) => {
                                const file = input.target.files?.[0];
                                if (file) uploadEvidence(event, workday, file);
                                input.currentTarget.value = "";
                              }}
                            />
                            <Button type="button" variant="secondary" className="h-7 gap-1 text-[11px]" disabled={pending} onClick={() => fileInputByEvent.current[event.id]?.click()}>
                              <FileImage className="h-3.5 w-3.5" /> Evidencia
                            </Button>
                          </>
                        ) : null}
                        {canEffect ? (
                          <>
                            <Input aria-label={`Fecha efecto ${workday.work_date}`} type="date" value={parentId === workday.id ? effectDate : nextDay(workday.work_date)} onChange={(input) => { setParentId(workday.id); setEffectDate(input.target.value); }} className="h-7 w-auto text-[11px]" />
                            <select aria-label={`Causa efecto ${workday.work_date}`} value={parentId === workday.id ? reason : "TERRAIN_SATURATED"} onChange={(input) => { setParentId(workday.id); setReason(input.target.value as ClimateReasonCode); }} className="h-7 rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 text-[11px]">
                              {REASONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                            </select>
                            <Button type="button" variant="secondary" className="h-7 text-[11px]" disabled={pending} onClick={() => run(() => createRainEffectWorkday(project.id, parentId === workday.id && effectDate ? effectDate : nextDay(workday.work_date), workday.id, parentId === workday.id ? reason : "TERRAIN_SATURATED"))}>
                              Marcar efecto
                            </Button>
                          </>
                        ) : null}
                        {rowEvidence.length > 0 ? <span className="text-[var(--muted)]">{rowEvidence.length} evidencia(s)</span> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
