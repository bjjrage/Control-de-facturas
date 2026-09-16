"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePlan } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import {
  BudgetItem,
  ProgressForecastRunSummary,
  DailyWeatherForecast,
} from "@/lib/types";
import { fetchWeatherForecast } from "@/lib/procurement/weather-client";
import {
  analyzeOperationalWorkability,
  createDegradedOperationalFallback,
  calculateOperationalInputHash,
  BudgetItemOperationalInput,
  OperationalAnalysisOutput,
} from "@/lib/procurement/operational-analyst-llm";
import {
  computeProgressForecast,
  BudgetItemMaterialInput,
  StockDisponibilidadInput,
} from "@/lib/procurement/progress-forecast-engine";
import { deriveClimateForecastMetrics } from "@/lib/procurement/climate-metrics";

export interface RunProgressForecastParams {
  projectId: string;
  horizonDays: number; // 7, 14, 30 or custom
  startDate?: string; // YYYY-MM-DD, defaults to today
  customLatitude?: number;
  customLongitude?: number;
}

export async function runProgressForecastAction(
  params: RunProgressForecastParams
): Promise<{ data: ProgressForecastRunSummary | null; error: string | null }> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const empresaId = profile.empresa_id;
    const supabase = await createClient();

    const { projectId } = params;
    // Enforce strictly: minimum 7 days
    const horizonDays = Math.max(7, params.horizonDays || 7);
    const startDate =
      params.startDate || new Date().toISOString().split("T")[0];

    // 1. Fetch project details
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, name, location, latitude, longitude, start_date, currency:contract_amount")
      .eq("id", projectId)
      .eq("empresa_id", empresaId)
      .single();

    if (projErr || !project) {
      return { data: null, error: "Proyecto no encontrado o sin permisos." };
    }

    // Determine geographic coordinates
    const lat = params.customLatitude ?? (project.latitude ? Number(project.latitude) : null);
    const lon = params.customLongitude ?? (project.longitude ? Number(project.longitude) : null);

    // Default to Asunción coordinates if not specified
    const effectiveLat = lat ?? -25.2867;
    const effectiveLon = lon ?? -57.647;

    // Update project coordinates if provided as custom
    if (params.customLatitude && params.customLongitude) {
      await supabase
        .from("projects")
        .update({
          latitude: params.customLatitude,
          longitude: params.customLongitude,
        })
        .eq("id", projectId)
        .eq("empresa_id", empresaId);
    }

    // 2. Fetch daily weather forecasts (Open-Meteo)
    let forecasts: DailyWeatherForecast[] = [];
    let weatherFailed = false;
    let weatherErrorMessage: string | null = null;
    try {
      forecasts = await fetchWeatherForecast(
        effectiveLat,
        effectiveLon,
        horizonDays
      );
    } catch (wErr: any) {
      console.warn("Weather forecast fetch error (fail-closed):", wErr);
      weatherFailed = true;
      weatherErrorMessage = wErr?.message || "No se pudo obtener el pronóstico meteorológico.";
      forecasts = [];
    }

    // 3. Fetch budget items (tenant scoped via project_id and empresa_id check)
    const { data: rawBudgetItems } = await supabase
      .from("budget_items")
      .select("*")
      .eq("project_id", projectId)
      .order("code", { ascending: true });

    const budgetItems: BudgetItem[] = (rawBudgetItems ?? []) as BudgetItem[];
    if (budgetItems.length === 0) {
      return {
        data: null,
        error: "El proyecto no tiene partidas presupuestarias cargadas.",
      };
    }

    const { data: climateWorkdays } = await supabase
      .from("project_workday_status")
      .select("work_date, classification, decision_status")
      .eq("project_id", projectId)
      .eq("empresa_id", empresaId)
      .lte("work_date", new Date().toISOString().slice(0, 10));

    // 4. Fetch execution entries: cumulative progress + recent entries (last 60 days)
    const { data: rawEntries } = await supabase
      .from("execution_entries")
      .select("budget_item_id, quantity_executed, entry_date")
      .eq("project_id", projectId)
      .eq("empresa_id", empresaId);

    const executedQuantities: Record<string, number> = {};
    const recentEntriesList: { budget_item_id: string; entry_date: string; quantity_executed: number }[] = [];

    for (const entry of rawEntries ?? []) {
      const bId = entry.budget_item_id;
      const q = Number(entry.quantity_executed) || 0;
      executedQuantities[bId] = (executedQuantities[bId] || 0) + q;
      if (entry.entry_date) {
        recentEntriesList.push({
          budget_item_id: bId,
          entry_date: entry.entry_date,
          quantity_executed: q,
        });
      }
    }

    // 5. Fetch BOM materials (budget_item_materials joined with productos)
    const { data: rawMaterials } = await supabase
      .from("budget_item_materials")
      .select(
        "id, budget_item_id, producto_id, cantidad_por_unidad_ejecutada, desperdicio_pct, productos(id, nombre, codigo, unidad_medida, costo_promedio)"
      )
      .eq("project_id", projectId)
      .eq("empresa_id", empresaId);

    const materialsByItem: Record<string, BudgetItemMaterialInput[]> = {};
    for (const m of rawMaterials ?? []) {
      const prod = (m as any).productos;
      const bId = m.budget_item_id;
      if (!materialsByItem[bId]) {
        materialsByItem[bId] = [];
      }
      materialsByItem[bId].push({
        budget_item_id: bId,
        producto_id: m.producto_id,
        producto_nombre: prod?.nombre || "Material sin nombre",
        producto_codigo: prod?.codigo || null,
        unidad_medida: prod?.unidad_medida || "unid",
        cantidad_por_unidad_ejecutada: Number(m.cantidad_por_unidad_ejecutada),
        desperdicio_pct: Number(m.desperdicio_pct || 0),
        costo_unitario:
          prod?.costo_promedio && Number(prod.costo_promedio) > 0
            ? Number(prod.costo_promedio)
            : null,
      });
    }

    // 6. Fetch stock disponible en obra (stock_por_proyecto)
    const { data: rawStock } = await supabase
      .from("stock_por_proyecto")
      .select("producto_id, qty_disponible, costo_promedio")
      .eq("project_id", projectId)
      .eq("empresa_id", empresaId);

    // 7. Fetch authorized inbound orders (strictly approved/authorized/in_transit)
    // Audit: Net inbound must be based on actual physical goods reception (oc_recepciones / oc_recepcion_items / stock_movimientos)
    // rather than invoiced quantity. Physical reception enters stock_movimientos (ENTRADA with referencia_tipo = 'oc_recepcion'),
    // which is already reflected in stock_por_proyecto. Thus: netInbound = max(0, totalOrdered - totalPhysicallyReceived).
    const { data: rawOrders } = await supabase
      .from("authorized_orders")
      .select("id, status, authorized_order_items(id, producto_id, quantity)")
      .eq("project_id", projectId)
      .eq("empresa_id", empresaId)
      .in("status", ["approved", "authorized", "in_transit"]);

    // Fetch total physically received quantities by order_item from view oc_order_item_recibido
    const { data: rawReceived } = await supabase
      .from("oc_order_item_recibido")
      .select("order_item_id, cantidad_recibida_total")
      .eq("empresa_id", empresaId);

    const receivedByOrderItem: Record<string, number> = {};
    for (const r of rawReceived ?? []) {
      if (r.order_item_id) {
        receivedByOrderItem[r.order_item_id] = Number(r.cantidad_recibida_total) || 0;
      }
    }

    const stockAndInbound: Record<string, StockDisponibilidadInput> = {};

    for (const st of rawStock ?? []) {
      const pId = st.producto_id;
      stockAndInbound[pId] = {
        producto_id: pId,
        stock_disponible: Math.max(0, Number(st.qty_disponible) || 0),
        oc_inbound: 0,
      };
    }

    for (const ord of rawOrders ?? []) {
      const items = (ord as any).authorized_order_items ?? [];
      for (const it of items) {
        const pId = it.producto_id;
        if (!pId) continue;
        if (!stockAndInbound[pId]) {
          stockAndInbound[pId] = {
            producto_id: pId,
            stock_disponible: 0,
            oc_inbound: 0,
          };
        }
        // Deduct quantity physically received/entered into stock to strictly avoid double counting
        const totalOrdered = Number(it.quantity) || 0;
        const physicallyReceived = receivedByOrderItem[it.id] || 0;
        const netInbound = Math.max(0, totalOrdered - physicallyReceived);
        stockAndInbound[pId].oc_inbound += netInbound;
      }
    }

    // 8. Identify candidate items for LLM operational assessment
    const activeItemsToAssess: BudgetItemOperationalInput[] = budgetItems
      .filter((it) => {
        const qty = it.quantity ?? 0;
        const exec = executedQuantities[it.id] || 0;
        return qty - exec > 0;
      })
      .map((it) => ({
        budget_item_id: it.id,
        item_code: it.code,
        description: it.description,
        unit: it.unit ?? "unid",
      }));

    // 9. Operational Analysis: Persistent cache from DB (project_progress_forecast_runs) + LLM
    // Per user hardening requirement:
    // - If weather fetch failed: fail-closed immediately to DEGRADED mode (do NOT invent sunny weather).
    // - Calculate deterministic operational_input_hash over project, horizon, start_date, coordinates, sorted active items and sorted forecasts.
    // - For cache hit: exact match on operational_input_hash, created within 24h, llm_analysis_used = true.
    // - Strict factor validation: if ANY cached factor is invalid (null, undefined, NaN, < 0 or > 1), REJECT cache completely and re-run LLM.
    let operationalAnalysis: OperationalAnalysisOutput | null = null;
    let currentOperationalHash: string | null = null;

    if (weatherFailed || forecasts.length === 0) {
      operationalAnalysis = createDegradedOperationalFallback(
        activeItemsToAssess,
        weatherErrorMessage || "Pronóstico meteorológico no disponible (fail-closed)."
      );
    } else {
      currentOperationalHash = calculateOperationalInputHash({
        projectId,
        startDate,
        horizonDays,
        latitude: effectiveLat,
        longitude: effectiveLon,
        items: activeItemsToAssess,
        forecasts,
      });

      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: recentRuns } = await supabase
        .from("project_progress_forecast_runs")
        .select("id, created_at, llm_summary, llm_analysis_used, operational_input_hash, project_progress_forecast_items(budget_item_id, workability_factor, operational_status, operational_reasoning)")
        .eq("project_id", projectId)
        .eq("empresa_id", empresaId)
        .eq("operational_input_hash", currentOperationalHash)
        .eq("llm_analysis_used", true)
        .gte("created_at", twentyFourHoursAgo)
        .order("created_at", { ascending: false })
        .limit(1);

      if (recentRuns && recentRuns.length > 0 && recentRuns[0].project_progress_forecast_items?.length > 0) {
        const run = recentRuns[0];
        const cachedItems = (run.project_progress_forecast_items as any[]) || [];
        const itemMap = new Map(cachedItems.map((ci) => [ci.budget_item_id, ci]));

        // Check if all active items are present
        const allFound = activeItemsToAssess.every((it) => itemMap.has(it.budget_item_id));

        // Strict factor validation helper:
        // Valid factors are numbers between 0 and 1 inclusive.
        // null, undefined, NaN, < 0, > 1 are INVALID and MUST invalidate the whole cache.
        const isStrictlyValidFactor = (val: any): boolean => {
          if (val === null || val === undefined) return false;
          const num = Number(val);
          return typeof num === "number" && !Number.isNaN(num) && Number.isFinite(num) && num >= 0 && num <= 1;
        };

        const allFactorsValid = allFound && activeItemsToAssess.every((it) => {
          const ci = itemMap.get(it.budget_item_id);
          return ci && isStrictlyValidFactor(ci.workability_factor);
        });

        if (allFound && allFactorsValid) {
          operationalAnalysis = {
            items: activeItemsToAssess.map((it) => {
              const ci = itemMap.get(it.budget_item_id)!;
              return {
                budget_item_id: it.budget_item_id,
                workability: ci.operational_status,
                productive_factor: Number(ci.workability_factor),
                reason: ci.operational_reasoning || "Análisis recuperado de corrida persistida reciente.",
              };
            }),
            overall_summary: `${run.llm_summary || "Análisis operacional"} (Cache BD validado por hash)`,
            llm_used: true,
            is_degraded: false,
          };
        } else {
          console.warn(
            `Cache invalidado para proyecto ${projectId}: allFound=${allFound}, allFactorsValid=${allFactorsValid}. Re-ejecutando LLM.`
          );
        }
      }

      if (!operationalAnalysis) {
        operationalAnalysis = await analyzeOperationalWorkability(
          projectId,
          activeItemsToAssess,
          forecasts
        );
      }
    }

    const assessmentsMap: Record<string, any> = {};
    for (const a of operationalAnalysis.items) {
      assessmentsMap[a.budget_item_id] = a;
    }

    // 10. Deterministic calculation engine
    const forecastSummary = computeProgressForecast({
      project_id: projectId,
      horizon_days: horizonDays,
      start_date: startDate,
      budget_items: budgetItems,
      executed_quantities_by_item: executedQuantities,
      recent_execution_entries: recentEntriesList,
      materials_by_item: materialsByItem,
      stock_and_inbound: stockAndInbound,
      operational_assessments: assessmentsMap,
      forecasts,
      llm_used: operationalAnalysis.llm_used,
      is_degraded: operationalAnalysis.is_degraded,
      llm_summary: operationalAnalysis.overall_summary,
      currency: "PYG",
    });
    forecastSummary.climate_metrics = deriveClimateForecastMetrics({
      projectStartDate: project.start_date ?? null,
      asOfDate: new Date().toISOString().slice(0, 10),
      workdays: (climateWorkdays ?? []) as { work_date: string; classification: "WORKABLE" | "NON_WORKABLE_RAIN" | "NON_WORKABLE_RAIN_EFFECT" | "NON_WORKABLE_OTHER"; decision_status: "PROPOSED" | "CONFIRMED" }[],
      budgetItems,
    });

    // 11. Persist run in project_progress_forecast_runs
    const { data: runRecord } = await supabase
      .from("project_progress_forecast_runs")
      .insert({
        empresa_id: empresaId,
        project_id: projectId,
        horizon_days: horizonDays,
        start_date: startDate,
        end_date: forecastSummary.end_date,
        total_projected_physical_value:
          forecastSummary.total_projected_physical_value,
        total_material_consumption_value:
          forecastSummary.total_material_consumption_value,
        total_additional_cash_required:
          forecastSummary.total_additional_cash_required,
        currency: forecastSummary.currency,
        days_in_horizon: forecastSummary.days_in_horizon,
        workable_days_count: forecastSummary.workable_days_count,
        partially_blocked_days_count:
          forecastSummary.partially_blocked_days_count,
        fully_blocked_days_count: forecastSummary.fully_blocked_days_count,
        llm_analysis_used: forecastSummary.llm_analysis_used,
        llm_summary: forecastSummary.llm_summary,
        operational_input_hash: currentOperationalHash,
        calendar_days_elapsed: forecastSummary.climate_metrics.calendar_days_elapsed,
        workable_days_elapsed: forecastSummary.climate_metrics.workable_days_elapsed,
        rain_lost_days: forecastSummary.climate_metrics.rain_lost_days,
        rain_effect_lost_days: forecastSummary.climate_metrics.rain_effect_lost_days,
        other_lost_days: forecastSummary.climate_metrics.other_lost_days,
        effective_available_days: forecastSummary.climate_metrics.effective_available_days,
        gross_schedule_variance: forecastSummary.climate_metrics.gross_schedule_variance,
        weather_adjusted_variance: forecastSummary.climate_metrics.weather_adjusted_variance,
        created_by: profile.id,
      })
      .select("id")
      .single();

    if (runRecord?.id) {
      forecastSummary.id = runRecord.id;

      // Persist snapshot items
      const insertRows = forecastSummary.items.map((it) => ({
        run_id: runRecord.id,
        budget_item_id: it.budget_item_id,
        item_code: it.item_code,
        item_description: it.item_description,
        unit: it.unit,
        remaining_quantity: it.remaining_quantity,
        projected_quantity: it.projected_quantity,
        base_velocity_per_day: it.base_daily_velocity,
        effective_velocity_per_day:
          it.base_daily_velocity * it.workability_factor,
        workability_factor: it.workability_factor,
        operational_status: it.operational_status,
        operational_reasoning: it.operational_reasoning,
        materials_breakdown: it.materials,
      }));

      if (insertRows.length > 0) {
        await supabase
          .from("project_progress_forecast_items")
          .insert(insertRows);
      }
    }

    revalidatePath(`/projects/${projectId}`);
    return { data: forecastSummary, error: null };
  } catch (err: any) {
    console.error("Error running progress forecast action:", err);
    return {
      data: null,
      error: err.message || "Error al calcular la proyección de avance.",
    };
  }
}

/**
 * Creates or updates a material requirement for a budget item (Bill of Materials)
 */
export async function saveBudgetItemMaterialAction(params: {
  projectId: string;
  budgetItemId: string;
  productoId: string;
  cantidadPorUnidad: number;
  desperdicioPct?: number;
}): Promise<{ success: boolean; error: string | null }> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const empresaId = profile.empresa_id;
    const supabase = await createClient();

    const { error } = await supabase.from("budget_item_materials").upsert(
      {
        empresa_id: empresaId,
        project_id: params.projectId,
        budget_item_id: params.budgetItemId,
        producto_id: params.productoId,
        cantidad_por_unidad_ejecutada: params.cantidadPorUnidad,
        desperdicio_pct: params.desperdicioPct ?? 0,
      },
      { onConflict: "budget_item_id,producto_id" }
    );

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath(`/projects/${params.projectId}`);
    return { success: true, error: null };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
