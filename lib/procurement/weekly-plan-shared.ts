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
import type { WeeklyPlanItemTargetInput } from "./weekly-plan-engine";
import type { OperationalAssessmentItem } from "./operational-analyst-llm";

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
  stockAndInbound: Record<string, StockDisponibilidadInput>;
  /**
   * Detalle de inbound por línea (ADITIVO V3, no altera el mapa legacy):
   * neto físico con fecha esperada para la regla "llega a tiempo".
   * null si la columna aún no existe en la DB (fail-safe: todo no confirmado).
   */
  inboundDetails: InboundDetail[] | null;
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

  // 2. Partidas
  const { data: rawBudgetItems, error: bErr } = await supabase
    .from("budget_items")
    .select("*")
    .eq("project_id", projectId)
    .order("code", { ascending: true });

  if (bErr || !rawBudgetItems || rawBudgetItems.length === 0) {
    return {
      data: null,
      error: "El proyecto no tiene partidas presupuestarias cargadas.",
    };
  }
  const budgetItems = rawBudgetItems as BudgetItem[];

  // 3. Ejecución (CONTRATO: execution_entries NO tiene empresa_id;
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

  const executedQuantities: Record<string, number> = {};
  const recentEntries: ExecutionHistoryEntry[] = [];
  for (const entry of rawEntries ?? []) {
    const bId = entry.budget_item_id;
    const q = Number(entry.quantity_executed) || 0;
    executedQuantities[bId] = (executedQuantities[bId] || 0) + q;
    if (entry.entry_date) {
      recentEntries.push({
        budget_item_id: bId,
        entry_date: entry.entry_date,
        quantity_executed: q,
      });
    }
  }

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
    if (!materialsByItem[bId]) materialsByItem[bId] = [];
    materialsByItem[bId].push({
      budget_item_id: bId,
      producto_id: m.producto_id,
      producto_nombre: prod?.nombre || "Material sin nombre",
      producto_codigo: prod?.sku || null,
      unidad_medida: prod?.unidad || "unid",
      cantidad_por_unidad_ejecutada: Number(m.cantidad_por_unidad_ejecutada),
      desperdicio_pct: Number(m.desperdicio_pct || 0),
      costo_unitario:
        prod?.costo_promedio && Number(prod.costo_promedio) > 0
          ? Number(prod.costo_promedio)
          : null,
    });
  }

  // 5. Stock en obra
  const { data: rawStock, error: sErr } = await supabase
    .from("stock_por_proyecto")
    .select("producto_id, qty_disponible, costo_promedio")
    .eq("project_id", projectId)
    .eq("empresa_id", empresaId);

  if (sErr) {
    return {
      data: null,
      error: `Error al consultar stock de obra: ${sErr.message}`,
    };
  }

  // 6. Inbound físico de OC autorizadas (solo producto_id canónico)
  const { data: rawOrders, error: oErr } = await supabase
    .from("authorized_orders")
    .select("id, status, authorized_order_items(id, product, producto_id, quantity, unit)")
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
      if (!pId) continue; // legacy sin producto_id: fail-safe, no participa
      if (!stockAndInbound[pId]) {
        stockAndInbound[pId] = {
          producto_id: pId,
          stock_disponible: 0,
          oc_inbound: 0,
        };
      }
      const totalOrdered = Number(it.quantity) || 0;
      const physicallyReceived = receivedByOrderItem[it.id] || 0;
      const netInbound = Math.max(0, totalOrdered - physicallyReceived);
      stockAndInbound[pId].oc_inbound += netInbound;
    }
  }

  return {
    data: {
      project,
      budgetItems,
      executedQuantities,
      recentEntries,
      materialsByItem,
      stockAndInbound,
      inboundDetails: await loadInboundDetails(supabase, rawOrders ?? [], receivedByOrderItem),
    },
    error: null,
  };
}

/**
 * Detalle timed de inbound (V3, aditivo). Query separada para no alterar la
 * query certificada del loader: si expected_delivery_date no existe todavía,
 * retorna null y todo inbound se trata como fecha no confirmada.
 */
async function loadInboundDetails(
  supabase: SupabaseLike,
  rawOrders: Array<{ id: string }>,
  receivedByOrderItem: Record<string, number>
): Promise<InboundDetail[] | null> {
  try {
    const orderIds = (rawOrders ?? []).map((o) => o.id).filter(Boolean);
    if (orderIds.length === 0) return [];
    const { data, error } = await supabase
      .from("authorized_order_items")
      .select("id, producto_id, quantity, expected_delivery_date")
      .in("order_id", orderIds);
    if (error || !data) return null;
    const out: InboundDetail[] = [];
    for (const it of data as Array<{
      id: string;
      producto_id: string | null;
      quantity: unknown;
      expected_delivery_date: string | null;
    }>) {
      if (!it.producto_id) continue; // canónico solamente, igual que el loader
      const net = Math.max(0, (Number(it.quantity) || 0) - (receivedByOrderItem[it.id] || 0));
      if (net <= 0) continue;
      out.push({
        order_item_id: it.id,
        producto_id: it.producto_id,
        net_quantity: Number(net.toFixed(4)),
        expected_delivery_date: it.expected_delivery_date || null,
      });
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Disponibilidad central canónica (V3): ubicación CENTRAL primaria de la
 * empresa, físico (inventory_balances) menos reservas ACTIVE. Solo lectura.
 * Sin central → available vacío (el MRP muestra ceros, no falla).
 */
export async function loadCentralAvailability(
  supabase: SupabaseLike,
  empresaId: string
): Promise<{ data: CentralAvailability | null; error: string | null }> {
  try {
    const { data: loc, error: locErr } = await supabase
      .from("inventory_locations")
      .select("id, name")
      .eq("empresa_id", empresaId)
      .eq("location_type", "CENTRAL")
      .eq("active", true)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (locErr) {
      return { data: null, error: `Error al consultar depósito central: ${locErr.message}` };
    }
    if (!loc) {
      return { data: { location: null, availableByProduct: {} }, error: null };
    }

    const { data: balances, error: balErr } = await supabase
      .from("inventory_balances")
      .select("producto_id, quantity")
      .eq("empresa_id", empresaId)
      .eq("location_id", (loc as { id: string }).id);

    if (balErr) {
      return { data: null, error: `Error al consultar saldos central: ${balErr.message}` };
    }

    const { data: reserved, error: resErr } = await supabase
      .from("inventory_reservations")
      .select("producto_id, quantity")
      .eq("empresa_id", empresaId)
      .eq("location_id", (loc as { id: string }).id)
      .eq("status", "ACTIVE");

    if (resErr) {
      return { data: null, error: `Error al consultar reservas: ${resErr.message}` };
    }

    const fisico: Record<string, number> = {};
    for (const b of (balances ?? []) as Array<{ producto_id: string; quantity: unknown }>) {
      fisico[b.producto_id] = (fisico[b.producto_id] || 0) + (Number(b.quantity) || 0);
    }
    const reservado: Record<string, number> = {};
    for (const r of (reserved ?? []) as Array<{ producto_id: string; quantity: unknown }>) {
      reservado[r.producto_id] = (reservado[r.producto_id] || 0) + (Number(r.quantity) || 0);
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
