import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { actionResult } from "./action-utils";

const classification = z.enum(["WORKABLE", "NON_WORKABLE_RAIN", "NON_WORKABLE_RAIN_EFFECT", "NON_WORKABLE_OTHER"]);
const reason = z.enum(["TERRAIN_SATURATED", "ACCESS_BLOCKED", "FLOODED_EXCAVATION", "UNSAFE_CONDITIONS", "MATERIAL_IMPACT", "OTHER"]);
export const ManageClimateWorkdayInputSchema = z.object({
  operation: z.enum(["update_config", "evaluate_day", "confirm", "override", "rain_effect", "local_precipitation", "other_non_workable"]),
  project_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  workday_id: z.string().uuid().optional(),
  event_id: z.string().uuid().optional(),
  parent_workday_status_id: z.string().uuid().optional(),
  precipitation_threshold_mm: z.number().nonnegative().finite().optional(),
  weather_tracking_enabled: z.boolean().optional(),
  weather_station_id: z.string().trim().max(100).optional().nullable(),
  weather_station_name: z.string().trim().max(200).optional().nullable(),
  weather_source: z.string().trim().max(100).optional(),
  classification: classification.optional(),
  reason_code: reason.optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  precipitation_mm: z.number().nonnegative().finite().optional(),
});
export type ManageClimateWorkdayInput = z.infer<typeof ManageClimateWorkdayInputSchema>;

async function handler(_ctx: AgentToolContext, input: ManageClimateWorkdayInput, _deps: { db: SupabaseClient }) {
  const actions = await import("@/app/(internal)/projects/climate-actions");
  let result: unknown;
  if (input.operation === "update_config") {
    result = await actions.updateProjectClimateConfig(input.project_id, {
      precipitationThresholdMm: input.precipitation_threshold_mm ?? 0,
      weatherTrackingEnabled: input.weather_tracking_enabled ?? false,
      weatherStationId: input.weather_station_id,
      weatherStationName: input.weather_station_name,
      weatherSource: input.weather_source,
    });
  } else if (input.operation === "evaluate_day") {
    result = await actions.evaluateProjectWeatherDayAction(input.project_id, input.date ?? "");
  } else if (input.operation === "confirm") {
    result = await actions.confirmWeatherWorkday(input.project_id, input.workday_id ?? "");
  } else if (input.operation === "override") {
    result = await actions.overrideWeatherWorkday(input.project_id, input.workday_id ?? "", {
      classification: input.classification ?? "NON_WORKABLE_OTHER",
      reasonCode: input.reason_code,
      notes: input.notes,
    });
  } else if (input.operation === "rain_effect") {
    result = await actions.createRainEffectWorkday(input.project_id, input.date ?? "", input.parent_workday_status_id ?? "", input.reason_code ?? "OTHER", input.notes);
  } else if (input.operation === "local_precipitation") {
    result = await actions.updateLocalPrecipitation(input.project_id, input.event_id ?? "", input.precipitation_mm ?? -1);
  } else {
    result = await actions.createOtherWorkday(input.project_id, input.date ?? "", input.notes ?? "");
  }
  return { operation: input.operation, project_id: input.project_id, ...actionResult(result), message: "Jornada climática procesada por el motor real del ERP." };
}

registerTool<ManageClimateWorkdayInput, Record<string, unknown>>({
  name: "manage_climate_workday",
  description: "Evalúa y registra jornadas climáticas, lluvia, efectos posteriores, configuración y evidencia operacional usando el dominio real de clima. Requiere aprobación porque algunas operaciones persisten decisiones.",
  inputSchema: ManageClimateWorkdayInputSchema,
  riskLevel: 2,
  requiredRoles: null,
  handler,
});

export const manageClimateWorkdayTool = { handler, inputSchema: ManageClimateWorkdayInputSchema };
