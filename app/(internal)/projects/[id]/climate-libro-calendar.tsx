"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { climateToday } from "@/lib/procurement/climate-entry";
import { LIBRO_LABELS, libroCode, libroDayFacts, libroMonths } from "@/lib/procurement/climate-calendar";
import { selectClimateDate, stageClimateDraft, type ClimateDraft, type ClimateDraftEntry, type ClimateSelectionResult } from "@/lib/projects/climate-selection";
import styles from "./climate-libro-calendar.module.css";
import type { ClimateEvent, ClimateEvidence, Project, ProjectWorkdayStatus, WeatherCode } from "@/lib/types";

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const COLORS: Record<WeatherCode, string> = { B: "text-[var(--ok)]", LL: "text-[#b5d1ff]", HH: "text-[var(--warn)]", O: "text-[var(--foreground)]" };

export function ClimateLibroCalendar({ project, events, workdays, evidence, pending, onSelectDate, onSave, onConfirm, onPhoto }: {
  project: Project; events: ClimateEvent[]; workdays: ProjectWorkdayStatus[]; evidence: ClimateEvidence[]; pending: boolean;
  onSelectDate: (date: string) => void; onSave: (entries: ClimateDraftEntry[]) => Promise<ClimateSelectionResult>;
  onConfirm: (day: ProjectWorkdayStatus) => void; onPhoto: (photo: ClimateEvidence) => void;
}) {
  const today = climateToday();
  const [selected, setSelected] = useState<string[]>([]);
  const [additive, setAdditive] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [result, setResult] = useState<ClimateSelectionResult | null>(null);
  const [draft, setDraft] = useState<ClimateDraft>({});
  const [transitionPending, startTransition] = useTransition();
  const draftCount = Object.keys(draft).length;
  const busy = pending || saving || transitionPending;
  useEffect(() => {
    if (!draftCount) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [draftCount]);
  const months = libroMonths(project, [...events.map(event => event.event_date), ...workdays.map(day => day.work_date)], today);
  const confirmed = workdays.filter(day => day.decision_status === "CONFIRMED");
  const counts = (days: ProjectWorkdayStatus[]) => { const codes = days.map(libroCode); return { rain: codes.filter(code => code === "LL").length, humid: codes.filter(code => code === "HH").length, other: codes.filter(code => code === "O").length }; };
  const totals = counts(confirmed);
  const selectedDate = selected.length === 1 ? selected[0] : null;
  const selectedFacts = selectedDate ? libroDayFacts(selectedDate, events, workdays, evidence) : null;
  function markSelection(code: WeatherCode) {
    if (busy || !selected.length) return;
    setDraft(value => stageClimateDraft(value, selected, code));
    setSelected([]);
    setResult(null);
  }
  async function saveDraft() {
    if (busy || savingRef.current || !draftCount) return;
    savingRef.current = true;
    setSaving(true);
    setResult(null);
    const entries = Object.entries(draft).sort(([a], [b]) => a.localeCompare(b)).map(([date, code]) => ({ date, code }));
    try {
      const outcome = await onSave(entries);
      setResult(outcome);
      setDraft(value => {
        const remaining = { ...value };
        for (const date of outcome.saved) delete remaining[date];
        return remaining;
      });
      setSelected(outcome.failed.map(item => item.date));
    } catch {
      setResult({ saved: [], failed: entries.map(({ date }) => ({ date, error: "No se pudo completar. Revisá el estado de cada día antes de reintentar." })) });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  return <div className="space-y-3" data-testid="canonical-libro-calendar">
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs" aria-label="Totales del Libro confirmado">
      <span>Lluvia <strong>{totals.rain}</strong></span><span>Húmedos <strong>{totals.humid}</strong></span><span>Otros <strong>{totals.other}</strong></span><span>Total no trabajados <strong>{totals.rain + totals.humid + totals.other}</strong></span>
    </div>
    <p className="text-[11px] text-[var(--muted)]">Seleccioná días con clic o Ctrl + clic y asigná B, LL, HH u O. Armá todos los grupos y después pulsá Guardar cambios. Los tipos quedan en borrador hasta guardar.</p>
    <div className="flex flex-wrap gap-3 text-[11px]">{(Object.keys(LIBRO_LABELS) as WeatherCode[]).map(code => <span key={code}><strong className={COLORS[code]}>{code}</strong> · {LIBRO_LABELS[code]}</span>)}</div>
    <div className={styles.toolbar} aria-label="Marcar estado del Libro">
      <strong className="mr-2 text-xs" aria-live="polite">{selected.length} {selected.length === 1 ? "día seleccionado" : "días seleccionados"}</strong>
      {(Object.keys(LIBRO_LABELS) as WeatherCode[]).map(code => <button className={styles.typeButton} data-code={code} key={code} type="button" disabled={busy || !selected.length} onClick={() => markSelection(code)} aria-label={`Aplicar ${code} a días seleccionados`} title={`${LIBRO_LABELS[code]} · preparar sin guardar`}>{code}</button>)}
      <button className={styles.modeButton} type="button" disabled={busy} aria-label="Selección múltiple" aria-pressed={additive} onClick={() => setAdditive(value => !value)}>
        <span aria-hidden="true">{additive ? "✓" : "+"}</span> Selección múltiple <span className={styles.modeBadge}>{additive ? "ACTIVA" : "INACTIVA"}</span>
      </button>
      <button className={styles.clearButton} type="button" disabled={busy || !selected.length} onClick={() => setSelected([])}>Limpiar selección</button>
      <span className={styles.helper} aria-live="polite">{draftCount} {draftCount === 1 ? "cambio sin guardar" : "cambios sin guardar"}</span>
      <button className={styles.saveButton} type="button" disabled={busy || !draftCount} onClick={() => startTransition(() => saveDraft())}>Guardar cambios</button>
      <button className={styles.clearButton} type="button" disabled={busy || !draftCount} onClick={() => { setDraft({}); setSelected([]); setResult(null); }}>Descartar cambios</button>
      {saving ? <span className="text-xs" role="status">Guardando días…</span> : null}
    </div>
    {result ? <div className="text-xs" role="status">
      <p>{result.saved.length} {result.saved.length === 1 ? "día guardado" : "días guardados"} · {result.failed.length} {result.failed.length === 1 ? "día pendiente" : "días pendientes"}.</p>
      {result.error ? <p>{result.error}</p> : null}
      {result.failed.length ? <ul className="mt-1 list-disc pl-4">{result.failed.map(item => <li key={item.date}>{item.date}: {item.error}</li>)}</ul> : null}
    </div> : null}
    {selectedDate && selectedFacts ? <details key={selectedDate} className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-2 text-xs">
      <summary className="cursor-pointer">{selectedDate} · Libro: {selectedFacts.final ?? "sin decisión final"} · ver propuesta y evidencia</summary>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {selectedFacts.day?.decision_status === "PROPOSED" ? <><Button type="button" size="sm" disabled={busy || !!draft[selectedDate]} onClick={() => onConfirm(selectedFacts.day!)}>Confirmar sugerencia {selectedFacts.proposal}</Button><Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => markSelection("B")}>Marcar B en borrador</Button></> : null}
      </div>
      <div className="grid gap-2 text-[11px] sm:grid-cols-2">
        <div><strong>Meteorología</strong>{selectedFacts.observations.filter(event => event.external_precipitation_mm !== null && event.external_precipitation_mm !== undefined).map(event => <p key={event.id}>{event.source === "DMH_DINAC" ? "DMH/DINAC" : event.source} {event.external_precipitation_mm} mm{event.external_threshold_exceeded ? " · sugerencia LL" : ""}</p>)}{!selectedFacts.observations.some(event => event.external_precipitation_mm != null) ? <p className="text-[var(--muted)]">Sin observación externa.</p> : null}</div>
        <div><strong>Residente · evidencia, sin confirmación contractual</strong>{selectedFacts.residentPhotos.map(photo => <div key={photo.id} className="flex flex-wrap items-center gap-2"><span>Pluviómetro {String(photo.metadata?.precipitation_mm ?? selectedFacts.observations.find(event => event.id === photo.climate_event_id)?.local_precipitation_mm ?? "—")} mm</span><Button type="button" size="sm" variant="ghost" onClick={() => onPhoto(photo)}>Ver foto</Button></div>)}{!selectedFacts.residentPhotos.length ? <p className="text-[var(--muted)]">Sin reporte residente.</p> : null}</div>
      </div>
    </details> : null}
    <div className="grid gap-3 xl:grid-cols-2">{months.map(({ year, month }) => {
      const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
      const monthCounts = counts(confirmed.filter(day => day.work_date.startsWith(prefix)));
      const offset = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
      return <section key={prefix} className="min-w-0 rounded-lg border border-[var(--border)] p-3" aria-label={`${MONTHS[month]} ${year}`}>
        <header className="mb-2 flex flex-wrap justify-between gap-1 text-xs"><strong>{MONTHS[month]} {year}</strong><span className="text-[10px] text-[var(--muted)]">LL {monthCounts.rain} · HH {monthCounts.humid} · O {monthCounts.other} · Total {monthCounts.rain + monthCounts.humid + monthCounts.other}</span></header>
        <div className="grid grid-cols-7 gap-1">{["L", "M", "X", "J", "V", "S", "D"].map((label, index) => <span key={index} className="text-center text-[10px] text-[var(--muted)]">{label}</span>)}{Array.from({ length: offset }, (_, index) => <span key={`offset-${index}`} />)}
          {Array.from({ length: new Date(Date.UTC(year, month + 1, 0)).getUTCDate() }, (_, index) => {
            const date = `${prefix}-${String(index + 1).padStart(2, "0")}`;
            const facts = libroDayFacts(date, events, workdays, evidence);
            const outside = date > today || !!project.start_date && date < project.start_date;
            const external = facts.observations.find(event => event.external_precipitation_mm != null);
            const resident = facts.residentPhotos[0];
            const shownCode = draft[date] ?? facts.final;
            return <button key={date} type="button" data-testid={`libro-day-${date}`} data-code={shownCode ?? undefined} data-draft={!!draft[date]} aria-label={`Día ${date}`} aria-pressed={selected.includes(date)} disabled={busy || outside} onClick={event => { setSelected(value => selectClimateDate(value, date, additive || event.ctrlKey || event.metaKey)); onSelectDate(date); }} className={`${styles.day} min-w-0 rounded-md border p-1 text-left text-[10px] disabled:opacity-35`}>
              <span className="flex justify-between gap-1"><span>{index + 1}{selected.includes(date) ? <span aria-hidden="true" className="ml-1 font-bold text-white">✓</span> : null}</span><strong className={shownCode ? COLORS[shownCode] : "text-[var(--muted)]"}>{shownCode ?? "—"}</strong></span>
              <span className={`block truncate text-[9px] ${draft[date] ? styles.draftLabel : "text-[var(--muted)]"}`}>{draft[date] ? "Sin guardar" : facts.final ? "Final humano" : "Sin final"}</span>
              {facts.proposal ? <span className="block truncate text-[9px] text-[var(--warn)]">{facts.day?.proposed_automatically ? "Sugerencia" : "Propuesta"} {facts.proposal}</span> : null}
              {external ? <span className="block truncate text-[9px] text-[#b5d1ff]">{external.source === "DMH_DINAC" ? "DMH" : "Meteo"} {external.external_precipitation_mm} mm</span> : null}
              {resident ? <span className="block truncate text-[9px]">📷 {String(resident.metadata?.precipitation_mm ?? facts.observations.find(event => event.id === resident.climate_event_id)?.local_precipitation_mm ?? "—")} mm · Residente</span> : null}
            </button>;
          })}
        </div>
      </section>;
    })}</div>
  </div>;
}
