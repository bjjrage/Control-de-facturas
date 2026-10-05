import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClimateEvent, ProjectWorkdayClassification } from "@/lib/types";

export function climateToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function validClimateDate(date: string, start?: string | null, today = climateToday()) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0,10) === date && date <= today && (!start || date >= start);
}

/** The unique project/date key handles concurrent retries without overwriting external observations. */
export async function locateLocalClimateEvent(db: SupabaseClient, projectId: string, date: string, threshold: number) {
  const read = () => db.from("climate_events").select("*").eq("project_id", projectId).eq("event_date", date).maybeSingle<ClimateEvent>();
  const existing = await read();
  if (existing.error) throw new Error("No se pudo leer el evento climático.");
  if (existing.data) return existing.data;
  const created = await db.from("climate_events").insert({ project_id: projectId, event_date: date, source: "LOCAL_RAIN_GAUGE", local_source: "LOCAL_RAIN_GAUGE", contract_threshold_mm: threshold, status: "OBSERVED" }).select("*").single<ClimateEvent>();
  if (created.error?.code === "23505") {
    const concurrent = await read();
    if (concurrent.data) return concurrent.data;
  }
  if (created.error || !created.data) throw new Error("No se pudo crear el evento climático.");
  return created.data;
}

/** Public reports only propose. An existing human decision or automatic proposal is preserved. */
export async function proposeResidentWorkday(db: SupabaseClient, projectId: string, date: string, eventId: string, mm: number, threshold: number, notes: string | null) {
  const existing = await db.from("project_workday_status").select("id").eq("project_id", projectId).eq("work_date", date).maybeSingle();
  if (existing.error) throw new Error("No se pudo leer la jornada.");
  if (existing.data) return existing.data.id as string;
  const classification: ProjectWorkdayClassification = mm >= threshold ? "NON_WORKABLE_RAIN" : "WORKABLE";
  const result = await db.from("project_workday_status").insert({ project_id: projectId, work_date: date, climate_event_id: eventId, classification, source: "RESIDENT", decision_status: "PROPOSED", proposed_automatically: false, notes }).select("id").single();
  if (result.error?.code === "23505") {
    const concurrent = await db.from("project_workday_status").select("id").eq("project_id", projectId).eq("work_date", date).single();
    if (concurrent.data) return concurrent.data.id as string;
  }
  if (result.error || !result.data) throw new Error("No se pudo registrar la propuesta.");
  return result.data.id as string;
}
