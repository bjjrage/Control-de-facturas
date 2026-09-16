"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePlan } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import type {
  ClimateEvidenceType,
  ClimateReasonCode,
  ProjectWorkdayClassification,
} from "@/lib/types";
import {
  attachLocalPrecipitation,
  evaluateProjectWeatherDay,
} from "@/lib/procurement/climate-workdays";

const CLASSIFICATIONS: ProjectWorkdayClassification[] = [
  "WORKABLE",
  "NON_WORKABLE_RAIN",
  "NON_WORKABLE_RAIN_EFFECT",
  "NON_WORKABLE_OTHER",
];
const REASONS: ClimateReasonCode[] = [
  "TERRAIN_SATURATED",
  "ACCESS_BLOCKED",
  "FLOODED_EXCAVATION",
  "UNSAFE_CONDITIONS",
  "MATERIAL_IMPACT",
  "OTHER",
];
const EVIDENCE_TYPES: ClimateEvidenceType[] = [
  "RAIN_GAUGE_PHOTO",
  "SITE_CONDITION_PHOTO",
  "WEATHER_SOURCE",
  "RESIDENT_NOTE",
  "OTHER",
];

async function ownedProject(projectId: string, empresaId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("empresa_id", empresaId)
    .single();
  return { supabase, exists: !!data };
}

export async function updateProjectClimateConfig(
  projectId: string,
  input: {
    precipitationThresholdMm: number;
    weatherTrackingEnabled: boolean;
    weatherStationId?: string | null;
    weatherStationName?: string | null;
    weatherSource?: string;
  },
): Promise<{ error: string | null }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const { supabase, exists } = await ownedProject(projectId, profile.empresa_id);
  if (!exists) return { error: "Proyecto no encontrado." };
  if (!Number.isFinite(input.precipitationThresholdMm) || input.precipitationThresholdMm < 0) {
    return { error: "El umbral debe ser un número mayor o igual a cero." };
  }
  const weatherSource = (input.weatherSource ?? "dmh-dinac").trim().toLowerCase();
  if (!weatherSource) return { error: "El proveedor meteorológico es obligatorio." };

  const { error } = await supabase
    .from("projects")
    .update({
      precipitation_threshold_mm: input.precipitationThresholdMm,
      weather_tracking_enabled: input.weatherTrackingEnabled,
      weather_station_id: input.weatherStationId?.trim() || null,
      weather_station_name: input.weatherStationName?.trim() || null,
      weather_source: weatherSource,
    })
    .eq("id", projectId)
    .eq("empresa_id", profile.empresa_id);
  if (error) return { error: "No se pudo guardar la configuración climática." };

  await logAudit(supabase, {
    action: "project.climate_config_updated",
    detail: { project_id: projectId, threshold_mm: input.precipitationThresholdMm, source: weatherSource },
  });
  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

export async function evaluateProjectWeatherDayAction(
  projectId: string,
  date: string,
): Promise<{ error: string | null; thresholdExceeded: boolean }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const { supabase, exists } = await ownedProject(projectId, profile.empresa_id);
  if (!exists) return { error: "Proyecto no encontrado.", thresholdExceeded: false };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: "La fecha no es válida.", thresholdExceeded: false };
  }

  try {
    const result = await evaluateProjectWeatherDay(supabase, projectId, date);
    if (result.proposal_created || result.event_created || result.external_measurement_changed) {
      await logAudit(supabase, {
        action: result.proposal_created
          ? "rain_day_proposed"
          : result.event_created
            ? "climate_event_created"
            : "climate_event_measurement_updated",
        detail: {
          project_id: projectId,
          event_id: result.event.id,
          workday_status_id: result.workday?.id ?? null,
          date,
          external_precipitation_mm: result.event.external_precipitation_mm,
          threshold_mm: result.event.contract_threshold_mm,
          source: result.event.source,
          station_id: result.event.external_station_id,
          station_name: result.event.external_station_name,
          station_distance_km: result.event.external_station_distance_km,
          provider_fallback_reason: result.event.provider_fallback_reason,
          preserved_confirmation: result.preserved_confirmation,
        },
      });
    }
    revalidatePath(`/projects/${projectId}`);
    return { error: null, thresholdExceeded: result.threshold_exceeded };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No se pudo evaluar el clima." , thresholdExceeded: false };
  }
}

export async function confirmWeatherWorkday(
  projectId: string,
  workdayId: string,
): Promise<{ error: string | null }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const { supabase, exists } = await ownedProject(projectId, profile.empresa_id);
  if (!exists) return { error: "Proyecto no encontrado." };
  const { data: row } = await supabase
    .from("project_workday_status")
    .select("id, project_id, climate_event_id, decision_status")
    .eq("id", workdayId)
    .eq("project_id", projectId)
    .single();
  if (!row) return { error: "Jornada no encontrada." };
  if (row.decision_status === "CONFIRMED") return { error: null };

  const { error } = await supabase
    .from("project_workday_status")
    .update({ decision_status: "CONFIRMED", confirmed_by: profile.id, confirmed_at: new Date().toISOString() })
    .eq("id", workdayId)
    .eq("project_id", projectId);
  if (error) return { error: "No se pudo confirmar la jornada." };
  if (row.climate_event_id) {
    await supabase.from("climate_events").update({ status: "CONFIRMED" }).eq("id", row.climate_event_id).eq("project_id", projectId);
  }
  await logAudit(supabase, {
    action: "workday_weather_confirmed",
    detail: { project_id: projectId, workday_status_id: workdayId },
  });
  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

export async function overrideWeatherWorkday(
  projectId: string,
  workdayId: string,
  input: { classification: ProjectWorkdayClassification; reasonCode?: ClimateReasonCode | null; notes?: string | null },
): Promise<{ error: string | null }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const { supabase, exists } = await ownedProject(projectId, profile.empresa_id);
  if (!exists) return { error: "Proyecto no encontrado." };
  if (!CLASSIFICATIONS.includes(input.classification)) return { error: "Clasificación inválida." };
  if (input.reasonCode && !REASONS.includes(input.reasonCode)) return { error: "Causa inválida." };
  if (input.classification === "NON_WORKABLE_RAIN_EFFECT") {
    return { error: "Para un efecto de lluvia usá el flujo de jornada posterior." };
  }

  const { data: existing } = await supabase
    .from("project_workday_status")
    .select("id, climate_event_id")
    .eq("id", workdayId)
    .eq("project_id", projectId)
    .single();
  if (!existing) return { error: "Jornada no encontrada." };

  const { error } = await supabase
    .from("project_workday_status")
    .update({
      classification: input.classification,
      reason_code: input.classification === "NON_WORKABLE_OTHER" ? input.reasonCode ?? "OTHER" : null,
      notes: input.notes?.trim() || null,
      source: "RESIDENT",
      decision_status: "CONFIRMED",
      proposed_automatically: false,
      confirmed_by: profile.id,
      confirmed_at: new Date().toISOString(),
      parent_workday_status_id: null,
    })
    .eq("id", workdayId)
    .eq("project_id", projectId);
  if (error) return { error: "No se pudo corregir la jornada." };
  if (existing.climate_event_id) {
    await supabase.from("climate_events").update({ status: "OVERRIDDEN" }).eq("id", existing.climate_event_id).eq("project_id", projectId);
  }
  await logAudit(supabase, {
    action: "workday_weather_overridden",
    detail: { project_id: projectId, workday_status_id: workdayId, classification: input.classification, reason_code: input.reasonCode ?? null },
  });
  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

export async function createRainEffectWorkday(
  projectId: string,
  workDate: string,
  parentWorkdayStatusId: string,
  reasonCode: ClimateReasonCode,
  notes?: string | null,
): Promise<{ error: string | null }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const { supabase, exists } = await ownedProject(projectId, profile.empresa_id);
  if (!exists) return { error: "Proyecto no encontrado." };
  if (!REASONS.includes(reasonCode)) return { error: "Elegí una causa válida." };

  const { data: parent } = await supabase
    .from("project_workday_status")
    .select("id, project_id, work_date, classification, decision_status, climate_event_id")
    .eq("id", parentWorkdayStatusId)
    .eq("project_id", projectId)
    .single();
  if (!parent || parent.classification !== "NON_WORKABLE_RAIN" || parent.decision_status !== "CONFIRMED" || !parent.climate_event_id) {
    return { error: "La jornada causal debe ser una lluvia confirmada con evento climático." };
  }
  if (parent.work_date >= workDate) return { error: "La fecha afectada debe ser posterior a la lluvia." };

  const { data: current } = await supabase
    .from("project_workday_status")
    .select("id, decision_status")
    .eq("project_id", projectId)
    .eq("work_date", workDate)
    .maybeSingle();
  if (current?.decision_status === "CONFIRMED") return { error: "La jornada ya tiene una decisión confirmada; corregila explícitamente." };

  const payload = {
    project_id: projectId,
    work_date: workDate,
    classification: "NON_WORKABLE_RAIN_EFFECT",
    climate_event_id: parent.climate_event_id,
    parent_workday_status_id: parentWorkdayStatusId,
    reason_code: reasonCode,
    notes: notes?.trim() || null,
    source: "RESIDENT",
    decision_status: "CONFIRMED",
    proposed_automatically: false,
    confirmed_by: profile.id,
    confirmed_at: new Date().toISOString(),
  };
  const write = current
    ? supabase.from("project_workday_status").update(payload).eq("id", current.id).eq("project_id", projectId)
    : supabase.from("project_workday_status").insert(payload);
  const { error } = await write;
  if (error) return { error: "No se pudo registrar el efecto posterior." };

  await logAudit(supabase, {
    action: "rain_effect_day_created",
    detail: { project_id: projectId, work_date: workDate, parent_workday_status_id: parentWorkdayStatusId, reason_code: reasonCode },
  });
  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

export async function updateLocalPrecipitation(
  projectId: string,
  eventId: string,
  precipitationMm: number,
): Promise<{ error: string | null }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const { supabase, exists } = await ownedProject(projectId, profile.empresa_id);
  if (!exists) return { error: "Proyecto no encontrado." };
  try {
    const event = await attachLocalPrecipitation(supabase, projectId, eventId, precipitationMm);
    await logAudit(supabase, {
      action: "climate_local_measurement_added",
      detail: { project_id: projectId, event_id: event.id, local_precipitation_mm: precipitationMm },
    });
    revalidatePath(`/projects/${projectId}`);
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No se pudo guardar la medición local." };
  }
}

export async function createOtherWorkday(
  projectId: string,
  workDate: string,
  notes: string,
): Promise<{ error: string | null }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const { supabase, exists } = await ownedProject(projectId, profile.empresa_id);
  if (!exists) return { error: "Proyecto no encontrado." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return { error: "La fecha no es válida." };
  const { data: existing } = await supabase
    .from("project_workday_status")
    .select("id, decision_status")
    .eq("project_id", projectId)
    .eq("work_date", workDate)
    .maybeSingle();
  if (existing?.decision_status === "CONFIRMED") return { error: "La jornada ya tiene una decisión confirmada." };

  const payload = {
    project_id: projectId,
    work_date: workDate,
    classification: "NON_WORKABLE_OTHER",
    reason_code: "OTHER",
    notes: notes.trim() || null,
    source: "RESIDENT",
    decision_status: "CONFIRMED",
    proposed_automatically: false,
    confirmed_by: profile.id,
    confirmed_at: new Date().toISOString(),
  };
  const { error } = existing
    ? await supabase.from("project_workday_status").update(payload).eq("id", existing.id).eq("project_id", projectId)
    : await supabase.from("project_workday_status").insert(payload);
  if (error) return { error: "No se pudo registrar la jornada no trabajable." };
  await logAudit(supabase, {
    action: "workday_weather_overridden",
    detail: { project_id: projectId, work_date: workDate, classification: "NON_WORKABLE_OTHER", notes: notes.trim() || null },
  });
  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

export async function addClimateEvidence(input: {
  projectId: string;
  climateEventId?: string | null;
  workdayStatusId?: string | null;
  evidenceType: ClimateEvidenceType;
  storagePath?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  capturedAt?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<{ error: string | null; id?: string }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const { supabase, exists } = await ownedProject(input.projectId, profile.empresa_id);
  if (!exists) return { error: "Proyecto no encontrado." };
  if (!EVIDENCE_TYPES.includes(input.evidenceType)) return { error: "Tipo de evidencia inválido." };
  if (!input.climateEventId && !input.workdayStatusId) return { error: "Vinculá la evidencia a un evento o jornada." };
  if (input.storagePath && !input.storagePath.startsWith(`${input.projectId}/climate/`)) {
    return { error: "La ruta de evidencia no pertenece al proyecto." };
  }

  const { data, error } = await supabase
    .from("climate_evidence")
    .insert({
      project_id: input.projectId,
      climate_event_id: input.climateEventId ?? null,
      workday_status_id: input.workdayStatusId ?? null,
      evidence_type: input.evidenceType,
      storage_bucket: input.storagePath ? "execution-photos" : null,
      storage_path: input.storagePath ?? null,
      file_name: input.fileName ?? null,
      mime_type: input.mimeType ?? null,
      size_bytes: input.sizeBytes ?? null,
      captured_at: input.capturedAt ?? null,
      uploaded_by: profile.id,
      metadata: input.metadata ?? {},
    })
    .select("id")
    .single();
  if (error?.code === "23505" && input.storagePath) {
    const { data: existing } = await supabase
      .from("climate_evidence")
      .select("id")
      .eq("project_id", input.projectId)
      .eq("storage_path", input.storagePath)
      .maybeSingle();
    if (existing) return { error: null, id: existing.id as string };
  }
  if (error || !data) return { error: "No se pudo registrar la evidencia." };

  await logAudit(supabase, {
    action: "climate_evidence_added",
    detail: { project_id: input.projectId, climate_event_id: input.climateEventId ?? null, workday_status_id: input.workdayStatusId ?? null, evidence_id: data.id, evidence_type: input.evidenceType },
  });
  revalidatePath(`/projects/${input.projectId}`);
  return { error: null, id: data.id as string };
}
