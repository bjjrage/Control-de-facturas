"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CloudRain, FileImage, RefreshCw } from "lucide-react";
import { EditProjectDialog } from "./edit-project-dialog";
import { ClimateLibroCalendar } from "./climate-libro-calendar";
import { ContractClimateDialog } from "./contract-climate-dialog";
import { ExecutionLinkDialog } from "./execution-link-dialog";
import { isValidProjectCoords } from "@/lib/projects/location-fields";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import type { ClimateEvidence, ClimateEvent, ClimateReasonCode, Project, ProjectWorkdayClassification, ProjectWorkdayStatus } from "@/lib/types";
import { createClient } from "@/lib/supabase/browser";
import {
  addClimateEvidence,
  confirmWeatherWorkday,
  createRainEffectWorkday,
  evaluateProjectWeatherDayAction,
  overrideWeatherWorkday,
  saveWeatherCalendarDraft,
  updateLocalPrecipitation,
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

function localDateIso(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function safeFileName(name: string) {
  return name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "evidencia";
}

export function ClimateWorkdaysPanel({
  project,
  events,
  workdays,
  evidence,
  historicalOnly = false,
  appUrl = "",
}: {
  project: Project;
  events: ClimateEvent[];
  workdays: ProjectWorkdayStatus[];
  evidence: ClimateEvidence[];
  historicalOnly?: boolean;
  appUrl?: string;
}) {
  const router = useRouter();
  const today = localDateIso();
  const [date, setDate] = useState(() => project.start_date && (!historicalOnly || project.start_date <= today) ? project.start_date : today);
  const [effectDate, setEffectDate] = useState("");
  const [reason, setReason] = useState<ClimateReasonCode>("TERRAIN_SATURATED");
  const [parentId, setParentId] = useState<string | null>(null);
  const [overrideDraft, setOverrideDraft] = useState<{
    workdayId: string;
    classification: ProjectWorkdayClassification;
    reasonCode: ClimateReasonCode;
    notes: string;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [localMm, setLocalMm] = useState<Record<string, string>>({});
  const [transitionPending, startTransition] = useTransition();
  const [marking, setMarking] = useState(false);
  const pending = transitionPending || marking;
  const fileInputByEvent = useRef<Record<string, HTMLInputElement | null>>({});
  const eventById = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);
  const rows = useMemo(
    () => [...workdays].sort((a, b) => b.work_date.localeCompare(a.work_date)),
    [workdays],
  );

  const run = (action: () => Promise<{ error: string | null }>) => {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await action();
        setMessage(result.error ?? "Listo.");
        if (!result.error) router.refresh();
      } catch { setMessage("No se pudo guardar. Revisá los datos y reintentá."); }
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
      <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]"><span>{isValidProjectCoords(project.latitude,project.longitude)?"Ubicación climática configurada. La evaluación propone una jornada; una persona confirma el hecho.":"Configurá latitud y longitud para consultar evidencia meteorológica."}</span><EditProjectDialog project={project} focusLocation trigger={<Button size="sm" variant="secondary">Configurar ubicación</Button>}/></div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <CloudRain className="h-4 w-4 text-[var(--primary)]" />
            <h3 className="text-sm font-semibold">JORNADAS CLIMÁTICAS / LIBRO DE OBRA</h3>
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Umbral de propuesta automática: {project.precipitation_threshold_mm ?? 15} mm · fuente: {project.weather_source ?? "dmh-dinac"}. Las reglas del PBC se configuran por separado.
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">Evaluá una fecha por vez; las propuestas automáticas requieren confirmación humana.{historicalOnly ? " El Libro muestra fechas históricas, hasta hoy." : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label={historicalOnly ? "Fecha histórica a evaluar" : "Fecha a evaluar"} type="date" max={historicalOnly ? today : undefined} value={date} onChange={(event) => setDate(event.target.value)} className="h-8 w-auto text-xs" />
          <Button
            type="button"
            className="h-8 gap-1.5 text-xs"
            disabled={pending || !date || (historicalOnly && date > today) || !isValidProjectCoords(project.latitude,project.longitude)}
            onClick={() => run(async () => {
              const result = await evaluateProjectWeatherDayAction(project.id, date);
              return { error: result.error };
            })}
          >
            {pending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
            Evaluar clima
          </Button>
          <ExecutionLinkDialog appUrl={appUrl} token={project.execution_token} projectCode={project.code} triggerLabel="Link / QR para residente" />
          <ContractClimateDialog project={project} />
        </div>
      </div>

      {message ? <p className="text-xs text-[var(--muted)]" role="status">{message}</p> : null}

      <ClimateLibroCalendar project={project} events={events} workdays={workdays} evidence={evidence} pending={pending} onSelectDate={setDate}
        onSave={async entries => {
          setMarking(true);
          setMessage(null);
          try {
            return await saveWeatherCalendarDraft(project.id, entries);
          } catch (error) {
            // The response can be lost after commit; reload persisted facts for review.
            startTransition(() => router.refresh());
            throw error;
          } finally {
            setMarking(false);
          }
        }}
        onConfirm={workday => run(() => confirmWeatherWorkday(project.id, workday.id))}
        onPhoto={async photo => {
          if (!photo.storage_path) return;
          const result = await createClient().storage.from("execution-photos").createSignedUrl(photo.storage_path, 60);
          if (result.data) window.open(result.data.signedUrl, "_blank", "noopener,noreferrer");
          else setMessage("No se pudo abrir la foto.");
        }} />
      <details className="rounded-lg border border-[var(--border)] p-3">
        <summary className="cursor-pointer text-xs font-medium">Detalle avanzado · mediciones, evidencia y correcciones</summary>

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
                <th className="px-3 py-2">Clasificación</th>
                <th className="px-3 py-2">Fuente meteorológica</th>
                <th className="px-3 py-2 text-right">DMH mm</th>
                <th className="px-3 py-2 text-right">Pluviómetro mm</th>
                <th className="px-3 py-2">Decisión</th>
                <th className="px-3 py-2">Evidencia</th>
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
                        {workday.decision_status === "PROPOSED" ? "Propuesta · " : "Final · "}{CLASSIFICATION_LABEL[workday.classification]}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span>{event?.source ?? workday.source}</span>
                      {event?.external_station_name ? <span className="block text-[10px] text-[var(--muted)]">{event.external_station_name}</span> : null}
                      {event?.local_source ? <span className="block text-[10px] text-[var(--muted)]">Local: {event.local_source}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right">{event?.external_precipitation_mm ?? "—"}{event ? <span className="block text-[10px] text-[var(--muted)]">Umbral externo: {event.external_threshold_exceeded ? "alcanzado" : "no alcanzado"}</span> : null}</td>
                    <td className="px-3 py-2 text-right">
                      {event ? <div className="grid gap-1 text-left">
                        <label className="text-[10px] text-[var(--muted)]">Medición local<Input aria-label={`Medición local ${workday.work_date}`} type="number" min="0" max="999999.99" step="0.01" value={localMm[event.id] ?? String(event.local_precipitation_mm ?? "")} onChange={e => setLocalMm(current => ({ ...current, [event.id]: e.target.value }))} disabled={pending} className="h-7 w-24 text-xs" /></label>
                        <Button type="button" variant="secondary" className="h-7 text-[10px]" disabled={pending || (localMm[event.id] ?? String(event.local_precipitation_mm ?? "")) === ""} onClick={() => run(() => updateLocalPrecipitation(project.id, event.id, Number(localMm[event.id] ?? event.local_precipitation_mm)))}>Guardar medición</Button>
                        {rowEvidence.some(e => e.metadata?.submitted_by_portal === true) ? <span className="text-[10px] text-[var(--muted)]">Medición residente</span> : null}
                        <span className="text-[10px] text-[var(--muted)]">Umbral local: {event.local_threshold_exceeded ? "alcanzado" : "no alcanzado"}</span>
                      </div> : "—"}
                    </td>
                    <td className="px-3 py-2">{event?.status === "OVERRIDDEN" ? "Override" : workday.decision_status === "CONFIRMED" ? "Confirmada" : workday.proposed_automatically ? "Propuesta automática" : "Propuesta"}</td>
                    <td className="px-3 py-2">
                      {rowEvidence.map(item => <Button key={item.id} type="button" variant="ghost" className="h-7 text-[10px]" onClick={async () => {
                        if (!item.storage_path) return;
                        const result = await createClient().storage.from("execution-photos").createSignedUrl(item.storage_path, 60);
                        if (result.data) window.open(result.data.signedUrl, "_blank", "noopener,noreferrer");
                        else setMessage("No se pudo abrir la foto.");
                      }}>{item.evidence_type === "RAIN_GAUGE_PHOTO" ? "Foto pluviómetro" : "Evidencia"}{item.metadata?.submitted_by_portal === true ? " · residente" : ""}</Button>)}
                      {!rowEvidence.length ? "—" : null}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {workday.decision_status === "PROPOSED" ? (
                          <>
                            <Button type="button" variant="secondary" className="h-7 text-[11px]" disabled={pending} onClick={() => run(() => confirmWeatherWorkday(project.id, workday.id))}>
                              Confirmar
                            </Button>
                            <Button type="button" variant="secondary" className="h-7 text-[11px]" disabled={pending} onClick={() => setOverrideDraft({ workdayId: workday.id, classification: workday.classification === "NON_WORKABLE_RAIN_EFFECT" ? "WORKABLE" : workday.classification, reasonCode: workday.reason_code ?? "OTHER", notes: workday.notes ?? "" })}>
                              Corregir / Override
                            </Button>
                          </>
                        ) : null}
                        {event ? (
                          <>
                            <input
                              ref={(node) => { fileInputByEvent.current[event.id] = node; }}
                              type="file"
                              accept="image/*"
                              className="block h-7 w-44 text-[11px]"
                              aria-label={`Foto del pluviómetro ${workday.work_date}`}
                              onChange={(input) => {
                                const file = input.target.files?.[0];
                                if (file) uploadEvidence(event, workday, file);
                                input.currentTarget.value = "";
                              }}
                            />
                            <Button type="button" variant="secondary" className="h-7 gap-1 text-[11px]" disabled={pending} onClick={() => fileInputByEvent.current[event.id]?.click()}>
                              <FileImage className="h-3.5 w-3.5" /> Foto del pluviómetro
                            </Button>
                          </>
                        ) : null}
                        {canEffect ? (
                          <>
                            <Input aria-label={`Fecha efecto ${workday.work_date}`} type="date" value={parentId === workday.id ? effectDate : nextDay(workday.work_date)} onChange={(input) => { setParentId(workday.id); setEffectDate(input.target.value); }} className="h-7 w-auto text-[11px]" />
                            <Select disabled={pending} aria-label={`Causa efecto ${workday.work_date}`} value={parentId === workday.id ? reason : "TERRAIN_SATURATED"} onChange={(input) => { setParentId(workday.id); setReason(input.target.value as ClimateReasonCode); }} className="h-7 rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 text-[11px]">
                              {REASONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                            </Select>
                            <Button type="button" variant="secondary" className="h-7 text-[11px]" disabled={pending} onClick={() => run(() => createRainEffectWorkday(project.id, parentId === workday.id && effectDate ? effectDate : nextDay(workday.work_date), workday.id, parentId === workday.id ? reason : "TERRAIN_SATURATED"))}>
                              Marcar efecto
                            </Button>
                          </>
                        ) : null}
                        {overrideDraft?.workdayId === workday.id ? (
                          <div className="basis-full rounded border border-[var(--border)] bg-[var(--panel-2)] p-2">
                            <div className="flex flex-wrap items-end gap-2">
                              <label className="grid gap-1 text-[10px] text-[var(--muted)]">
                                Clasificación final
                                <Select disabled={pending} value={overrideDraft.classification} onChange={(input) => setOverrideDraft({ ...overrideDraft, classification: input.target.value as ProjectWorkdayClassification })} className="h-7 rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 text-[11px] text-[var(--foreground)]">
                                  <option value="WORKABLE">Trabajable</option>
                                  <option value="NON_WORKABLE_RAIN">Día de lluvia</option>
                                  <option value="NON_WORKABLE_OTHER">No trabajable por otra causa</option>
                                </Select>
                              </label>
                              {overrideDraft.classification === "NON_WORKABLE_OTHER" ? (
                                <label className="grid gap-1 text-[10px] text-[var(--muted)]">
                                  Causa
                                  <Select value={overrideDraft.reasonCode} onChange={(input) => setOverrideDraft({ ...overrideDraft, reasonCode: input.target.value as ClimateReasonCode })} className="h-7 rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 text-[11px] text-[var(--foreground)]">
                                    {REASONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                                  </Select>
                                </label>
                              ) : null}
                              <label className="grid min-w-44 flex-1 gap-1 text-[10px] text-[var(--muted)]">
                                Nota de la decisión
                                <Input value={overrideDraft.notes} onChange={(input) => setOverrideDraft({ ...overrideDraft, notes: input.target.value })} maxLength={500} className="h-7 text-[11px]" />
                              </label>
                              <Button type="button" className="h-7 text-[11px]" disabled={pending} onClick={() => run(async () => {
                                const result = await overrideWeatherWorkday(project.id, workday.id, {
                                  classification: overrideDraft.classification,
                                  reasonCode: overrideDraft.classification === "NON_WORKABLE_OTHER" ? overrideDraft.reasonCode : null,
                                  notes: overrideDraft.notes,
                                });
                                if (!result.error) setOverrideDraft(null);
                                return result;
                              })}>
                                Guardar override
                              </Button>
                              <Button type="button" variant="secondary" className="h-7 text-[11px]" disabled={pending} onClick={() => setOverrideDraft(null)}>Cancelar</Button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {events.filter(event => !workdays.some(day => day.climate_event_id === event.id)).map(event => <div key={event.id} className="flex flex-wrap items-end gap-2 rounded-lg border border-[var(--border)] p-3 text-xs">
        <div><p>{event.event_date} · {event.source}</p><p className="text-[var(--muted)]">Sin decisión contractual · DMH/DINAC: {event.external_precipitation_mm ?? "—"} mm</p></div>
        <label>Medición local<Input aria-label={`Medición local ${event.event_date}`} type="number" min="0" max="999999.99" step="0.01" value={localMm[event.id] ?? String(event.local_precipitation_mm ?? "")} onChange={e => setLocalMm(current => ({ ...current, [event.id]: e.target.value }))} className="h-7 w-24" /></label>
        <Button type="button" variant="secondary" disabled={pending || (localMm[event.id] ?? String(event.local_precipitation_mm ?? "")) === ""} className="h-7 text-xs" onClick={() => run(() => updateLocalPrecipitation(project.id, event.id, Number(localMm[event.id] ?? event.local_precipitation_mm)))}>Guardar medición</Button>
        <label className="text-[var(--muted)]">Foto del pluviómetro<input type="file" accept="image/jpeg,image/png,image/webp" disabled={pending} className="block max-w-48 text-xs" onChange={e => { const file = e.target.files?.[0]; if (file) uploadEvidence(event, undefined, file); e.currentTarget.value = ""; }} /></label>
      </div>)}
      </details>
    </section>
  );
}
