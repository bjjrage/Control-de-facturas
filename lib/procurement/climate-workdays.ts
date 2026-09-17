import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClimateEvent, Project, ProjectWorkdayStatus } from "@/lib/types";
import { createWeatherProvider, WEATHER_SOURCE, type DailyWeatherObservation, type WeatherProvider } from "./weather-provider";

export type EvaluateWeatherResult = {
  event: ClimateEvent;
  workday: ProjectWorkdayStatus | null;
  threshold_exceeded: boolean;
  preserved_confirmation: boolean;
  event_created: boolean;
  external_measurement_changed: boolean;
  proposal_created: boolean;
};

export function exceedsContractThreshold(precipitationMm: number, thresholdMm: number) {
  return precipitationMm >= thresholdMm;
}

/** Patch intencionalmente acotado a la medición externa: nunca incluye
 * local_precipitation_mm para no destruir una lectura del residente. */
export function externalClimateMeasurementPatch(
  project: Project,
  observation: DailyWeatherObservation,
  threshold: number,
  existing: ClimateEvent | null,
) {
  const exceeded = exceedsContractThreshold(observation.precipitation_mm, threshold);
  return {
    project_id: project.id,
    event_date: observation.date,
    source: observation.source,
    external_station_id: observation.station_id,
    external_station_name: observation.station_name,
    external_station_latitude: observation.coordinates?.latitude ?? null,
    external_station_longitude: observation.coordinates?.longitude ?? null,
    external_station_distance_km: observation.distance_km,
    external_observed_at: observation.observed_at,
    external_precipitation_mm: observation.precipitation_mm,
    contract_threshold_mm: threshold,
    external_threshold_exceeded: exceeded,
    threshold_exceeded: exceeded,
    provider_fallback_reason: observation.fallback_reason,
    raw_source_payload: observation.raw_payload,
    status: existing?.status ?? (exceeded ? "PROPOSED" : "OBSERVED"),
  };
}

type ClimateEventRow = ClimateEvent;
type WorkdayRow = ProjectWorkdayStatus;

function isDuplicate(error: { code?: string } | null) {
  return error?.code === "23505";
}

async function getProject(supabase: SupabaseClient, projectId: string): Promise<Project> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single<Project>();
  if (error || !data) throw new Error("Proyecto no encontrado o sin permisos.");
  return data;
}

async function getEvent(supabase: SupabaseClient, projectId: string, date: string) {
  const { data, error } = await supabase
    .from("climate_events")
    .select("*")
    .eq("project_id", projectId)
    .eq("event_date", date)
    .maybeSingle<ClimateEventRow>();
  if (error) throw new Error(error.message);
  return data ?? null;
}

async function getWorkday(supabase: SupabaseClient, projectId: string, date: string) {
  const { data, error } = await supabase
    .from("project_workday_status")
    .select("*")
    .eq("project_id", projectId)
    .eq("work_date", date)
    .maybeSingle<WorkdayRow>();
  if (error) throw new Error(error.message);
  return data ?? null;
}

function eventPatch(project: Project, observation: DailyWeatherObservation, threshold: number, existing: ClimateEvent | null) {
  // Never send local_precipitation_mm in an external ingestion patch. This
  // is what preserves the resident's gauge value across repeated jobs.
  return externalClimateMeasurementPatch(project, observation, threshold, existing);
}

function externalMeasurementChanged(existing: ClimateEvent | null, observation: DailyWeatherObservation) {
  if (!existing) return true;
  return existing.source !== observation.source
    || existing.external_station_id !== observation.station_id
    || existing.external_station_name !== observation.station_name
    || existing.external_precipitation_mm !== observation.precipitation_mm
    || existing.external_station_latitude !== (observation.coordinates?.latitude ?? null)
    || existing.external_station_longitude !== (observation.coordinates?.longitude ?? null)
    || existing.external_station_distance_km !== observation.distance_km
    || existing.external_observed_at !== observation.observed_at;
}

async function persistEvent(
  supabase: SupabaseClient,
  project: Project,
  observation: DailyWeatherObservation,
  threshold: number,
  existing: ClimateEvent | null,
) {
  const patch = eventPatch(project, observation, threshold, existing);
  const changed = externalMeasurementChanged(existing, observation);
  if (existing) {
    const { data, error } = await supabase
      .from("climate_events")
      .update(patch)
      .eq("id", existing.id)
      .select("*")
      .single<ClimateEventRow>();
    if (error || !data) throw new Error(error?.message ?? "No se pudo actualizar el evento climático.");
    return { data, created: false, changed };
  }

  const { data, error } = await supabase
    .from("climate_events")
    .insert(patch)
    .select("*")
    .single<ClimateEventRow>();
  if (!error && data) return { data, created: true, changed: true };
  if (!isDuplicate(error)) throw new Error(error?.message ?? "No se pudo crear el evento climático.");

  const concurrent = await getEvent(supabase, project.id, observation.date);
  if (!concurrent) throw new Error("El evento climático fue creado concurrentemente pero no pudo leerse.");
  return persistEvent(supabase, project, observation, threshold, concurrent);
}

export async function evaluateProjectWeatherDay(
  supabase: SupabaseClient,
  projectId: string,
  date: string,
  provider?: WeatherProvider,
): Promise<EvaluateWeatherResult> {
  const project = await getProject(supabase, projectId);
  if (project.weather_tracking_enabled === false) {
    throw new Error("El seguimiento climático está deshabilitado para esta obra.");
  }

  const weatherProvider = provider ?? createWeatherProvider(project.weather_source, project);
  const observation = await weatherProvider.getDailyWeather(project, date);
  const threshold = Number(project.precipitation_threshold_mm ?? 15);
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new Error("El umbral contractual de precipitación no es válido.");
  }

  const existingEvent = await getEvent(supabase, projectId, date);
  const persisted = await persistEvent(supabase, project, observation, threshold, existingEvent);
  const event = persisted.data;
  const existingWorkday = await getWorkday(supabase, projectId, date);

  if (!event.threshold_exceeded) {
    return {
      event,
      workday: existingWorkday,
      threshold_exceeded: false,
      preserved_confirmation: existingWorkday?.decision_status === "CONFIRMED",
      event_created: persisted.created,
      external_measurement_changed: persisted.changed,
      proposal_created: false,
    };
  }

  if (existingWorkday) {
    // A confirmed resident decision is authoritative. The provider may update
    // the event measurement, but never changes the effective classification.
    return {
      event,
      workday: existingWorkday,
      threshold_exceeded: true,
      preserved_confirmation: existingWorkday.decision_status === "CONFIRMED",
      event_created: persisted.created,
      external_measurement_changed: persisted.changed,
      proposal_created: false,
    };
  }

  const proposal = {
    project_id: projectId,
    work_date: date,
    classification: "NON_WORKABLE_RAIN",
    climate_event_id: event.id,
    notes: `Propuesta automática: ${observation.precipitation_mm.toFixed(2)} mm; umbral contractual ${threshold.toFixed(2)} mm.`,
    source: "AUTOMATIC",
    decision_status: "PROPOSED",
    proposed_automatically: true,
  };
  const { data: created, error } = await supabase
    .from("project_workday_status")
    .insert(proposal)
    .select("*")
    .single<WorkdayRow>();
  if (error && !isDuplicate(error)) throw new Error(error.message);
  const workday = created ?? (await getWorkday(supabase, projectId, date));
  if (!workday) throw new Error("No se pudo persistir la propuesta de jornada.");

  return {
    event,
    workday,
    threshold_exceeded: true,
    preserved_confirmation: false,
    event_created: persisted.created,
    external_measurement_changed: persisted.changed,
    proposal_created: !!created,
  };
}

export function localClimateMeasurementPatch(event: ClimateEvent, precipitationMm: number) {
  const threshold = event.contract_threshold_mm ?? 15;
  return {
    local_precipitation_mm: precipitationMm,
    local_threshold_exceeded: exceedsContractThreshold(precipitationMm, threshold),
    local_source: WEATHER_SOURCE.LOCAL_RAIN_GAUGE,
  };
}

export async function attachLocalPrecipitation(
  supabase: SupabaseClient,
  projectId: string,
  eventId: string,
  precipitationMm: number,
) {
  if (!Number.isFinite(precipitationMm) || precipitationMm < 0) {
    throw new Error("La precipitación local debe ser un número mayor o igual a cero.");
  }
  const { data: event, error: readError } = await supabase
    .from("climate_events")
    .select("*")
    .eq("id", eventId)
    .eq("project_id", projectId)
    .single<ClimateEvent>();
  if (readError || !event) throw new Error("Evento climático no encontrado.");

  const patch = localClimateMeasurementPatch(event, precipitationMm);
  const { data, error } = await supabase
    .from("climate_events")
    .update(patch)
    .eq("id", eventId)
    .eq("project_id", projectId)
    .select("*")
    .single<ClimateEvent>();
  if (error || !data) throw new Error(error?.message ?? "No se pudo guardar la medición local.");
  return data;
}
