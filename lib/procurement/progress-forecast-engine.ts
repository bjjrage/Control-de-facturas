import {
  BudgetItem,
  DailyWeatherForecast,
  ForecastItemResult,
  MaterialRequirementDetail,
  ProgressForecastRunSummary,
  VelocityConfidence,
} from "@/lib/types";
import { OperationalAssessmentItem } from "./operational-analyst-llm";

export interface BudgetItemMaterialInput {
  budget_item_id: string;
  producto_id: string;
  producto_nombre: string;
  producto_codigo?: string | null;
  unidad_medida: string;
  cantidad_por_unidad_ejecutada: number;
  desperdicio_pct: number;
  costo_unitario: number | null; // From productos.costo_promedio or stock_movimientos
}

export interface StockDisponibilidadInput {
  producto_id: string;
  stock_disponible: number;
  oc_inbound: number;
}

export interface ExecutionHistoryEntry {
  budget_item_id: string;
  entry_date: string; // YYYY-MM-DD
  quantity_executed: number;
}

export interface ProgressForecastEngineInput {
  project_id: string;
  horizon_days: number; // Minimum 7 days
  start_date: string; // YYYY-MM-DD
  budget_items: BudgetItem[];
  executed_quantities_by_item: Record<string, number>; // budget_item_id -> sum(quantity_executed)
  recent_execution_entries?: ExecutionHistoryEntry[]; // Historical observations
  materials_by_item: Record<string, BudgetItemMaterialInput[]>; // budget_item_id -> materials
  stock_and_inbound: Record<string, StockDisponibilidadInput>; // producto_id -> availability
  operational_assessments: Record<string, OperationalAssessmentItem>; // budget_item_id -> LLM/degraded assessment
  forecasts: DailyWeatherForecast[];
  llm_used: boolean;
  is_degraded?: boolean;
  llm_summary?: string;
  currency?: string;
}

/**
 * Computes observed recent execution velocity.
 * 
 * Rules:
 * - Observes execution entries within a recent window (e.g. last 14 to 30 days before start_date).
 * - Distinguishes days where the item was actually active (> 0 quantity or logged activity)
 *   from days where the item was not meant to be worked.
 * - Confidence rating:
 *   - HIGH: >= 5 active days observed.
 *   - MEDIUM: 2 to 4 active days observed.
 *   - LOW: 1 active day observed.
 *   - UNOBSERVED: 0 active days observed in the window (falls back to planned schedule velocity).
 */
export function calculateRecentVelocity(
  itemId: string,
  itemTotalQty: number,
  plannedRemainingDays: number,
  entries: ExecutionHistoryEntry[],
  startDate: string,
  windowDays: number = 30
): {
  velocity: number;
  observationsCount: number;
  windowDays: number;
  confidence: VelocityConfidence;
} {
  const startTs = new Date(startDate).getTime();
  const windowStartTs = startTs - windowDays * 24 * 60 * 60 * 1000;

  // Filter entries for this item within the recent window
  const relevantEntries = entries.filter((e) => {
    if (e.budget_item_id !== itemId) return false;
    const entryTs = new Date(e.entry_date).getTime();
    return entryTs >= windowStartTs && entryTs <= startTs;
  });

  // Group by date to handle multiple entries on the same day
  const dailyTotals: Record<string, number> = {};
  for (const entry of relevantEntries) {
    dailyTotals[entry.entry_date] =
      (dailyTotals[entry.entry_date] || 0) + (Number(entry.quantity_executed) || 0);
  }

  // Active days are those where work actually occurred (> 0)
  const activeDays = Object.keys(dailyTotals).filter((date) => dailyTotals[date] > 0);
  const activeCount = activeDays.length;

  if (activeCount >= 5) {
    // High confidence: median or mean of active days
    const totalActiveQty = activeDays.reduce((sum, d) => sum + dailyTotals[d], 0);
    const meanVelocity = totalActiveQty / activeCount;
    return {
      velocity: Number(meanVelocity.toFixed(4)),
      observationsCount: activeCount,
      windowDays,
      confidence: "HIGH",
    };
  } else if (activeCount >= 2) {
    // Medium confidence
    const totalActiveQty = activeDays.reduce((sum, d) => sum + dailyTotals[d], 0);
    const meanVelocity = totalActiveQty / activeCount;
    return {
      velocity: Number(meanVelocity.toFixed(4)),
      observationsCount: activeCount,
      windowDays,
      confidence: "MEDIUM",
    };
  } else if (activeCount === 1) {
    // Low confidence: single observation
    const vel = dailyTotals[activeDays[0]];
    return {
      velocity: Number(vel.toFixed(4)),
      observationsCount: 1,
      windowDays,
      confidence: "LOW",
    };
  } else {
    // Unobserved: fallback to planned rate
    const safeDays = Math.max(1, plannedRemainingDays);
    const plannedVelocity = itemTotalQty / safeDays;
    return {
      velocity: Number(plannedVelocity.toFixed(4)),
      observationsCount: 0,
      windowDays,
      confidence: "UNOBSERVED",
    };
  }
}

/**
 * Pure deterministic calculation engine for progress, material explosion,
 * stock/inbound deduction, and dual financial metrics.
 * 
 * Guarantees:
 * 1. Horizon minimum enforced at >= 7 days.
 * 2. Progress cannot exceed remaining quantity: Q_proyectada <= Q_presupuestada - Q_ejecutada_previa.
 * 3. If dependencies are not completed, projected progress is 0.
 * 4. Two financial metrics are computed separately:
 *    - total_material_consumption_value: Gross demand * cost
 *    - total_additional_cash_required: Net deficit * cost
 *    Also tracks total_covered_by_stock_value and total_covered_by_inbound_value.
 * 5. Unpriced materials have cost null and are flagged for human review.
 */
export function computeProgressForecast(
  input: ProgressForecastEngineInput
): ProgressForecastRunSummary {
  const {
    project_id,
    horizon_days: rawHorizon,
    start_date,
    budget_items,
    executed_quantities_by_item,
    recent_execution_entries = [],
    materials_by_item,
    stock_and_inbound,
    operational_assessments,
    forecasts,
    llm_used,
    is_degraded = false,
    llm_summary,
    currency = "PYG",
  } = input;

  // Enforce minimum 7 days
  const horizon_days = Math.max(7, rawHorizon);

  // Track stock and inbound allocations across items in this horizon
  // to guarantee that the same warehouse stock is not double counted
  const allocatedStock: Record<string, number> = {};
  const allocatedInbound: Record<string, number> = {};

  const getAvailableStock = (prodId: string) => {
    const total = stock_and_inbound[prodId]?.stock_disponible || 0;
    const used = allocatedStock[prodId] || 0;
    return Math.max(0, total - used);
  };

  const getAvailableInbound = (prodId: string) => {
    const total = stock_and_inbound[prodId]?.oc_inbound || 0;
    const used = allocatedInbound[prodId] || 0;
    return Math.max(0, total - used);
  };

  // Build a map of item completion status to resolve dependencies
  const isItemCompleted = (itemId: string): boolean => {
    const it = budget_items.find((b) => b.id === itemId);
    if (!it) return true; // If missing, do not block
    const executed = executed_quantities_by_item[itemId] || 0;
    const qty = it.quantity ?? 0;
    return executed >= qty;
  };

  // Helper to parse depends_on string (e.g. "uuid1,uuid2" or "uuid1")
  const checkDependenciesMet = (dependsOnStr: string | null): boolean => {
    if (!dependsOnStr || !dependsOnStr.trim()) return true;
    const ids = dependsOnStr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return ids.every((id) => isItemCompleted(id));
  };

  const itemResults: ForecastItemResult[] = [];
  let totalProjectedPhysicalValue = 0;
  let totalMaterialConsumptionValue = 0;
  let totalCoveredByStockValue = 0;
  let totalCoveredByInboundValue = 0;
  let totalAdditionalCashRequired = 0;

  let workableDaysCount = 0;
  let partiallyBlockedDaysCount = 0;
  let fullyBlockedDaysCount = 0;

  // Process day counters from weather forecast
  for (const f of forecasts) {
    if (f.precipitation_sum_mm >= 15.0 || f.wind_gusts_max_kmh >= 45) {
      fullyBlockedDaysCount++;
    } else if (f.precipitation_sum_mm >= 3.0) {
      partiallyBlockedDaysCount++;
    } else {
      workableDaysCount++;
    }
  }

  for (const item of budget_items) {
    const itemQty = item.quantity ?? 0;
    const executedPrevia = executed_quantities_by_item[item.id] || 0;
    const remainingQty = Math.max(0, itemQty - executedPrevia);

    // If item is already 100% complete, skip projection
    if (remainingQty <= 0) {
      continue;
    }

    // Check predecessor dependencies
    const dependenciesMet = checkDependenciesMet(item.depends_on);

    // Determine planned days for fallback velocity
    let plannedDays = horizon_days;
    if (item.start_date && item.end_date) {
      const start = new Date(item.start_date).getTime();
      const end = new Date(item.end_date).getTime();
      const diffDays = Math.round((end - start) / (1000 * 60 * 60 * 24));
      if (diffDays > 0) {
        plannedDays = Math.max(1, diffDays);
      }
    }

    // Calculate observed recent velocity
    const velocityMetrics = calculateRecentVelocity(
      item.id,
      itemQty,
      plannedDays,
      recent_execution_entries,
      start_date,
      30
    );

    const baseVelocityPerDay = velocityMetrics.velocity;

    // Get operational assessment
    const assessment = operational_assessments[item.id] || {
      workability: is_degraded ? "DEGRADED" : "NORMAL",
      productive_factor: 1.0,
      reason: is_degraded
        ? "Análisis climático no disponible."
        : "Sin factores limitantes.",
    };

    let effectiveWorkabilityFactor = assessment.productive_factor;
    let effectiveStatus = assessment.workability;
    let reasoning = assessment.reason;

    if (!dependenciesMet) {
      effectiveWorkabilityFactor = 0.0;
      effectiveStatus = "BLOCKED";
      reasoning = "Bloqueado por dependencias precedentes no finalizadas.";
    }

    // Projected quantity in horizon
    const nominalProjected =
      baseVelocityPerDay * effectiveWorkabilityFactor * horizon_days;
    // Strictly cap at remaining quantity (never exceed 100% of budget item)
    const projectedQuantity = Math.min(remainingQty, Math.max(0, nominalProjected));

    const newCumulative = executedPrevia + projectedQuantity;
    const newProgressPct =
      itemQty > 0 ? (newCumulative / itemQty) * 100 : 0;

    // Physical contract value (unit_price * projected_quantity)
    const physicalValue = (item.unit_price || 0) * projectedQuantity;
    totalProjectedPhysicalValue += physicalValue;

    // Explode materials for this item
    const rawMaterials = materials_by_item[item.id] || [];
    const materialDetails: MaterialRequirementDetail[] = [];

    for (const mat of rawMaterials) {
      // Gross demand = projected_quantity * unit_ratio * (1 + waste%)
      const wasteMultiplier = 1 + (mat.desperdicio_pct || 0) / 100;
      const demandaBruta =
        projectedQuantity * mat.cantidad_por_unidad_ejecutada * wasteMultiplier;

      // Net deficit = max(0, demandaBruta - availableStock - availableInbound)
      const currentStock = getAvailableStock(mat.producto_id);
      const currentInbound = getAvailableInbound(mat.producto_id);

      // Deduct from stock first
      const stockToUse = Math.min(currentStock, demandaBruta);
      allocatedStock[mat.producto_id] =
        (allocatedStock[mat.producto_id] || 0) + stockToUse;

      const remainingDemandAfterStock = demandaBruta - stockToUse;
      const inboundToUse = Math.min(currentInbound, remainingDemandAfterStock);
      allocatedInbound[mat.producto_id] =
        (allocatedInbound[mat.producto_id] || 0) + inboundToUse;

      const deficitCompraNeta = Math.max(
        0,
        remainingDemandAfterStock - inboundToUse
      );

      const hasCost = mat.costo_unitario !== null && mat.costo_unitario > 0;
      const unitCost = hasCost ? (mat.costo_unitario as number) : 0;

      // Economic values
      const valorConsumo = demandaBruta * unitCost;
      const valorCubiertoStock = stockToUse * unitCost;
      const valorCubiertoInbound = inboundToUse * unitCost;
      const cajaRequerida = deficitCompraNeta * unitCost;

      totalMaterialConsumptionValue += valorConsumo;
      totalCoveredByStockValue += valorCubiertoStock;
      totalCoveredByInboundValue += valorCubiertoInbound;
      totalAdditionalCashRequired += cajaRequerida;

      materialDetails.push({
        producto_id: mat.producto_id,
        producto_nombre: mat.producto_nombre,
        producto_codigo: mat.producto_codigo,
        unidad_medida: mat.unidad_medida,
        cantidad_unitaria: mat.cantidad_por_unidad_ejecutada,
        desperdicio_pct: mat.desperdicio_pct,
        demanda_bruta: Number(demandaBruta.toFixed(4)),
        stock_disponible: Number(currentStock.toFixed(4)),
        oc_inbound: Number(currentInbound.toFixed(4)),
        deficit_compra_neta: Number(deficitCompraNeta.toFixed(4)),
        cubierto_por_stock: Number(stockToUse.toFixed(4)),
        cubierto_por_inbound: Number(inboundToUse.toFixed(4)),
        costo_unitario: mat.costo_unitario,
        valor_consumo_proyectado: Number(valorConsumo.toFixed(2)),
        caja_adicional_requerida: Number(cajaRequerida.toFixed(2)),
        requiere_atencion_costo: !hasCost,
      });
    }

    itemResults.push({
      budget_item_id: item.id,
      item_code: item.code,
      item_description: item.description,
      unit: item.unit ?? "unid",
      quantity_presupuestada: itemQty,
      quantity_ejecutada_previa: Number(executedPrevia.toFixed(4)),
      remaining_quantity: Number(remainingQty.toFixed(4)),
      base_daily_velocity: Number(baseVelocityPerDay.toFixed(4)),
      velocity_observations_count: velocityMetrics.observationsCount,
      velocity_window_days: velocityMetrics.windowDays,
      velocity_confidence: velocityMetrics.confidence,
      workability_factor: Number(effectiveWorkabilityFactor.toFixed(3)),
      operational_status: effectiveStatus,
      operational_reasoning: reasoning,
      projected_quantity: Number(projectedQuantity.toFixed(4)),
      new_projected_cumulative_quantity: Number(newCumulative.toFixed(4)),
      new_projected_progress_pct: Number(newProgressPct.toFixed(2)),
      materials: materialDetails,
      valor_fisico_proyectado: Number(physicalValue.toFixed(2)),
    });
  }

  // Calculate end date based on start_date and horizon_days
  const startDateObj = new Date(start_date);
  const endDateObj = new Date(startDateObj);
  endDateObj.setDate(endDateObj.getDate() + horizon_days);
  const endDateStr = endDateObj.toISOString().split("T")[0];

  return {
    project_id,
    horizon_days,
    start_date,
    end_date: endDateStr,
    total_projected_physical_value: Number(
      totalProjectedPhysicalValue.toFixed(2)
    ),
    total_material_consumption_value: Number(
      totalMaterialConsumptionValue.toFixed(2)
    ),
    total_covered_by_stock_value: Number(
      totalCoveredByStockValue.toFixed(2)
    ),
    total_covered_by_inbound_value: Number(
      totalCoveredByInboundValue.toFixed(2)
    ),
    total_additional_cash_required: Number(
      totalAdditionalCashRequired.toFixed(2)
    ),
    currency,
    days_in_horizon: horizon_days,
    workable_days_count: workableDaysCount,
    partially_blocked_days_count: partiallyBlockedDaysCount,
    fully_blocked_days_count: fullyBlockedDaysCount,
    items: itemResults,
    llm_analysis_used: llm_used,
    is_degraded,
    llm_summary,
  };
}
