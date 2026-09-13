import {
  BudgetItem,
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

export interface WeeklyPlanItemTargetInput {
  budget_item_id: string;
  input_mode: WeeklyPlanInputMode;
  input_value: number;
  front_label?: string | null;
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
}

/**
 * Checks if a budget item description/unit represents pure labor or services,
 * so we do not generate a false-positive "MATERIALES NO CONFIGURADOS" warning.
 */
export function isLaborOrServiceItem(item: BudgetItem): boolean {
  const text = `${item.code} ${item.description}`.toLowerCase();
  const unit = (item.unit || "").toLowerCase();

  if (unit === "gl" || unit === "glb" || unit === "mes" || unit === "dia" || unit === "hs" || unit === "hora") {
    return true;
  }

  const laborKeywords = [
    "mano de obra",
    "m.o.",
    "oficial",
    "ayudante",
    "capataz",
    "replanteo",
    "limpieza",
    "seguridad",
    "honorarios",
    "servicio",
    "alquiler",
    "flete",
    "ensayo",
    "topografia",
    "instalacion",
    "subcontrato",
  ];

  return laborKeywords.some((kw) => text.includes(kw));
}

/**
 * Pure deterministic calculation engine for Weekly Plan / Lookahead.
 * 
 * Guarantees:
 * 1. 100% deterministic math without Open-Meteo or LLM dependencies.
 * 2. Contractual capping: target_quantity cannot exceed remaining_quantity.
 * 3. Percentage points conversion: target_quantity = contractual_quantity * (input_value / 100).
 * 4. Global progress is strictly value-weighted:
 *    global_pct = sum(min(executed, contractual) * unit_price) / sum(contractual * unit_price) * 100.
 * 5. Sequential stock & inbound deduction across items without double counting.
 * 6. Explicit warning flag for unconfigured BOM materials (unless pure labor/service).
 * 7. Advisory capacity check against observed velocity without blocking calculations.
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

  // Build target lookup
  const targetMap = new Map<string, WeeklyPlanItemTargetInput>();
  for (const t of targets) {
    targetMap.set(t.budget_item_id, t);
  }

  const calculatedItems: WeeklyPlanItemCalculation[] = [];
  let totalPlanContractualValue = 0;
  let totalMaterialConsumptionValue = 0;
  let totalCoveredByStockValue = 0;
  let totalCoveredByInboundValue = 0;
  let totalAdditionalCashRequired = 0;
  let unconfiguredMaterialsCount = 0;

  // Plan duration in days for advisory comparison
  const planStartTs = new Date(start_date).getTime();
  const planEndTs = new Date(end_date).getTime();
  const planDays = Math.max(1, Math.round((planEndTs - planStartTs) / (1000 * 60 * 60 * 24)) + 1);

  for (const item of budget_items) {
    const targetInput = targetMap.get(item.id);
    if (!targetInput || targetInput.input_value <= 0) {
      continue;
    }

    const contractualQty = item.quantity ?? 0;
    const prevExecQty = executed_quantities_by_item[item.id] || 0;
    const remainingQty = Math.max(0, contractualQty - prevExecQty);
    const unitPrice = item.unit_price ?? 0;

    // Convert requested quantity based on input_mode
    let requestedQuantity = 0;
    if (targetInput.input_mode === "CONTRACT_PERCENTAGE_POINTS") {
      // e.g. 5 percentage points of contractual quantity
      requestedQuantity = contractualQty * (targetInput.input_value / 100);
    } else {
      requestedQuantity = targetInput.input_value;
    }

    // Contractual capping: target_quantity cannot exceed remaining_quantity
    const targetQuantity = Math.max(0, Math.min(requestedQuantity, remainingQty));
    const wasCapped = requestedQuantity > remainingQty;

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

    // Check BOM configuration and classify labor vs materials
    const rawMaterials = materials_by_item[item.id] || [];
    const isLabor = isLaborOrServiceItem(item);
    const bomConfigured = rawMaterials.length > 0;
    let materialsWarning: string | null = null;

    if (!bomConfigured && !isLabor && targetQuantity > 0) {
      materialsWarning = "MATERIALES NO CONFIGURADOS";
      unconfiguredMaterialsCount++;
    }

    // Advisory capacity check: compare target rate per day with historical observed velocity
    let advisoryWarning: string | null = null;
    if (targetQuantity > 0) {
      const plannedDailyRate = targetQuantity / planDays;
      const recentVelocity = calculateRecentVelocity(
        item.id,
        contractualQty,
        planDays,
        recent_execution_entries,
        start_date,
        30,
        { start_date: item.start_date, end_date: item.end_date }
      );

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

    // Explode materials and calculate net purchase demand
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
      item_code: item.code,
      item_description: item.description,
      unit: item.unit || "unid",
      contractual_quantity: contractualQty,
      previously_executed_quantity: prevExecQty,
      remaining_quantity: remainingQty,
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
      is_labor_or_service: isLabor,
      bom_configured: bomConfigured,
      materials_warning: materialsWarning,
      advisory_capacity_warning: advisoryWarning,
      materials: materialDetails,
    });
  }

  // Calculate global target progress value-weighted
  let globalTargetValue = globalPreviouslyExecutedValue;
  for (const ci of calculatedItems) {
    globalTargetValue += ci.contractual_value_target;
  }
  // Cap global target value at global contractual value
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
  };
}
