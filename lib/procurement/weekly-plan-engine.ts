import {
  BudgetItem,
  DailyWeatherForecast,
  MaterialRequirementDetail,
  WeeklyPlanCalculationSummary,
  WeeklyPlanInputMode,
  WeeklyPlanItemCalculation,
  WeeklyPlanStatus,
} from "@/lib/types";
import {
  BudgetItemMaterialInput,
  StockDisponibilidadInput,
  ExecutionHistoryEntry,
  calculateRecentVelocity,
} from "./progress-forecast-engine";
import { OperationalAssessmentItem } from "./operational-analyst-llm";

export interface WeeklyPlanItemTargetInput {
  budget_item_id: string;
  front_label?: string | null;
  input_mode: WeeklyPlanInputMode;
  input_value: number;
}

export interface WeeklyPlanEngineInput {
  plan_id?: string;
  project_id: string;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  status?: WeeklyPlanStatus;
  budget_items: BudgetItem[];
  executed_quantities_by_item: Record<string, number>;
  targets: WeeklyPlanItemTargetInput[];
  materials_by_item: Record<string, BudgetItemMaterialInput[]>;
  stock_and_inbound: Record<string, StockDisponibilidadInput>;
  recent_execution_entries?: ExecutionHistoryEntry[];
  currency?: string;
  // Weather overlay input (optional)
  weather_overlay_enabled?: boolean;
  weather_forecasts?: DailyWeatherForecast[];
  operational_assessments?: Record<string, OperationalAssessmentItem>;
  weather_snapshot_id?: string | null;
  weather_provider?: string;
  weather_failed_closed?: boolean;
}

/**
 * Audit and check BOM requirement state without brittle description keyword heuristics.
 * 
 * Rules:
 * 1. If item.material_requirement === 'NO_MATERIAL': BOM is NOT required (pure labor/service).
 * 2. If item.material_requirement === 'REQUIRES_BOM': BOM is strictly required. If missing -> 'MATERIALES NO CONFIGURADOS'.
 * 3. If item.material_requirement === 'UNKNOWN' or undefined:
 *    - If BOM is present -> valid.
 *    - If target > 0 and no BOM -> 'REVISIÓN REQUERIDA (MATERIALES NO DEFINIDOS)'.
 */
export function checkItemBomRequirement(
  item: BudgetItem,
  hasBom: boolean,
  targetQuantity: number
): {
  isLaborOrService: boolean;
  bomWarning: string | null;
} {
  const req = item.material_requirement || "UNKNOWN";

  if (req === "NO_MATERIAL") {
    return { isLaborOrService: true, bomWarning: null };
  }

  if (req === "REQUIRES_BOM") {
    if (!hasBom && targetQuantity > 0) {
      return { isLaborOrService: false, bomWarning: "MATERIALES NO CONFIGURADOS" };
    }
    return { isLaborOrService: false, bomWarning: null };
  }

  // UNKNOWN requirement
  if (!hasBom && targetQuantity > 0) {
    return {
      isLaborOrService: false,
      bomWarning: "REVISIÓN REQUERIDA (MATERIALES NO DEFINIDOS)",
    };
  }

  return { isLaborOrService: false, bomWarning: null };
}

/**
 * Pure deterministic calculation engine for Weekly Plan / Lookahead with:
 * 1. Multi-front support (same budget item across multiple sectors/frentes).
 * 2. Capping against remaining contractual quantity across all fronts of the item.
 * 3. Value-weighted global progress calculation.
 * 4. Sequential warehouse stock & authorized OC inbound deduction.
 * 5. Optional Weather Overlay (without modifying base plan targets).
 */
export function calculateWeeklyPlanRequirements(
  input: WeeklyPlanEngineInput
): WeeklyPlanCalculationSummary {
  const {
    plan_id,
    project_id,
    start_date,
    end_date,
    status = "DRAFT",
    budget_items,
    executed_quantities_by_item,
    targets,
    materials_by_item,
    stock_and_inbound,
    recent_execution_entries = [],
    currency = "PYG",
    weather_overlay_enabled = false,
    weather_forecasts = [],
    operational_assessments = {},
    weather_snapshot_id = null,
    weather_provider = "open-meteo",
    weather_failed_closed = false,
  } = input;

  // Track stock and inbound allocations sequentially to prevent double counting
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

  // 1. Calculate global contractual value across all budget items
  let globalContractualValue = 0;
  let globalPreviouslyExecutedValue = 0;

  const itemMap = new Map<string, BudgetItem>();
  for (const b of budget_items) {
    itemMap.set(b.id, b);
    const cQty = b.quantity ?? 0;
    const uPrice = b.unit_price ?? 0;
    const eQty = executed_quantities_by_item[b.id] || 0;

    const itemContractVal = cQty * uPrice;
    globalContractualValue += itemContractVal;

    const validExecQty = Math.min(eQty, cQty);
    globalPreviouslyExecutedValue += validExecQty * uPrice;
  }

  const globalCurrentProgressPct =
    globalContractualValue > 0
      ? Number(((globalPreviouslyExecutedValue / globalContractualValue) * 100).toFixed(4))
      : 0;

  // Group targets by budget_item_id to handle multi-front tracking & joint capping
  const targetsByItem: Record<string, WeeklyPlanItemTargetInput[]> = {};
  for (const t of targets) {
    if (t.input_value > 0) {
      if (!targetsByItem[t.budget_item_id]) {
        targetsByItem[t.budget_item_id] = [];
      }
      targetsByItem[t.budget_item_id].push(t);
    }
  }

  const calculatedItems: WeeklyPlanItemCalculation[] = [];
  let totalPlanContractualValue = 0;
  let totalMaterialConsumptionValue = 0;
  let totalCoveredByStockValue = 0;
  let totalCoveredByInboundValue = 0;
  let totalAdditionalCashRequired = 0;
  let unconfiguredMaterialsCount = 0;

  // Weather overlay accumulators
  let weatherAdjustedMaterialConsumptionValue = 0;
  let weatherDaysAffectedCount = 0;

  if (weather_overlay_enabled && weather_forecasts.length > 0) {
    for (const f of weather_forecasts) {
      if (f.precipitation_sum_mm >= 3.0 || f.wind_gusts_max_kmh >= 45) {
        weatherDaysAffectedCount++;
      }
    }
  }

  // Plan duration in days for advisory comparison
  const planStartTs = new Date(start_date).getTime();
  const planEndTs = new Date(end_date).getTime();
  const planDays = Math.max(1, Math.round((planEndTs - planStartTs) / (1000 * 60 * 60 * 24)) + 1);

  // Process all targets per item, tracking remaining cumulative capacity across multiple fronts
  for (const item of budget_items) {
    const itemTargetList = targetsByItem[item.id] || [];
    if (itemTargetList.length === 0) {
      continue;
    }

    const contractualQty = item.quantity ?? 0;
    const prevExecQty = executed_quantities_by_item[item.id] || 0;
    let itemRemainingBudget = Math.max(0, contractualQty - prevExecQty);
    const unitPrice = item.unit_price ?? 0;

    // Advisory velocity metrics for item
    const recentVelocity = calculateRecentVelocity(
      item.id,
      contractualQty,
      planDays,
      recent_execution_entries,
      start_date,
      30,
      { start_date: item.start_date, end_date: item.end_date }
    );

    // Weather operational factor for item if overlay enabled
    let weatherFactor = 1.0;
    if (weather_overlay_enabled && !weather_failed_closed) {
      const assessment = operational_assessments[item.id];
      if (assessment && typeof assessment.productive_factor === "number") {
        weatherFactor = Math.max(0, Math.min(1.0, assessment.productive_factor));
      }
    }

    const rawMaterials = materials_by_item[item.id] || [];
    const hasBom = rawMaterials.length > 0;

    for (const targetInput of itemTargetList) {
      let requestedQuantity = 0;
      if (targetInput.input_mode === "CONTRACT_PERCENTAGE_POINTS") {
        requestedQuantity = contractualQty * (targetInput.input_value / 100);
      } else {
        requestedQuantity = targetInput.input_value;
      }

      // Cap against the shared remaining budget for this budget item
      const targetQuantity = Math.max(0, Math.min(requestedQuantity, itemRemainingBudget));
      const wasCapped = requestedQuantity > itemRemainingBudget;
      // Deduct used quantity from remaining budget for next fronts
      itemRemainingBudget = Math.max(0, itemRemainingBudget - targetQuantity);

      // Item-level progress percentages
      const currentProgressPct =
        contractualQty > 0
          ? Number(((Math.min(prevExecQty, contractualQty) / contractualQty) * 100).toFixed(2))
          : 0;

      const newTargetCumulative = Math.min(contractualQty, prevExecQty + targetQuantity);
      const targetProgressPct =
        contractualQty > 0
          ? Number(((newTargetCumulative / contractualQty) * 100).toFixed(2))
          : 0;

      const itemIncrementPp = Number((targetProgressPct - currentProgressPct).toFixed(2));
      const contractualValueTarget = targetQuantity * unitPrice;
      totalPlanContractualValue += contractualValueTarget;

      // BOM validation
      const { isLaborOrService, bomWarning } = checkItemBomRequirement(
        item,
        hasBom,
        targetQuantity
      );

      if (bomWarning) {
        unconfiguredMaterialsCount++;
      }

      // Advisory capacity check
      let advisoryWarning: string | null = null;
      if (targetQuantity > 0) {
        const plannedDailyRate = targetQuantity / planDays;
        if (
          (recentVelocity.confidence === "HIGH" || recentVelocity.confidence === "MEDIUM") &&
          recentVelocity.velocity > 0
        ) {
          const ratio = plannedDailyRate / recentVelocity.velocity;
          if (ratio > 2.0) {
            advisoryWarning = `Meta agresiva: ${ratio.toFixed(1)}x superior a la velocidad observada reciente (${recentVelocity.velocity.toFixed(2)} ${item.unit || "unid"}/día)`;
          }
        }
      }

      // Weather overlay projection for this target/front
      let weatherAdjustedCapacity: number | null = null;
      let weatherGapQuantity: number | null = null;

      if (weather_overlay_enabled && !weather_failed_closed) {
        weatherAdjustedCapacity = Number((targetQuantity * weatherFactor).toFixed(4));
        weatherGapQuantity = Number((weatherAdjustedCapacity - targetQuantity).toFixed(4));
      }

      // Explode materials for base target
      const materialDetails: MaterialRequirementDetail[] = [];

      for (const mat of rawMaterials) {
        const wasteMultiplier = 1 + (mat.desperdicio_pct || 0) / 100;
        const demandaBruta =
          targetQuantity * mat.cantidad_por_unidad_ejecutada * wasteMultiplier;

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

        const valorConsumo = demandaBruta * unitCost;
        const valorCubiertoStock = stockToUse * unitCost;
        const valorCubiertoInbound = inboundToUse * unitCost;
        const cajaRequerida = deficitCompraNeta * unitCost;

        totalMaterialConsumptionValue += valorConsumo;
        totalCoveredByStockValue += valorCubiertoStock;
        totalCoveredByInboundValue += valorCubiertoInbound;
        totalAdditionalCashRequired += cajaRequerida;

        // Weather-adjusted material consumption
        if (weather_overlay_enabled && weatherAdjustedCapacity !== null) {
          const weatherDemandaBruta =
            weatherAdjustedCapacity * mat.cantidad_por_unidad_ejecutada * wasteMultiplier;
          weatherAdjustedMaterialConsumptionValue += weatherDemandaBruta * unitCost;
        }

        materialDetails.push({
          producto_id: mat.producto_id,
          producto_nombre: mat.producto_nombre,
          producto_codigo: mat.producto_codigo,
          unidad_medida: mat.unidad_medida,
          cantidad_unitaria: mat.cantidad_por_unidad_ejecutada,
          desperdicio_pct: mat.desperdicio_pct,
          demanda_bruta: Number(demandaBruta.toFixed(4)),
          stock_disponible: currentStock,
          oc_inbound: currentInbound,
          deficit_compra_neta: Number(deficitCompraNeta.toFixed(4)),
          cubierto_por_stock: Number(stockToUse.toFixed(4)),
          cubierto_por_inbound: Number(inboundToUse.toFixed(4)),
          costo_unitario: mat.costo_unitario,
          valor_consumo_proyectado: Math.round(valorConsumo),
          caja_adicional_requerida: Math.round(cajaRequerida),
          requiere_atencion_costo: !hasCost,
        });
      }

      calculatedItems.push({
        budget_item_id: item.id,
        front_label: targetInput.front_label || null,
        item_code: item.code,
        item_description: item.description,
        unit: item.unit || "unid",
        contractual_quantity: contractualQty,
        previously_executed_quantity: prevExecQty,
        remaining_quantity: contractualQty - prevExecQty,
        unit_price: unitPrice,
        input_mode: targetInput.input_mode,
        input_value: targetInput.input_value,
        requested_quantity: Number(requestedQuantity.toFixed(4)),
        target_quantity: Number(targetQuantity.toFixed(4)),
        was_capped: wasCapped,
        item_current_progress_pct: currentProgressPct,
        item_target_progress_pct: targetProgressPct,
        item_increment_pp: itemIncrementPp,
        contractual_value_target: Math.round(contractualValueTarget),
        is_labor_or_service: isLaborOrService,
        bom_configured: hasBom,
        materials_warning: bomWarning,
        advisory_capacity_warning: advisoryWarning,
        materials: materialDetails,
        weather_adjusted_capacity: weatherAdjustedCapacity,
        weather_gap_quantity: weatherGapQuantity,
        weather_workability_factor: weather_overlay_enabled ? weatherFactor : null,
      });
    }
  }

  // Calculate global target progress value-weighted
  let globalTargetValue = globalPreviouslyExecutedValue;
  for (const ci of calculatedItems) {
    globalTargetValue += ci.contractual_value_target;
  }
  globalTargetValue = Math.min(globalTargetValue, globalContractualValue);

  const globalTargetProgressPct =
    globalContractualValue > 0
      ? Number(((globalTargetValue / globalContractualValue) * 100).toFixed(2))
      : 0;

  const globalIncrementPp = Number(
    (globalTargetProgressPct - globalCurrentProgressPct).toFixed(2)
  );

  return {
    plan_id,
    project_id,
    start_date,
    end_date,
    status,
    global_contractual_value: Math.round(globalContractualValue),
    global_previously_executed_value: Math.round(globalPreviouslyExecutedValue),
    global_current_progress_pct: Number(globalCurrentProgressPct.toFixed(2)),
    global_target_progress_pct: globalTargetProgressPct,
    global_increment_pp: globalIncrementPp,
    total_plan_contractual_value: Math.round(totalPlanContractualValue),
    total_material_consumption_value: Math.round(totalMaterialConsumptionValue),
    total_covered_by_stock_value: Math.round(totalCoveredByStockValue),
    total_covered_by_inbound_value: Math.round(totalCoveredByInboundValue),
    total_additional_cash_required: Math.round(totalAdditionalCashRequired),
    currency,
    items: calculatedItems,
    unconfigured_materials_count: unconfiguredMaterialsCount,
    // Weather overlay properties
    weather_overlay_enabled,
    weather_snapshot_id,
    weather_provider,
    weather_forecasts_count: weather_forecasts.length,
    weather_days_affected_count: weatherDaysAffectedCount,
    weather_adjusted_material_consumption_value: weather_overlay_enabled
      ? Math.round(weatherAdjustedMaterialConsumptionValue)
      : null,
    weather_summary: weather_overlay_enabled
      ? weather_failed_closed
        ? "Pronóstico climático no disponible (fail-closed)."
        : `Pronóstico LIVE (${weather_forecasts.length} días) evaluado con ${weatherDaysAffectedCount} días afectados.`
      : null,
    weather_failed_closed,
  };
}
