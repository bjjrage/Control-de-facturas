import type { ClimateEvent, ClimateEvidence, Project, ProjectWorkdayStatus, WeatherCode } from "@/lib/types";

export const LIBRO_LABELS: Record<WeatherCode, string> = { B: "Bueno / practicable", LL: "Lluvioso", HH: "Húmedo / encharcado", O: "Otra circunstancia" };
export function libroDecision(code: WeatherCode) {
  if (code === "B") return { classification: "WORKABLE" as const, reasonCode: null };
  if (code === "LL") return { classification: "NON_WORKABLE_RAIN" as const, reasonCode: null };
  return { classification: "NON_WORKABLE_OTHER" as const, reasonCode: code === "HH" ? "TERRAIN_SATURATED" as const : "OTHER" as const };
}
export function libroCode(day: ProjectWorkdayStatus): WeatherCode {
  if (day.classification === "WORKABLE") return "B";
  if (day.classification === "NON_WORKABLE_RAIN") return "LL";
  return day.reason_code === "TERRAIN_SATURATED" ? "HH" : "O";
}
export function libroMonths(project: Pick<Project, "start_date" | "orden_inicio_date" | "plazo_dias">, dates: string[], today: string) {
  const start = project.orden_inicio_date ?? project.start_date ?? today;
  const first = new Date(`${start}T00:00:00Z`);
  const months = new Map<string, { year: number; month: number }>();
  const add = (date: Date) => { const year = date.getUTCFullYear(), month = date.getUTCMonth(); months.set(`${year}-${String(month + 1).padStart(2, "0")}`, { year, month }); };
  for (let i = 0; i < Math.max(1, Math.min(24, Math.ceil((project.plazo_dias ?? 150) / 30) + 1)); i++) add(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i, 1)));
  // Actual canonical facts remain reachable even beyond the original contract period.
  for (const date of dates) add(new Date(`${date}T00:00:00Z`));
  return [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
}
export function libroDayFacts(date: string, events: ClimateEvent[], workdays: ProjectWorkdayStatus[], evidence: ClimateEvidence[]) {
  const day = workdays.find(row => row.work_date === date);
  const observations = events.filter(event => event.event_date === date);
  const ids = new Set(observations.map(event => event.id));
  const photos = evidence.filter(item => item.evidence_type === "RAIN_GAUGE_PHOTO" && ((item.climate_event_id && ids.has(item.climate_event_id)) || (day && item.workday_status_id === day.id)));
  return { day, final: day?.decision_status === "CONFIRMED" ? libroCode(day) : null, proposal: day?.decision_status === "PROPOSED" ? libroCode(day) : null, observations, photos, residentPhotos: photos.filter(photo => photo.metadata?.submitted_by_portal === true) };
}
