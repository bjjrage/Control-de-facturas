"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { climateToday } from "@/lib/procurement/climate-entry";
import { LIBRO_LABELS, libroCode, libroDayFacts, libroMonths } from "@/lib/procurement/climate-calendar";
import type { ClimateEvent, ClimateEvidence, Project, ProjectWorkdayStatus, WeatherCode } from "@/lib/types";

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const COLORS: Record<WeatherCode, string> = { B: "text-[var(--ok)]", LL: "text-[#b5d1ff]", HH: "text-[var(--warn)]", O: "text-[var(--foreground)]" };

export function ClimateLibroCalendar({ project, events, workdays, evidence, pending, onSelectDate, onMark, onConfirm, onIgnore, onPhoto }: {
  project: Project; events: ClimateEvent[]; workdays: ProjectWorkdayStatus[]; evidence: ClimateEvidence[]; pending: boolean;
  onSelectDate: (date: string) => void; onMark: (date: string, code: WeatherCode) => void;
  onConfirm: (day: ProjectWorkdayStatus) => void; onIgnore: (day: ProjectWorkdayStatus) => void; onPhoto: (photo: ClimateEvidence) => void;
}) {
  const today = climateToday();
  const [selected, setSelected] = useState<string | null>(null);
  const months = libroMonths(project, [...events.map(event => event.event_date), ...workdays.map(day => day.work_date)], today);
  const confirmed = workdays.filter(day => day.decision_status === "CONFIRMED");
  const counts = (days: ProjectWorkdayStatus[]) => { const codes = days.map(libroCode); return { rain: codes.filter(code => code === "LL").length, humid: codes.filter(code => code === "HH").length, other: codes.filter(code => code === "O").length }; };
  const totals = counts(confirmed);
  const selectedFacts = selected ? libroDayFacts(selected, events, workdays, evidence) : null;
  return <div className="space-y-3" data-testid="canonical-libro-calendar">
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs" aria-label="Totales del Libro confirmado">
      <span>Lluvia <strong>{totals.rain}</strong></span><span>Húmedos <strong>{totals.humid}</strong></span><span>Otros <strong>{totals.other}</strong></span><span>Total no trabajados <strong>{totals.rain + totals.humid + totals.other}</strong></span>
    </div>
    <p className="text-[11px] text-[var(--muted)]">Seleccioná un día y marcá B, LL, HH u O. El estado final lo decide una persona; meteorología y residente aportan evidencia.</p>
    <div className="flex flex-wrap gap-3 text-[11px]">{(Object.keys(LIBRO_LABELS) as WeatherCode[]).map(code => <span key={code}><strong className={COLORS[code]}>{code}</strong> · {LIBRO_LABELS[code]}</span>)}</div>
    {selected && selectedFacts ? <div className="rounded-lg border border-[var(--primary)]/40 bg-[var(--panel-2)] p-3 space-y-2" aria-label={`Detalle del día ${selected}`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-xs">{selected} · Libro: {selectedFacts.final ?? "sin decisión final"}{selectedFacts.final ? " · Confirmado por una persona" : ""}</strong><Button type="button" variant="ghost" size="sm" onClick={() => setSelected(null)}>Cerrar día</Button></div>
      <div className="flex flex-wrap items-center gap-2" aria-label="Marcar estado del Libro">{(Object.keys(LIBRO_LABELS) as WeatherCode[]).map(code => <Button key={code} type="button" size="sm" variant={selectedFacts.final === code ? "primary" : "secondary"} disabled={pending} onClick={() => onMark(selected, code)} aria-label={`Marcar ${code} ${selected}`} title={LIBRO_LABELS[code]}>{code}</Button>)}
        {selectedFacts.day?.decision_status === "PROPOSED" ? <><Button type="button" size="sm" disabled={pending} onClick={() => onConfirm(selectedFacts.day!)}>Confirmar sugerencia {selectedFacts.proposal}</Button><Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => onIgnore(selectedFacts.day!)}>Ignorar sugerencia · marcar B</Button></> : null}
      </div>
      <div className="grid gap-2 text-[11px] sm:grid-cols-2">
        <div><strong>Meteorología</strong>{selectedFacts.observations.filter(event => event.external_precipitation_mm !== null && event.external_precipitation_mm !== undefined).map(event => <p key={event.id}>{event.source === "DMH_DINAC" ? "DMH/DINAC" : event.source} {event.external_precipitation_mm} mm{event.external_threshold_exceeded ? " · sugerencia LL" : ""}</p>)}{!selectedFacts.observations.some(event => event.external_precipitation_mm != null) ? <p className="text-[var(--muted)]">Sin observación externa.</p> : null}</div>
        <div><strong>Residente · evidencia, sin confirmación contractual</strong>{selectedFacts.residentPhotos.map(photo => <div key={photo.id} className="flex flex-wrap items-center gap-2"><span>Pluviómetro {String(photo.metadata?.precipitation_mm ?? selectedFacts.observations.find(event => event.id === photo.climate_event_id)?.local_precipitation_mm ?? "—")} mm</span><Button type="button" size="sm" variant="ghost" onClick={() => onPhoto(photo)}>Ver foto</Button></div>)}{!selectedFacts.residentPhotos.length ? <p className="text-[var(--muted)]">Sin reporte residente.</p> : null}</div>
      </div>
    </div> : null}
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
            return <button key={date} type="button" aria-label={`Día ${date}`} aria-pressed={selected === date} disabled={pending || outside} onClick={() => { setSelected(date); onSelectDate(date); }} className={`min-w-0 rounded-md border p-1 text-left text-[10px] disabled:opacity-35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary)] ${selected === date ? "border-[var(--primary)] bg-[var(--hover)]" : "border-[var(--border)] bg-[var(--panel-2)]"}`}>
              <span className="flex justify-between gap-1"><span>{index + 1}</span><strong className={facts.final ? COLORS[facts.final] : "text-[var(--muted)]"}>{facts.final ?? "—"}</strong></span>
              <span className="block truncate text-[9px] text-[var(--muted)]">{facts.final ? "Final humano" : "Sin final"}</span>
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
