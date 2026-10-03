import type {
  BudgetItem,
  DailyWeatherForecast,
  WeeklyPlanInputMode,
} from "@/lib/types";
import type {
  BudgetItemMaterialInput,
  StockDisponibilidadInput,
  ExecutionHistoryEntry,
} from "./progress-forecast-engine";
import type { PlanHourLineInput, PlanSubcontractLineInput, WeeklyPlanItemTargetInput } from "./weekly-plan-engine";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveProjectMaterialPrices } from "@/lib/costing/project-prices";
import type { OperationalAssessmentItem } from "./operational-analyst-llm";
import { physicalNumber, samePhysicalUnit } from "./weekly-plan-validation";

// ---------------------------------------------------------------------------
// Tipos de preview (metas locales aún no guardadas)
// ---------------------------------------------------------------------------

export interface PreviewWeeklyPlanItemInput {
  budgetItemId: string;
  frontLabel?: string | null;
  inputMode: WeeklyPlanInputMode;
  inputValue: number;
}

export interface PreviewWeeklyPlanParams {
  projectId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  weatherOverlay: boolean;
  items: PreviewWeeklyPlanItemInput[];
}

export function aggregateProjectStockByProduct(
  rows: { producto_id: string; quantity: unknown }[]
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    const quantity = physicalNumber(row.quantity, "Stock canónico");
    totals[row.producto_id] =
      (totals[row.producto_id] || 0) + quantity;
  }
  return totals;
}

export interface WeeklyPlanBaseData {
  project: {
    id: string;
    name?: string | null;
    latitude?: number | string | null;
    longitude?: number | string | null;
  };
  budgetItems: BudgetItem[];
  executedQuantities: Record<string, number>;
  recentEntries: ExecutionHistoryEntry[];
  materialsByItem: Record<string, BudgetItemMaterialInput[]>;
  /** Mano de obra, equipos y subcontratos de las recetas (APU), por partida. */
  laborByItem: Record<string, PlanHourLineInput[]>;
  equipmentByItem: Record<string, PlanHourLineInput[]>;
  subcontractsByItem: Record<string, PlanSubcontractLineInput[]>;
  stockAndInbound: Record<string, StockDisponibilidadInput>;
  /**
   * Detalle de inbound por línea (ADITIVO V3, no altera el mapa legacy):
   * neto físico con fecha esperada para la regla "llega a tiempo".
   * null si la columna aún no existe en la DB (fail-safe: todo no confirmado).
   */
  inboundDetails: InboundDetail[] | null;
  baselineCertificate?: {
    id: string;
    numero: number;
    period_end: string;
  } | null;
}

export interface InboundDetail {
  order_item_id: string;
  producto_id: string;
  net_quantity: number;
  expected_delivery_date: string | null;
}

export interface CentralAvailability {
  location: { id: string; name: string } | null;
  /** Físico central − reservas ACTIVE (nunca negativo). Vacío si no hay central. */
  availableByProduct: Record<string, number>;
}

export interface ResolvedWeeklyWeather {
  forecasts: DailyWeatherForecast[];
  snapshotId: string | null;
  assessments: Record<string, OperationalAssessmentItem>;
  failedClosed: boolean;
  requestedDays: number;
  coveredDays: number;
  partialCoverage: boolean;
}

// ---------------------------------------------------------------------------
// Helpers puros (sin I/O) — usados por UI, preview y tests
// ---------------------------------------------------------------------------

/**
 * Convierte metas locales de UI a inputs canónicos del engine.
 * Regla: solo input_value > 0 participa (igual que engine y RPC).
 * NO capa ni valida remanente aquí: el capping lo hace el engine/RPC.
 */
export function toEngineTargets(
  items: PreviewWeeklyPlanItemInput[]
): WeeklyPlanItemTargetInput[] {
  return (items ?? [])
    .filter((it) => Number(it.inputValue) > 0)
    .map((it) => ({
      budget_item_id: it.budgetItemId,
      front_label: it.frontLabel?.trim() ? it.frontLabel.trim() : null,
      input_mode: it.inputMode,
      input_value: Number(it.inputValue),
    }));
}

/**
 * Traducción informativa inmediata +pp contrato → cantidad física.
 * Base canónica: cantidad física. NO persiste nada.
 * Ej: contractual 120 m³, +10pp → 12 m³.
 */
export function translateTargetToQuantity(
  contractualQty: number,
  mode: WeeklyPlanInputMode,
  value: number
): number {
  const c = Number(contractualQty) || 0;
  const v = Number(value) || 0;
  if (mode === "CONTRACT_PERCENTAGE_POINTS") {
    return Number(((c * v) / 100).toFixed(4));
  }
  return Number(v.toFixed(4));
}

/**
 * Suma lo solicitado (ya traducido a físico) por partida, para validar
 * multi-frente contra el remanente compartido antes de calcular.
 */
export function sumRequestedByItem(
  items: PreviewWeeklyPlanItemInput[],
  contractualByItem: Record<string, number>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items ?? []) {
    const v = Number(it.inputValue) || 0;
    if (v <= 0) continue;
    const c = Number(contractualByItem[it.budgetItemId]) || 0;
    const qty = translateTargetToQuantity(c, it.inputMode, v);
    out[it.budgetItemId] = (out[it.budgetItemId] || 0) + qty;
  }
  return out;
}

/**
 * Remanente contractual por partida: max(0, contractual - ejecutado).
 * Misma definición que el engine (línea ~208).
 */
export function remainingForItem(
  contractualQty: number,
  executedQty: number
): number {
  return Math.max(0, (Number(contractualQty) || 0) - (Number(executedQty) || 0));
}

/**
 * ¿La partida es un agrupador/rubro (cantidad contractual 0)?
 * Semántica existente: el engine capearia cualquier meta a 0 (remaining=0).
 * La UX no debe ofrecerla como ejecutable normal.
 */
export function isGroupingItem(item: Pick<BudgetItem, "quantity">): boolean {
  return !(Number(item.quantity) > 0);
}

/**
 * Selecciona el certificado contractual utilizable con el corte más reciente (period_end DESC).
 * Desempate por numero DESC. Excluye certificados sin period_end.
 */
export function selectBaselineCertificate<
  T extends { id: string; period_end?: string | null; numero?: number | null }
>(certificates: T[]): T | null {
  const candidates = (certificates ?? []).filter((c) => !!c.period_end);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const endA = String(a.period_end ?? "").trim();
    const endB = String(b.period_end ?? "").trim();
    const diff = endB.localeCompare(endA);
    if (diff !== 0) return diff;
    return (Number(b.numero) || 0) - (Number(a.numero) || 0);
  });
  return candidates[0] ?? null;
}

export interface ComputeBaselineWithDeltasInput {
  budgetItems: Array<Pick<BudgetItem, "id"> & { code?: string | null }>;
  baselineCertificate: { id: string; period_end: string; numero?: number | null } | null;
  certificateItems?: Array<{
    certificate_id?: string;
    budget_item_id?: string | null;
    codigo?: string | null;
    qty_acumulada?: number | null;
  }>;
  executionEntries: Array<{
    budget_item_id: string;
    quantity_executed?: number | null;
    entry_date?: string | null;
  }>;
}

export interface ComputeBaselineWithDeltasResult {
  executedQuantities: Record<string, number>;
  recentEntries: ExecutionHistoryEntry[];
  mappedItemsCount: number;
  unmappedItemsCount: number;
}

/**
 * Resuelve las cantidades ejecutadas combinando la línea base contractual
 * del certificado más reciente con los deltas de partes diarios posteriores.
 *
 * Reglas de negocio:
 * 1. baselineQty = qty_acumulada del certificado seleccionado.
 * 2. Mapeo a budget item:
 *    a) budget_item_id directo si existe y pertenece a budgetItems.
 *    b) fallback por codigo == budget_items.code solamente si es match único.
 *    c) si es ambiguo o no existe, NO inventar match.
 * 3. deltaQty = SUM(execution_entries.quantity_executed) WHERE entry_date > certificate.period_end.
 *    (Partes anteriores o iguales al period_end NO se suman para evitar doble conteo).
 * 4. executedQty = baselineQty + deltaQty.
 * 5. Si no existe certificado baseline: comportamiento actual intacto basado 100% en execution_entries.
 * 6. recentEntries para velocidad: proviene exclusivamente de partes diarios reales (nunca del certificado).
 */
export function computeBaselineWithDeltas(
  input: ComputeBaselineWithDeltasInput
): ComputeBaselineWithDeltasResult {
  const {
    budgetItems,
    baselineCertificate,
    certificateItems = [],
    executionEntries = [],
  } = input;

  // 1. Historial operativo para velocidad: SOLO partes diarios reales
  const recentEntries: ExecutionHistoryEntry[] = [];
  for (const entry of executionEntries) {
    if (entry.entry_date) {
      recentEntries.push({
        budget_item_id: entry.budget_item_id,
        entry_date: entry.entry_date,
        quantity_executed: Number(entry.quantity_executed) || 0,
      });
    }
  }

  // 2. Si NO existe certificado baseline: comportamiento actual intacto
  if (!baselineCertificate) {
    const executedQuantities: Record<string, number> = {};
    for (const entry of executionEntries) {
      const bId = entry.budget_item_id;
      const q = Number(entry.quantity_executed) || 0;
      executedQuantities[bId] = (executedQuantities[bId] || 0) + q;
    }
    return {
      executedQuantities,
      recentEntries,
      mappedItemsCount: 0,
      unmappedItemsCount: 0,
    };
  }

  // 3. Resolución de baseline contractual
  const validBudgetItemIds = new Set(budgetItems.map((b) => b.id));
  const itemsByCode = new Map<string, Array<{ id: string }>>();
  for (const b of budgetItems) {
    const normCode = (b.code ?? "").trim().toLowerCase();
    if (!normCode) continue;
    const list = itemsByCode.get(normCode) || [];
    list.push(b);
    itemsByCode.set(normCode, list);
  }

  const baselineQtyByItem: Record<string, number> = {};
  let mappedItemsCount = 0;
  let unmappedItemsCount = 0;

  for (const certItem of certificateItems) {
    if (certItem.certificate_id && certItem.certificate_id !== baselineCertificate.id) {
      continue;
    }

    let resolvedBudgetItemId: string | null = null;

    if (certItem.budget_item_id && validBudgetItemIds.has(certItem.budget_item_id)) {
      resolvedBudgetItemId = certItem.budget_item_id;
    } else if (certItem.codigo) {
      const normCode = certItem.codigo.trim().toLowerCase();
      const matching = itemsByCode.get(normCode);
      if (matching && matching.length === 1) {
        resolvedBudgetItemId = matching[0].id;
      }
    }

    if (resolvedBudgetItemId) {
      const q = Number(certItem.qty_acumulada) || 0;
      baselineQtyByItem[resolvedBudgetItemId] =
        (baselineQtyByItem[resolvedBudgetItemId] || 0) + q;
      mappedItemsCount++;
    } else {
      unmappedItemsCount++;
    }
  }

  // 4. Deltas: SUM(execution_entries.quantity_executed) WHERE entry_date > certificate.period_end
  const deltaQtyByItem: Record<string, number> = {};
  const cutoffDate = String(baselineCertificate.period_end).trim();

  for (const entry of executionEntries) {
    const entryDate = entry.entry_date ? String(entry.entry_date).trim() : null;
    if (entryDate && entryDate > cutoffDate) {
      const bId = entry.budget_item_id;
      const q = Number(entry.quantity_executed) || 0;
      deltaQtyByItem[bId] = (deltaQtyByItem[bId] || 0) + q;
    }
  }

  // 5. executedQty = baselineQty + deltaQty
  const executedQuantities: Record<string, number> = {};
  for (const b of budgetItems) {
    const base = baselineQtyByItem[b.id] || 0;
    const delta = deltaQtyByItem[b.id] || 0;
    executedQuantities[b.id] = base + delta;
  }

  for (const [bId, delta] of Object.entries(deltaQtyByItem)) {
    if (!(bId in executedQuantities)) {
      executedQuantities[bId] = delta;
    }
  }

  return {
    executedQuantities,
    recentEntries,
    mappedItemsCount,
    unmappedItemsCount,
  };
}

// ---------------------------------------------------------------------------
// Loader compartido (server): mismos datos reales para load y preview
// ---------------------------------------------------------------------------
// NOTA DE CONTRATO — persistencia de clima en preview:
// El preview NO inserta ni actualiza project_weekly_plans ni
// project_weekly_plan_items (verificado por tests). Cuando Clima=ON, SÍ crea
// un batch append-only en project_weather_forecast_batches + snapshots,
// EXACTAMENTE igual que getWeeklyPlanDetailsAction. Motivo: mantener el
// contrato actual (el save enlaza weather_snapshot_batch_id) y evitar
// divergencia preview-vs-save. Cuando Clima=OFF: cero llamadas
// meteorológicas y cero inserts de clima.

type SupabaseLike = {
  from: (table: string) => any;
};

export async function loadWeeklyPlanBaseData(
  supabase: SupabaseLike,
  projectId: string,
  empresaId: string
): Promise<{ data: WeeklyPlanBaseData | null; error: string | null }> {
  // 1. Proyecto (mismo scoping tenant que la action actual)
  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id, name, start_date, plazo_dias, latitude, longitude")
    .eq("id", projectId)
    .eq("empresa_id", empresaId)
    .single();

  if (projErr || !project) {
    return { data: null, error: "Proyecto no encontrado o sin permisos." };
  }

  // 2. Partidas — por sort_order, no por code: "code" es texto y ordena
  // "1, 10, 11, ... 19, 2, 20..." en vez de 1, 2, 3... (confirmado en vivo
  // con MAGY, códigos 1-53 sin puntos). sort_order ya viene secuencial desde
  // la importación.
  const { data: rawBudgetItems, error: bErr } = await supabase
    .from("budget_items")
    .select("*")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true });

  if (bErr || !rawBudgetItems || rawBudgetItems.length === 0) {
    return {
      data: null,
      error: "El proyecto no tiene partidas presupuestarias cargadas.",
    };
  }
  const budgetItems = rawBudgetItems as BudgetItem[];

  // 3. Ejecución y Certificados Contractuales (Baseline + Deltas)
  let rawCerts: any[] = [];
  try {
    const { data: certs, error } = await supabase
      .from("project_certificates")
      .select("id, numero, period_start, period_end, status")
      .eq("project_id", projectId);
    if (error) throw new Error(error.message);
    if (certs) rawCerts = certs;
  } catch (err) {
    return { data: null, error: `Error al consultar certificados: ${err instanceof Error ? err.message : String(err)}` };
  }

  const baselineCert = selectBaselineCertificate(rawCerts);

  let rawCertItems: any[] = [];
  if (baselineCert) {
    try {
      const { data: certItems, error } = await supabase
        .from("project_certificate_items")
        .select("id, certificate_id, budget_item_id, codigo, descripcion, qty_contractual, qty_anterior, qty_presente, qty_acumulada")
        .eq("certificate_id", baselineCert.id);
      if (error) throw new Error(error.message);
      if (certItems) rawCertItems = certItems;
    } catch (err) {
      return { data: null, error: `Error al consultar avance certificado: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  // execution_entries (CONTRATO: execution_entries NO tiene empresa_id;
  // scoping vía project_id -> projects.empresa_id)
  const { data: rawEntries, error: eErr } = await supabase
    .from("execution_entries")
    .select("budget_item_id, quantity_executed, entry_date")
    .eq("project_id", projectId);

  if (eErr) {
    return {
      data: null,
      error: `Error al cargar el avance físico ejecutado: ${eErr.message}`,
    };
  }

  const { executedQuantities, recentEntries } = computeBaselineWithDeltas({
    budgetItems,
    baselineCertificate: baselineCert,
    certificateItems: rawCertItems,
    executionEntries: rawEntries ?? [],
  });

  // 4. BOM (budget_item_materials × productos)
  const { data: rawMaterials, error: mErr } = await supabase
    .from("budget_item_materials")
    .select(
      "id, budget_item_id, producto_id, cantidad_por_unidad_ejecutada, desperdicio_pct, productos(id, nombre, sku, unidad, costo_promedio)"
    )
    .eq("project_id", projectId)
    .eq("empresa_id", empresaId);

  if (mErr) {
    return {
      data: null,
      error: `Error al cargar los materiales de partidas: ${mErr.message}`,
    };
  }

  const materialsByItem: Record<string, BudgetItemMaterialInput[]> = {};
  for (const m of rawMaterials ?? []) {
    const prod = (m as any).productos;
    const bId = m.budget_item_id;
    if (!prod?.id || !prod?.unidad?.trim()) return { data: null, error: "BOM sin producto o unidad factual." };
    physicalNumber(m.cantidad_por_unidad_ejecutada, "Ratio BOM", Number.MIN_VALUE);
    physicalNumber(m.desperdicio_pct ?? 0, "Desperdicio BOM");
    if (!materialsByItem[bId]) materialsByItem[bId] = [];
    materialsByItem[bId].push({
      budget_item_id: bId,
      producto_id: m.producto_id,
      producto_nombre: prod?.nombre || "Material sin nombre",
      producto_codigo: prod?.sku || null,
      unidad_medida: prod.unidad,
      cantidad_por_unidad_ejecutada: Number(m.cantidad_por_unidad_ejecutada),
      desperdicio_pct: Number(m.desperdicio_pct || 0),
      costo_unitario:
        prod?.costo_promedio && Number(prod.costo_promedio) > 0
          ? Number(prod.costo_promedio)
          : null,
    });
  }

  // 4b. Precio de los materiales: el mismo que usa el Costeo (elegido para la obra,
  //     precio adoptado, última compra factual, CPP y estimación explícita).
  //     Un error de lectura se propaga: no cambia silenciosamente la fuente.
  try {
    const productIds: string[] = [...new Set<string>((rawMaterials ?? []).map((m: any) => String(m.producto_id)))];
    if (productIds.length > 0) {
      const prices = await resolveProjectMaterialPrices({ supabase: supabase as unknown as Parameters<typeof resolveProjectMaterialPrices>[0]["supabase"], admin: createAdminClient(), empresaId, projectId, productIds });
      for (const list of Object.values(materialsByItem)) {
        for (const m of list) {
          const precio = prices.get(m.producto_id)?.price?.precio;
          if (precio && precio > 0) m.costo_unitario = precio;
        }
      }
    }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : "Error al consultar evidencia de precios." };
  }

  // 4c. Mano de obra, equipos y subcontratos de las recetas.
  const laborByItem: Record<string, PlanHourLineInput[]> = {};
  const equipmentByItem: Record<string, PlanHourLineInput[]> = {};
  const subcontractsByItem: Record<string, PlanSubcontractLineInput[]> = {};
  try {
    const [laborRes, equipmentRes, subcontractRes] = await Promise.all([
      supabase.from("budget_item_labor").select("budget_item_id, rol, horas_por_unidad_ejecutada, costo_hora").eq("project_id", projectId).eq("empresa_id", empresaId),
      supabase.from("budget_item_equipment").select("budget_item_id, tipo_equipo, horas_por_unidad_ejecutada, costo_hora").eq("project_id", projectId).eq("empresa_id", empresaId),
      supabase.from("budget_item_subcontracts").select("budget_item_id, descripcion, precio_por_unidad").eq("project_id", projectId).eq("empresa_id", empresaId),
    ]);
    for (const result of [laborRes, equipmentRes, subcontractRes]) if (result.error) throw new Error(result.error.message);
    for (const l of (laborRes.data ?? []) as any[]) {
      (laborByItem[l.budget_item_id] ??= []).push({ label: l.rol, horas_por_unidad: Number(l.horas_por_unidad_ejecutada), costo_hora: Number(l.costo_hora) });
    }
    for (const e of (equipmentRes.data ?? []) as any[]) {
      (equipmentByItem[e.budget_item_id] ??= []).push({ label: e.tipo_equipo, horas_por_unidad: Number(e.horas_por_unidad_ejecutada), costo_hora: Number(e.costo_hora) });
    }
    for (const c of (subcontractRes.data ?? []) as any[]) {
      (subcontractsByItem[c.budget_item_id] ??= []).push({ label: c.descripcion, precio_por_unidad: Number(c.precio_por_unidad) });
    }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : "Error al consultar la receta APU." };
  }

  // 5. Stock en obra
  const { data: rawStock, error: sErr } = await supabase
    .from("inventory_stock_by_project")
    .select("empresa_id, project_id, producto_id, quantity, unidad")
    .eq("project_id", projectId)
    .eq("empresa_id", empresaId);

  if (sErr) {
    return {
      data: null,
      error: `Error al consultar stock de obra: ${sErr.message}`,
    };
  }

  const productUnits = Object.fromEntries(Object.values(materialsByItem).flat().map(m => [m.producto_id, m.unidad_medida]));
  for (const row of rawStock ?? []) if (productUnits[row.producto_id] && !samePhysicalUnit(row.unidad, productUnits[row.producto_id]))
    return { data: null, error: "Unidad de stock incompatible con BOM." };

  // 6. Inbound físico de OC autorizadas (solo producto_id canónico)
  const { data: rawOrders, error: oErr } = await supabase
    .from("authorized_orders")
    .select("id, status, authorized_order_items(id, product, producto_id, quantity, unit, expected_delivery_date)")
    .eq("project_id", projectId)
    .eq("empresa_id", empresaId)
    .eq("status", "AUTORIZADO");

  if (oErr) {
    return {
      data: null,
      error: `Error al consultar órdenes autorizadas: ${oErr.message}`,
    };
  }

  const { data: rawReceived, error: rErr } = await supabase
    .from("oc_order_item_recibido")
    .select("order_item_id, cantidad_recibida_total")
    .eq("empresa_id", empresaId);

  if (rErr) {
    return {
      data: null,
      error: `Error al consultar recepciones de órdenes: ${rErr.message}`,
    };
  }

  const receivedByOrderItem: Record<string, number> = {};
  for (const r of rawReceived ?? []) {
    if (r.order_item_id) {
      receivedByOrderItem[r.order_item_id] = physicalNumber(r.cantidad_recibida_total, "Recepción confirmada");
    }
  }

  const stockAndInbound: Record<string, StockDisponibilidadInput> = {};
  const projectStockByProduct = aggregateProjectStockByProduct(rawStock ?? []);
  for (const [pId, quantity] of Object.entries(projectStockByProduct)) {
    stockAndInbound[pId] = {
      producto_id: pId,
      stock_disponible: Math.max(0, quantity),
      oc_inbound: 0,
    };
  }

  const inboundDetails: InboundDetail[] = [];
  for (const ord of rawOrders ?? []) {
    const items = (ord as any).authorized_order_items ?? [];
    for (const it of items) {
      const pId = it.producto_id;
      if (!pId) continue; // legacy sin producto_id: fail-safe, no participa
      if (!stockAndInbound[pId]) {
        stockAndInbound[pId] = {
          producto_id: pId,
          stock_disponible: 0,
          oc_inbound: 0,
        };
      }
      if (productUnits[pId] && !samePhysicalUnit(it.unit, productUnits[pId])) return { data: null, error: "Unidad de suministro incompatible con BOM." };
      const totalOrdered = physicalNumber(it.quantity, "Suministro autorizado");
      const physicallyReceived = receivedByOrderItem[it.id] || 0;
      const netInbound = Math.max(0, totalOrdered - physicallyReceived);
      stockAndInbound[pId].oc_inbound += netInbound;
      if (netInbound > 0) inboundDetails.push({order_item_id: it.id, producto_id: pId, net_quantity: netInbound, expected_delivery_date: it.expected_delivery_date ?? null});
    }
  }

  return {
    data: {
      project,
      budgetItems,
      executedQuantities,
      recentEntries,
      materialsByItem,
      laborByItem,
      equipmentByItem,
      subcontractsByItem,
      stockAndInbound,
      inboundDetails,
      baselineCertificate: baselineCert
        ? {
            id: baselineCert.id,
            numero: Number(baselineCert.numero) || 0,
            period_end: String(baselineCert.period_end),
          }
        : null,
    },
    error: null,
  };
}

/**
 * Disponibilidad central canónica (V3): ubicación CENTRAL primaria de la
 * empresa, físico (inventory_balances) menos reservas ACTIVE. Solo lectura.
 * Sin central → available vacío (el MRP muestra ceros, no falla).
 */
export async function loadCentralAvailability(
  supabase: SupabaseLike,
  empresaId: string,
  opts: { planId?: string; unitsByProduct?: Record<string, string> } = {}
): Promise<{ data: CentralAvailability | null; error: string | null }> {
  try {
    const { data: loc, error: locErr } = await supabase
      .from("inventory_locations")
      .select("id, name")
      .eq("empresa_id", empresaId)
      .eq("location_type", "CENTRAL")
      .eq("active", true)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true }).order("id", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (locErr) {
      return { data: null, error: `Error al consultar depósito central: ${locErr.message}` };
    }
    if (!loc) {
      return { data: { location: null, availableByProduct: {} }, error: null };
    }

    const { data: balances, error: balErr } = await supabase
      .from("inventory_stock_by_location")
      .select("producto_id, quantity, unidad")
      .eq("empresa_id", empresaId)
      .eq("location_id", (loc as { id: string }).id);

    if (balErr) {
      return { data: null, error: `Error al consultar saldos central: ${balErr.message}` };
    }

    const { data: reserved, error: resErr } = await supabase
      .from("inventory_reservations")
      .select("producto_id, quantity, weekly_plan_id")
      .eq("empresa_id", empresaId)
      .eq("location_id", (loc as { id: string }).id)
      .eq("status", "ACTIVE");

    if (resErr) {
      return { data: null, error: `Error al consultar reservas: ${resErr.message}` };
    }

    const fisico: Record<string, number> = {};
    for (const b of (balances ?? []) as Array<{ producto_id: string; quantity: unknown; unidad: string }>) {
      if (opts.unitsByProduct?.[b.producto_id] && !samePhysicalUnit(b.unidad, opts.unitsByProduct[b.producto_id])) throw new Error("Unidad de stock central incompatible con BOM.");
      fisico[b.producto_id] = (fisico[b.producto_id] || 0) + physicalNumber(b.quantity, "Stock central");
    }
    const reservado: Record<string, number> = {};
    for (const r of (reserved ?? []) as Array<{ producto_id: string; quantity: unknown; weekly_plan_id?: string | null }>) {
      if (opts.planId && r.weekly_plan_id === opts.planId) continue;
      reservado[r.producto_id] = (reservado[r.producto_id] || 0) + physicalNumber(r.quantity, "Reserva central");
    }
    const availableByProduct: Record<string, number> = {};
    for (const [pid, qty] of Object.entries(fisico)) {
      availableByProduct[pid] = Math.max(0, Number((qty - (reservado[pid] || 0)).toFixed(4)));
    }
    return {
      data: {
        location: { id: (loc as { id: string }).id, name: (loc as { name: string }).name },
        availableByProduct,
      },
      error: null,
    };
  } catch (err: unknown) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Error al consultar disponibilidad central.",
    };
  }
}

/**
 * Overlay climático compartido por load y preview.
 * - Usa fechas EXACTAS del plan (startDate/endDate).
 * - Consulta el provider real (fetchWeatherForecastRange).
 * - NO modifica la meta base ni recorta compras (lo garantiza el engine).
 * - Fail-closed: si falla el provider, failedClosed=true, forecasts=[].
 * - Persiste batch+snapshots append-only (mismo contrato que load).
 * - Clima OFF: el llamador NO debe invocar esta función (cero llamadas).
 */
export async function resolveWeeklyWeather(
  supabase: SupabaseLike,
  opts: {
    empresaId: string;
    projectId: string;
    latitude: number;
    longitude: number;
    startDate: string;
    endDate: string;
    budgetItems: BudgetItem[];
    targets: WeeklyPlanItemTargetInput[];
  }
): Promise<ResolvedWeeklyWeather> {
  const empty: ResolvedWeeklyWeather = {
    forecasts: [],
    snapshotId: null,
    assessments: {},
    failedClosed: false,
    requestedDays: 0,
    coveredDays: 0,
    partialCoverage: false,
  };
  try {
    const { fetchWeatherForecastRange } = await import("./weather-client");
    const { analyzeOperationalWorkability } = await import(
      "./operational-analyst-llm"
    );
    const rangeResult = await fetchWeatherForecastRange(
      opts.latitude,
      opts.longitude,
      opts.startDate,
      opts.endDate
    );

    const forecasts = rangeResult.forecasts;
    let snapshotId: string | null = null;

    if (forecasts.length > 0) {
      const { data: batchData, error: batchErr } = await supabase
        .from("project_weather_forecast_batches")
        .insert({
          empresa_id: opts.empresaId,
          project_id: opts.projectId,
          source: "open-meteo",
          latitude: opts.latitude,
          longitude: opts.longitude,
          forecast_days: forecasts.length,
          fetched_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (batchErr || !batchData) {
        console.warn(
          "Failed to create weather forecast batch:",
          batchErr?.message
        );
      } else {
        snapshotId = batchData.id;
        const snapshotRows = forecasts.map((wf) => ({
          batch_id: batchData.id,
          empresa_id: opts.empresaId,
          project_id: opts.projectId,
          forecast_date: wf.date,
          precipitation_sum_mm: wf.precipitation_sum_mm,
          precipitation_hours: wf.precipitation_hours,
          precipitation_probability_max: wf.precipitation_probability_max,
          wind_gusts_max_kmh: wf.wind_gusts_max_kmh,
          temperature_max_c: wf.temperature_max_c,
          temperature_min_c: wf.temperature_min_c,
          weather_code: wf.weather_code,
          source: "open-meteo",
          raw_payload: wf as any,
        }));
        const { error: snapErr } = await supabase
          .from("project_weather_forecast_snapshots")
          .insert(snapshotRows);
        if (snapErr) {
          console.warn(
            "Failed to persist weather forecast snapshots:",
            snapErr.message
          );
        }
      }

      const candidateItems = opts.budgetItems
        .filter((it) =>
          opts.targets.some(
            (t) => t.budget_item_id === it.id && t.input_value > 0
          )
        )
        .map((it) => ({
          budget_item_id: it.id,
          item_code: it.code,
          description: it.description,
          unit: it.unit || "unid",
        }));

      const opAnalysis = await analyzeOperationalWorkability(
        opts.projectId,
        candidateItems,
        forecasts
      );
      const assessments: Record<string, OperationalAssessmentItem> = {};
      if (opAnalysis) {
        for (const itemOp of opAnalysis.items) {
          assessments[itemOp.budget_item_id] = itemOp;
        }
      }
      return {
        forecasts,
        snapshotId,
        assessments,
        failedClosed: false,
        requestedDays: rangeResult.requestedDays,
        coveredDays: rangeResult.coveredDays,
        partialCoverage: rangeResult.partialCoverage,
      };
    }

    return {
      ...empty,
      requestedDays: rangeResult.requestedDays,
      coveredDays: rangeResult.coveredDays,
      partialCoverage: rangeResult.partialCoverage,
    };
  } catch (wErr) {
    console.warn("Weather overlay failed closed:", wErr);
    return { ...empty, failedClosed: true };
  }
}
