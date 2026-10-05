"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePlan } from "@/lib/auth";
import {
  fetchHistoricalWeatherRange,
  isValidProjectCoords,
  MISSING_PROJECT_LOCATION_MSG,
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
 * Evidencia meteorologica historica de apoyo para el Libro de Obra.
 *
 * - Solo lectura: consulta el proyecto y obtiene observaciones por rango.
 * - No crea ni modifica filas del Libro legacy ni del registro contractual canonico.
 * - Las propuestas contractuales DMH/DINAC se evaluan en el flujo canonico;
 *   una persona confirma o corrige cada propuesta.
 * - Si falla el proveedor, devuelve error y no inventa datos ni precipitacion cero.
 */export async function getHistoricalWeatherAction(
  params: GetHistoricalWeatherParams
): Promise<{ data: HistoricalWeatherResult | null; error: string | null }> {
  try {
    // Valida el acceso al proyecto antes de consultar el proveedor meteorologico.
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

    // P1-2 FAIL-CLOSED: sin ubicación válida NO se llama al provider.
    // Mostrar clima de Asunción como si fuera el de la obra sería evidencia
    // contractual falsa. (El overlay futuro conserva su comportamiento.)
    if (!isValidProjectCoords(project.latitude, project.longitude)) {
      return { data: null, error: MISSING_PROJECT_LOCATION_MSG };
    }
    const lat = Number(project.latitude);
    const lon = Number(project.longitude);

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
