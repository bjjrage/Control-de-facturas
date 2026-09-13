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
  BudgetItemOperationalInput,
} from "@/lib/procurement/operational-analyst-llm";
import {
  computeProgressForecast,
  BudgetItemMaterialInput,
  StockDisponibilidadInput,
} from "@/lib/procurement/progress-forecast-engine";

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
      .select("id, name, location, latitude, longitude, currency:contract_amount")
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
    try {
      forecasts = await fetchWeatherForecast(
        effectiveLat,
        effectiveLon,
        horizonDays
      );
    } catch (wErr) {
      console.warn("Weather forecast fetch error:", wErr);
      const today = new Date(startDate);
      for (let i = 0; i < horizonDays; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        forecasts.push({
          date: d.toISOString().split("T")[0],
          precipitation_sum_mm: 0,
          precipitation_hours: 0,
          wind_gusts_max_kmh: 15,
          weather_code: 0,
        });
      }
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

    // 7. Fetch authorized inbound orders (strictly in transit / authorized without reception)
    const { data: rawOrders } = await supabase
      .from("authorized_orders")
      .select("id, status, authorized_order_items(producto_id, quantity, quantity_invoiced)")
      .eq("project_id", projectId)
      .eq("empresa_id", empresaId)
      .in("status", ["approved", "authorized", "in_transit"]);

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
        // Deduct any quantity already invoiced/received to avoid double-counting
        const totalOrdered = Number(it.quantity) || 0;
        const alreadyInvoiced = Number(it.quantity_invoiced) || 0;
        const netInbound = Math.max(0, totalOrdered - alreadyInvoiced);
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

    // 9. LLM Operational Analysis (with cache and explicit degraded status)
    const operationalAnalysis = await analyzeOperationalWorkability(
      projectId,
      activeItemsToAssess,
      forecasts
    );

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
