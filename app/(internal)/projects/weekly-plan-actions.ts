"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePlan } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import {
  BudgetItem,
  ProjectWeeklyPlan,
  WeeklyPlanCalculationSummary,
  WeeklyPlanInputMode,
  WeeklyPlanStatus,
  DailyWeatherForecast,
} from "@/lib/types";
import {
  BudgetItemMaterialInput,
  StockDisponibilidadInput,
  ExecutionHistoryEntry,
} from "@/lib/procurement/progress-forecast-engine";
import {
  calculateWeeklyPlanRequirements,
  WeeklyPlanItemTargetInput,
} from "@/lib/procurement/weekly-plan-engine";
import {
  loadWeeklyPlanBaseData,
  resolveWeeklyWeather,
  toEngineTargets,
  type PreviewWeeklyPlanItemInput,
} from "@/lib/procurement/weekly-plan-shared";

export interface SaveWeeklyPlanParams {
  planId?: string;
  projectId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  status: WeeklyPlanStatus;
  notes?: string | null;
  weatherSnapshotBatchId?: string | null;
  items: {
    budgetItemId: string;
    frontLabel?: string | null;
    inputMode: WeeklyPlanInputMode;
    inputValue: number;
    unit: string;
  }[];
}

export interface GetWeeklyPlanParams {
  projectId: string;
  planId?: string;
  weatherOverlay?: boolean;
}

export interface PreviewWeeklyPlanActionParams {
  projectId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  weatherOverlay: boolean;
  items: PreviewWeeklyPlanItemInput[];
}

/**
 * Loads the active/latest weekly plan or initializes a new one,
 * fetching all real database contracts without assuming non-existent columns.
 *
 * Data loading (presupuesto, ejecución, BOM, stock, inbound) is shared with
 * previewWeeklyPlanAction via loadWeeklyPlanBaseData — single source of truth.
 */
export async function getWeeklyPlanDetailsAction(
  params: GetWeeklyPlanParams
): Promise<{
  data: {
    plan: ProjectWeeklyPlan | null;
    calculation: WeeklyPlanCalculationSummary;
    budgetItems: BudgetItem[];
    executedQuantities: Record<string, number>;
  } | null;
  error: string | null;
}> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const empresaId = profile.empresa_id;
    const supabase = await createClient();
    const { projectId, planId, weatherOverlay = false } = params;

    // Shared loader: proyecto + partidas + ejecución + BOM + stock + inbound.
    // Misma fuente que usa el preview (sin duplicar ~300 líneas).
    const baseRes = await loadWeeklyPlanBaseData(supabase, projectId, empresaId);
    if (baseRes.error || !baseRes.data) {
      return { data: null, error: baseRes.error || "Error al cargar datos base." };
    }
    const {
      project,
      budgetItems,
      executedQuantities,
      recentEntries: recentEntriesList,
      materialsByItem,
      stockAndInbound,
    } = baseRes.data;

    // Fetch existing plan or determine defaults.
    // NOTA: esta es la ÚNICA lectura de project_weekly_plans en load.
    // El preview NUNCA toca estas tablas (ver previewWeeklyPlanAction).
    let plan: ProjectWeeklyPlan | null = null;
    let savedItems: {
      budget_item_id: string;
      front_label?: string | null;
      input_mode: WeeklyPlanInputMode;
      input_value: number;
    }[] = [];

    if (planId) {
      const { data: pData } = await supabase
        .from("project_weekly_plans")
        .select("*")
        .eq("id", planId)
        .eq("empresa_id", empresaId)
        .single();
      plan = (pData as ProjectWeeklyPlan) || null;
    } else {
      const { data: pData } = await supabase
        .from("project_weekly_plans")
        .select("*")
        .eq("project_id", projectId)
        .eq("empresa_id", empresaId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      plan = (pData as ProjectWeeklyPlan) || null;
    }

    if (plan) {
      // P2-4: orden determinista para que el capping multi-front secuencial
      // asigne el remanente al mismo frente tras recargar.
      const { data: piData } = await supabase
        .from("project_weekly_plan_items")
        .select("*")
        .eq("plan_id", plan.id)
        .order("created_at", { ascending: true });
      savedItems = (piData ?? []).map((pi) => ({
        budget_item_id: pi.budget_item_id,
        front_label: pi.front_label,
        input_mode: pi.input_mode as WeeklyPlanInputMode,
        input_value: Number(pi.input_value) || 0,
      }));
    }

    const now = new Date();
    const defaultStart = now.toISOString().split("T")[0];
    const defaultEnd = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const startDate = plan ? plan.start_date : defaultStart;
    const endDate = plan ? plan.end_date : defaultEnd;
    const status = plan ? plan.status : "DRAFT";

    // Build target inputs with multi-front support
    const targets: WeeklyPlanItemTargetInput[] = savedItems.map((si) => ({
      budget_item_id: si.budget_item_id,
      front_label: si.front_label,
      input_mode: si.input_mode,
      input_value: si.input_value,
    }));

    // Optional Weather Overlay Execution (shared helper, mismas garantías).
    // Clima OFF: cero llamadas meteorológicas, cero inserts de clima.
    let weatherForecasts: DailyWeatherForecast[] = [];
    let weatherSnapshotId: string | null = null;
    let weatherFailedClosed = false;
    let operationalAssessments: Record<string, any> = {};
    let weatherRequestedDays: number | undefined;
    let weatherCoveredDays: number | undefined;
    let weatherPartial: boolean | undefined;

    if (weatherOverlay) {
      const lat = project.latitude ? Number(project.latitude) : -25.455;
      const lon = project.longitude ? Number(project.longitude) : -57.534;
      const resolved = await resolveWeeklyWeather(supabase, {
        empresaId,
        projectId,
        latitude: lat,
        longitude: lon,
        startDate,
        endDate,
        budgetItems,
        targets,
      });
      weatherForecasts = resolved.forecasts;
      weatherSnapshotId = resolved.snapshotId;
      operationalAssessments = resolved.assessments;
      weatherFailedClosed = resolved.failedClosed;
      weatherRequestedDays = resolved.requestedDays;
      weatherCoveredDays = resolved.coveredDays;
      weatherPartial = resolved.partialCoverage;
    }

    // Run pure calculation engine (MISMO engine que el preview)
    const calculation = calculateWeeklyPlanRequirements({
      plan_id: plan?.id,
      project_id: projectId,
      start_date: startDate,
      end_date: endDate,
      status,
      budget_items: budgetItems,
      executed_quantities_by_item: executedQuantities,
      targets,
      materials_by_item: materialsByItem,
      stock_and_inbound: stockAndInbound,
      recent_execution_entries: recentEntriesList,
      currency: "PYG",
      weather_overlay_enabled: weatherOverlay,
      weather_forecasts: weatherForecasts,
      operational_assessments: operationalAssessments,
      weather_snapshot_id: weatherSnapshotId,
      weather_provider: "open-meteo",
      weather_failed_closed: weatherFailedClosed,
      weather_plan_days_count: weatherRequestedDays,
      weather_covered_days_count: weatherCoveredDays,
      weather_coverage_is_partial: weatherPartial,
    });

    return {
      data: {
        plan,
        calculation,
        budgetItems,
        executedQuantities,
      },
      error: null,
    };
  } catch (err: any) {
    console.error("Error in getWeeklyPlanDetailsAction:", err);
    return { data: null, error: err?.message || "Error interno al cargar el plan semanal." };
  }
}

/**
 * PREVIEW SIN GUARDAR — cambio funcional principal del batch UX.
 *
 * previewWeeklyPlanAction({ projectId, startDate, endDate, weatherOverlay, items })
 *
 * - Valida tenant/proyecto igual que la action de guardado (requirePlan + loader).
 * - Carga los mismos datos reales vía loadWeeklyPlanBaseData
 *   (presupuesto, ejecución, BOM, stock, inbound, costos, historial).
 * - Usa EXACTAMENTE calculateWeeklyPlanRequirements(...) — mismo motor, sin fórmulas paralelas.
 * - Recibe las metas desde la UI (locales, aún no guardadas).
 * - NO inserta ni actualiza la tabla de planes semanales.
 * - NO inserta ni actualiza la tabla de ítems del plan.
 * - Devuelve WeeklyPlanCalculationSummary para renderizar.
 *
 * Clima:
 * - OFF: no llama al proveedor meteorológico (cero llamadas, cero inserts).
 * - ON: usa fechas exactas del plan, consulta el provider real vía
 *   resolveWeeklyWeather (mismo helper que load), muestra factibilidad sin
 *   modificar la meta base ni recortar compras/materiales.
 * - Para mantener el contrato actual (save enlaza weather_snapshot_batch_id),
 *   el preview con Clima=ON SÍ crea un batch append-only de forecast
 *   (igual que load). NO toca plans/items. Ver weekly-plan-shared.ts.
 */
export async function previewWeeklyPlanAction(
  params: PreviewWeeklyPlanActionParams
): Promise<{
  data: {
    calculation: WeeklyPlanCalculationSummary;
    budgetItems: BudgetItem[];
    executedQuantities: Record<string, number>;
  } | null;
  error: string | null;
}> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const empresaId = profile.empresa_id;
    const supabase = await createClient();
    const { projectId, startDate, endDate, weatherOverlay, items } = params;

    if (!projectId) {
      return { data: null, error: "Proyecto requerido para previsualizar." };
    }
    if (!startDate || !endDate) {
      return { data: null, error: "Período requerido para previsualizar (inicio y fin)." };
    }
    if (endDate < startDate) {
      return {
        data: null,
        error: `Rango inválido: fin (${endDate}) anterior a inicio (${startDate}).`,
      };
    }

    // Mismos datos reales que load/save (single source of truth).
    const baseRes = await loadWeeklyPlanBaseData(supabase, projectId, empresaId);
    if (baseRes.error || !baseRes.data) {
      return { data: null, error: baseRes.error || "Error al cargar datos base." };
    }
    const {
      project,
      budgetItems,
      executedQuantities,
      recentEntries,
      materialsByItem,
      stockAndInbound,
    } = baseRes.data;

    // Metas LOCALES desde la UI (aún no guardadas). Sin persistencia.
    const targets = toEngineTargets(items ?? []);

    // Clima: OFF = cero llamadas; ON = rango exacto + provider real.
    // P2-5: sin metas no hay assessment posible; no crear batch huérfano.
    const withWeather = weatherOverlay && targets.length > 0;
    let weatherForecasts: DailyWeatherForecast[] = [];
    let weatherSnapshotId: string | null = null;
    let weatherFailedClosed = false;
    let operationalAssessments: Record<string, any> = {};
    let weatherRequestedDays: number | undefined;
    let weatherCoveredDays: number | undefined;
    let weatherPartial: boolean | undefined;

    if (withWeather) {
      const lat = project.latitude ? Number(project.latitude) : -25.455;
      const lon = project.longitude ? Number(project.longitude) : -57.534;
      const resolved = await resolveWeeklyWeather(supabase, {
        empresaId,
        projectId,
        latitude: lat,
        longitude: lon,
        startDate,
        endDate,
        budgetItems,
        targets,
      });
      weatherForecasts = resolved.forecasts;
      weatherSnapshotId = resolved.snapshotId;
      operationalAssessments = resolved.assessments;
      weatherFailedClosed = resolved.failedClosed;
      weatherRequestedDays = resolved.requestedDays;
      weatherCoveredDays = resolved.coveredDays;
      weatherPartial = resolved.partialCoverage;
    }

    // MISMO motor que load/save. Sin plan_id (no existe plan persistido para este preview).
    const calculation = calculateWeeklyPlanRequirements({
      project_id: projectId,
      start_date: startDate,
      end_date: endDate,
      status: "DRAFT",
      budget_items: budgetItems,
      executed_quantities_by_item: executedQuantities,
      targets,
      materials_by_item: materialsByItem,
      stock_and_inbound: stockAndInbound,
      recent_execution_entries: recentEntries,
      currency: "PYG",
      // Si se omitió el clima por falta de metas, el overlay queda OFF en el
      // resultado aunque el toggle esté ON (sin forecasts no hay factibilidad).
      weather_overlay_enabled: withWeather,
      weather_forecasts: weatherForecasts,
      operational_assessments: operationalAssessments,
      weather_snapshot_id: weatherSnapshotId,
      weather_provider: "open-meteo",
      weather_failed_closed: weatherFailedClosed,
      weather_plan_days_count: weatherRequestedDays,
      weather_covered_days_count: weatherCoveredDays,
      weather_coverage_is_partial: weatherPartial,
    });

    return {
      data: { calculation, budgetItems, executedQuantities },
      error: null,
    };
  } catch (err: any) {
    console.error("Error in previewWeeklyPlanAction:", err);
    return { data: null, error: err?.message || "Error interno al previsualizar el plan." };
  }
}

/**
 * Saves or updates a Weekly Plan and its item targets atomically via PostgreSQL RPC.
 * El guardado post-preview persiste EXACTAMENTE las metas previsualizadas
 * (la UI reenvía los mismos items del preview). Sin duplicar persistencia.
 */
export async function saveWeeklyPlanAction(
  params: SaveWeeklyPlanParams
): Promise<{ data: ProjectWeeklyPlan | null; error: string | null }> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const empresaId = profile.empresa_id;
    const supabase = await createClient();

    const { planId, projectId, startDate, endDate, status, notes, weatherSnapshotBatchId, items } = params;

    // P1-2: misma validación de rango que el preview (no persistir rangos invertidos).
    if (!startDate || !endDate) {
      return { data: null, error: "Período requerido para guardar (inicio y fin)." };
    }
    if (endDate < startDate) {
      return {
        data: null,
        error: `Rango inválido: fin (${endDate}) anterior a inicio (${startDate}).`,
      };
    }

    // Validate project access
    const { data: project, error: pErr } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("empresa_id", empresaId)
      .single();

    if (pErr || !project) {
      return { data: null, error: "Proyecto no encontrado o sin permisos." };
    }

    // Format items payload for atomic RPC.
    // P2-1: mismo trim que el preview (toEngineTargets) para que lo calculado
    // y lo persistido no diverjan con espacios accidentales.
    const itemsPayload = items
      .filter((it) => it.inputValue > 0)
      .map((it) => ({
        budget_item_id: it.budgetItemId,
        front_label: it.frontLabel?.trim() ? it.frontLabel.trim() : null,
        input_mode: it.inputMode,
        input_value: it.inputValue,
        unit: it.unit || "unid",
      }));

    // Invoke atomic RPC function
    const { data: rpcResult, error: rpcErr } = await supabase.rpc(
      "save_weekly_plan_atomic",
      {
        p_plan_id: planId || null,
        p_project_id: projectId,
        p_start_date: startDate,
        p_end_date: endDate,
        p_status: status,
        p_notes: notes || null,
        p_items: itemsPayload,
        p_weather_snapshot_batch_id: weatherSnapshotBatchId || null,
      }
    );

    if (rpcErr) {
      return {
        data: null,
        error: `Error al persistir plan de forma atómica: ${rpcErr.message}`,
      };
    }

    const savedPlanId = (rpcResult as any)?.plan_id || planId;

    // Retrieve saved plan
    const { data: savedPlan, error: fetchErr } = await supabase
      .from("project_weekly_plans")
      .select("*")
      .eq("id", savedPlanId)
      .eq("empresa_id", empresaId)
      .single();

    if (fetchErr || !savedPlan) {
      return { data: null, error: "Plan guardado pero no se pudo recuperar." };
    }

    revalidatePath(`/projects/${projectId}`);
    return { data: savedPlan as ProjectWeeklyPlan, error: null };
  } catch (err: any) {
    console.error("Error in saveWeeklyPlanAction:", err);
    return { data: null, error: err?.message || "Error al guardar el plan semanal." };
  }
}
