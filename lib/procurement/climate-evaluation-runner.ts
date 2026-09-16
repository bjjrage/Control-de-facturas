import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateProjectWeatherDay } from "./climate-workdays";

export async function runClimateEvaluationBatch(
  supabase: SupabaseClient,
  input: { date: string; projectId?: string; limit?: number },
) {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  let query = supabase
    .from("projects")
    .select("id, empresa_id, weather_tracking_enabled, latitude, longitude")
    .eq("weather_tracking_enabled", true)
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    .limit(limit);
  if (input.projectId) query = query.eq("id", input.projectId);

  const { data: projects, error } = await query;
  if (error) throw new Error(error.message);

  const results: { project_id: string; threshold_exceeded: boolean; workday_id: string | null }[] = [];
  const failures: { project_id: string; error: string }[] = [];
  for (const project of projects ?? []) {
    try {
      const result = await evaluateProjectWeatherDay(supabase, project.id, input.date);
      results.push({
        project_id: project.id,
        threshold_exceeded: result.threshold_exceeded,
        workday_id: result.workday?.id ?? null,
      });
      if (result.proposal_created || result.event_created || result.external_measurement_changed) {
        const { error: auditError } = await supabase.from("audit_logs").insert({
          empresa_id: project.empresa_id,
          actor_type: "system",
          action: result.proposal_created
            ? "rain_day_proposed"
            : result.event_created
              ? "climate_event_created"
              : "climate_event_measurement_updated",
          detail: {
            project_id: project.id,
            climate_event_id: result.event.id,
            workday_status_id: result.workday?.id ?? null,
            date: input.date,
            source: result.event.source,
            station_id: result.event.external_station_id,
            station_name: result.event.external_station_name,
            station_distance_km: result.event.external_station_distance_km,
            provider_fallback_reason: result.event.provider_fallback_reason,
          },
        });
        if (auditError) throw new Error(auditError.message);
      }
    } catch (error) {
      failures.push({ project_id: project.id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    date: input.date,
    scanned: (projects ?? []).length,
    proposed_or_existing: results.filter((result) => result.threshold_exceeded).length,
    results,
    failures,
  };
}
