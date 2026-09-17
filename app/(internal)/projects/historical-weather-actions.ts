"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePlan } from "@/lib/auth";
import {
  fetchHistoricalWeatherRange,
  type DailyObservedWeather,
} from "@/lib/procurement/weather-client";

export interface GetHistoricalWeatherParams {
  projectId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

export interface HistoricalWeatherResult {
  days: DailyObservedWeather[];
  sources: string[];
  requestedDays: number;
  coveredDays: number;
  partialCoverage: boolean;
}

/**
 * EVIDENCIA meteorológica HISTÓRICA para el Libro de Obra — contexto distinto
 * del Weather Overlay futuro (ese no se toca).
 *
 * - Solo lectura: UN select al proyecto + fetch al provider por rango.
 * - CERO writes: no inserta ni actualiza project_weather_log, climate_events,
 *   project_workday_status, climate_evidence ni forecast batches/snapshots.
 * - El Libro sigue siendo DECISIÓN humana: el clima nunca escribe LL/HH/O
 *   solo; la UI ofrece "Usar como Lluvioso (LL)" explícito vía setWeatherDay.
 * - Sin invención: si falla el provider, error claro y días ausentes
 *   (nunca 0 mm fabricado).
 */
export async function getHistoricalWeatherAction(
  params: GetHistoricalWeatherParams
): Promise<{ data: HistoricalWeatherResult | null; error: string | null }> {
  try {
    // Misma puerta que el Libro de Obra manual (setWeatherDay).
    const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
    const empresaId = profile.empresa_id;
    const supabase = await createClient();
    const { projectId, startDate, endDate } = params;

    if (!projectId) {
      return { data: null, error: "Proyecto requerido." };
    }
    if (!startDate || !endDate) {
      return { data: null, error: "Rango requerido (inicio y fin)." };
    }
    if (endDate < startDate) {
      return {
        data: null,
        error: `Rango inválido: fin (${endDate}) anterior a inicio (${startDate}).`,
      };
    }
    // Tope anti-abuso: un mes por llamada (la UI carga por mes visible).
    const spanDays =
      Math.round(
        (new Date(`${endDate}T00:00:00Z`).getTime() -
          new Date(`${startDate}T00:00:00Z`).getTime()) /
          (1000 * 60 * 60 * 24)
      ) + 1;
    if (spanDays > 62) {
      return { data: null, error: "Rango máximo: 62 días por consulta." };
    }

    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, latitude, longitude")
      .eq("id", projectId)
      .eq("empresa_id", empresaId)
      .single();

    if (projErr || !project) {
      return { data: null, error: "Proyecto no encontrado o sin permisos." };
    }

    // Mismos defaults que el overlay de carga (Asunción, PY).
    const lat = project.latitude ? Number(project.latitude) : -25.455;
    const lon = project.longitude ? Number(project.longitude) : -57.534;

    let result: Awaited<ReturnType<typeof fetchHistoricalWeatherRange>>;
    try {
      result = await fetchHistoricalWeatherRange(lat, lon, startDate, endDate);
    } catch {
      return {
        data: null,
        error:
          "Datos meteorológicos no disponibles. El Libro de Obra manual sigue funcionando.",
      };
    }

    return {
      data: {
        days: result.observations,
        sources: result.sources,
        requestedDays: result.requestedDays,
        coveredDays: result.coveredDays,
        partialCoverage: result.partialCoverage,
      },
      error: null,
    };
  } catch (err: unknown) {
    console.error("Error in getHistoricalWeatherAction:", err);
    return {
      data: null,
      error:
        err instanceof Error ? err.message : "Error al consultar el clima observado.",
    };
  }
}
