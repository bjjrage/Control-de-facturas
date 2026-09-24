"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
  loadCentralAvailability,
  toEngineTargets,
  type PreviewWeeklyPlanItemInput,
} from "@/lib/procurement/weekly-plan-shared";
import {
  allocateMaterialCoverage,
  compareCentralLines,
  type MrpCoverageLine,
} from "@/lib/procurement/mrp-coverage";

function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

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
  /**
   * Referencia MRP no autoritativa para COMMITTED: el servidor recalcula y
   * solo compromete si la cobertura coincide. Al actualizar DRAFT/CLOSED,
   * el lifecycle libera reservas ACTIVE en la misma transacción.
   */
  mrpCommit?: {
    /** Referencia del preview (NO autoritativa: el servidor recalcula). */
    lines: { producto_id: string; quantity: number }[];
    neededByDate: string;
  };
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
  /**
   * Cobertura MRP (V3, opcional; default LEGACY = comportamiento V1 intacto).
   * En modo MRP el engine recibe SOLO stock de obra (oc_inbound=0) y la
   * asignación central/inbound-a-tiempo/faltante la calcula allocateMaterialCoverage.
   */
  coverage?: { mode: "MRP"; neededByDate?: string };
}

export interface MrpPreviewResult {
  lines: MrpCoverageLine[];
  total_requerido_valor: number;
  total_cubierto_obra_valor: number;
  total_cubierto_central_valor: number;
  total_cubierto_inbound_valor: number;
  total_comprar_cantidad: number;
  total_caja_adicional: number;
  costos_pendientes: number;
  centralLocation: { id: string; name: string } | null;
  neededBy: string;
  /** Error leyendo central: se muestra aviso en vez de ceros silenciosos. */
  centralError?: string | null;
  /** Inbound no confirmado (sin fecha o tardío): informativo, NO descuenta. */
  unconfirmedInbound: { producto_id: string; producto_nombre: string; cantidad: number }[];
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
    hasActiveReservations: boolean;
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

    let hasActiveReservations = false;
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
      // V3: ¿el plan retiene reservas ACTIVE? (gating de re-commit).
      const { count: activeResCount } = await supabase
        .from("inventory_reservations")
        .select("id", { count: "exact", head: true })
        .eq("weekly_plan_id", plan.id)
        .eq("status", "ACTIVE");
      hasActiveReservations = (activeResCount ?? 0) > 0;
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
        hasActiveReservations,
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
    mrp?: MrpPreviewResult | null;
  } | null;
  error: string | null;
}> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const empresaId = profile.empresa_id;
    const supabase = await createClient();
    const { projectId, startDate, endDate, weatherOverlay, items } = params;
    // V3: modo MRP opt-in (LEGACY por defecto = V1 intacto).
    const mrpMode = params.coverage?.mode === "MRP";
    const neededBy = params.coverage?.neededByDate || endDate;

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
    // V3 MRP: el engine recibe SOLO stock de obra (inbound lo asigna la capa
    // MRP con regla de fecha); en LEGACY el mapa va completo como siempre.
    const engineStockMap = mrpMode
      ? Object.fromEntries(
          Object.entries(stockAndInbound).map(([pid, v]) => [pid, { ...v, oc_inbound: 0 }])
        )
      : stockAndInbound;
    const calculation = calculateWeeklyPlanRequirements({
      project_id: projectId,
      start_date: startDate,
      end_date: endDate,
      status: "DRAFT",
      budget_items: budgetItems,
      executed_quantities_by_item: executedQuantities,
      targets,
      materials_by_item: materialsByItem,
      stock_and_inbound: engineStockMap,
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
      data: {
        calculation,
        budgetItems,
        executedQuantities,
        mrp: mrpMode
          ? await buildMrpPreview(supabase, empresaId, calculation, materialsByItem, baseRes.data, neededBy)
          : null,
      },
      error: null,
    };
  } catch (err: any) {
    console.error("Error in previewWeeklyPlanAction:", err);
    return { data: null, error: err?.message || "Error interno al previsualizar el plan." };
  }
}

/**
 * Capa MRP sobre el resultado del engine (V3). READ-ONLY: lee central +
 * inbound con fecha; NUNCA reserva (las reservas solo viven en el COMMIT).
 */
async function buildMrpPreview(
  supabase: Awaited<ReturnType<typeof createClient>>,
  empresaId: string,
  calculation: WeeklyPlanCalculationSummary,
  materialsByItem: Record<string, BudgetItemMaterialInput[]>,
  baseData: {
    stockAndInbound: Record<string, StockDisponibilidadInput>;
    inboundDetails: { producto_id: string; net_quantity: number; expected_delivery_date: string | null }[] | null;
  },
  neededBy: string
): Promise<MrpPreviewResult> {
  // Nombres/unidades para filas sin BOM propio (ej. inbound sin demanda).
  const names = new Map<string, { nombre: string; unidad: string }>();
  for (const list of Object.values(materialsByItem)) {
    for (const m of list) {
      if (!names.has(m.producto_id)) {
        names.set(m.producto_id, { nombre: m.producto_nombre, unidad: m.unidad_medida });
      }
    }
  }

  // Central disponible (físico − reservas ACTIVE). Sin central → ceros.
  // Si la lectura FALLA, se propaga el error (la UI avisa en vez de
  // mostrar ceros como "sin stock").
  const centralRes = await loadCentralAvailability(supabase, empresaId);
  const centralAvailable = centralRes.data?.availableByProduct ?? {};
  const centralLocation = centralRes.data?.location ?? null;
  const centralError = centralRes.error ?? null;

  // Inbound con regla de fecha: válido solo con fecha <= neededBy.
  // Sin detalle (columna ausente) o sin fecha → no confirmado, NO descuenta.
  const validInbound: Record<string, number> = {};
  const unconfirmed: MrpPreviewResult["unconfirmedInbound"] = [];
  if (baseData.inboundDetails === null) {
    // Fallback honesto: el neto legacy existe pero sin fecha → no confirmado.
    for (const [pid, v] of Object.entries(baseData.stockAndInbound)) {
      if (v.oc_inbound > 0) {
        const nm = names.get(pid);
        unconfirmed.push({
          producto_id: pid,
          producto_nombre: nm?.nombre || "Material",
          cantidad: Number(v.oc_inbound.toFixed(4)),
        });
      }
    }
  } else {
    for (const d of baseData.inboundDetails) {
      const onTime = d.expected_delivery_date !== null && d.expected_delivery_date <= neededBy;
      if (onTime) {
        validInbound[d.producto_id] = (validInbound[d.producto_id] || 0) + d.net_quantity;
      } else {
        const nm = names.get(d.producto_id);
        const prev = unconfirmed.find((u) => u.producto_id === d.producto_id);
        if (prev) prev.cantidad = Number((prev.cantidad + d.net_quantity).toFixed(4));
        else
          unconfirmed.push({
            producto_id: d.producto_id,
            producto_nombre: nm?.nombre || "Material",
            cantidad: Number(d.net_quantity.toFixed(4)),
          });
      }
    }
  }

  const gross = calculation.items.flatMap((it) =>
    it.materials.map((m) => ({
      producto_id: m.producto_id,
      producto_nombre: m.producto_nombre,
      unidad_medida: m.unidad_medida,
      costo_unitario: m.costo_unitario,
      requerido: m.demanda_bruta,
      cubierto_obra: m.cubierto_por_stock,
    }))
  );

  const allocation = allocateMaterialCoverage({
    gross,
    centralAvailableByProduct: centralAvailable,
    validInboundByProduct: validInbound,
  });

  return {
    lines: allocation.lines,
    total_requerido_valor: allocation.total_requerido_valor,
    total_cubierto_obra_valor: allocation.total_cubierto_obra_valor,
    total_cubierto_central_valor: allocation.total_cubierto_central_valor,
    total_cubierto_inbound_valor: allocation.total_cubierto_inbound_valor,
    total_comprar_cantidad: allocation.total_comprar_cantidad,
    total_caja_adicional: allocation.total_caja_adicional,
    costos_pendientes: allocation.costos_pendientes,
    centralLocation,
    neededBy,
    centralError,
    unconfirmedInbound: unconfirmed,
  };
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

    // V3 MRP COMMIT (P1-2 + P1-5): recalcular server-side con datos DB
    // actuales, comparar con la referencia del cliente y persistir
    // plan+reservas en UNA transacción (commit_production_plan_atomic).
    // Las cantidades del browser NUNCA son autoritativas.
    if (
      status === "COMMITTED" &&
      (!params.mrpCommit ||
        !isDateOnly(params.mrpCommit.neededByDate) ||
        !Array.isArray(params.mrpCommit.lines) ||
        params.mrpCommit.lines.some(
          (line) =>
            !line ||
            typeof line.producto_id !== "string" ||
            !Number.isFinite(line.quantity) ||
            line.quantity <= 0
        ))
    ) {
      return {
        data: null,
        error: "Recalculá una cobertura MRP válida antes de comprometer el plan.",
      };
    }

    if (params.mrpCommit && status === "COMMITTED") {
      return await commitProductionPlanWithMrp(supabase, empresaId, profile.id, {
        planId: planId || null,
        projectId,
        startDate,
        endDate,
        status,
        notes: notes || null,
        weatherSnapshotBatchId: weatherSnapshotBatchId || null,
        itemsPayload,
        neededByDate: params.mrpCommit.neededByDate,
        centralReference: (params.mrpCommit.lines ?? []).map((l) => ({
          producto_id: l.producto_id,
          quantity: Number(l.quantity) || 0,
        })),
      });
    }

    // V3 DRAFT/CLOSED con lifecycle: UNA sola transacción (save+release).
    // Sin recompute (nada que reservar); el release vive dentro de la RPC.
    if (status !== "COMMITTED" && planId) {
      return await commitProductionPlanWithMrp(supabase, empresaId, profile.id, {
        planId: planId || null,
        projectId,
        startDate,
        endDate,
        status,
        notes: notes || null,
        weatherSnapshotBatchId: weatherSnapshotBatchId || null,
        itemsPayload,
        neededByDate: endDate,
        centralReference: [],
        skipCoverage: true,
      });
    }

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

/**
 * Commit MRP en DOS pasos server-side (P1-2 + P1-5):
 * 1. Recalcula cobertura con datos DB actuales (engine + central + inbound).
 * 2. Compara contra la referencia del cliente: si difiere (tamper, stock
 *    movido, inbound cambiado) RECHAZA sin guardar nada.
 * 3. UNA sola RPC transaccional plan+reservas (rollback total si falla).
 */
async function commitProductionPlanWithMrp(
  supabase: Awaited<ReturnType<typeof createClient>>,
  empresaId: string,
  actorId: string,
  args: {
    planId: string | null;
    projectId: string;
    startDate: string;
    endDate: string;
    status: WeeklyPlanStatus;
    notes: string | null;
    weatherSnapshotBatchId: string | null;
    itemsPayload: {
      budget_item_id: string;
      front_label: string | null;
      input_mode: WeeklyPlanInputMode;
      input_value: number;
      unit: string;
    }[];
    centralReference: { producto_id: string; quantity: number }[];
    /** DRAFT/CLOSED: omitir recompute+compare (solo save+release). */
    skipCoverage?: boolean;
    neededByDate?: string;
  }
): Promise<{ data: ProjectWeeklyPlan | null; error: string | null }> {
  const { projectId, startDate, endDate, status } = args;
  const neededByDate = args.neededByDate || endDate;
  let serverLines: { producto_id: string; quantity: number }[] = [];
  let centralLocationId: string | null = null;

  if (!args.skipCoverage) {
  // 1. Datos frescos (misma fuente que preview/load).
  const baseRes = await loadWeeklyPlanBaseData(supabase, projectId, empresaId);
  if (baseRes.error || !baseRes.data) {
    return { data: null, error: baseRes.error || "Error al cargar datos base." };
  }
  const { budgetItems, executedQuantities, recentEntries, materialsByItem, stockAndInbound } =
    baseRes.data;

  // 2. Targets desde los items a guardar (NO desde el payload del cliente
  // más allá de metas/modofrente: las CANTIDADES de reserva se derivan aquí).
  const targets = toEngineTargets(
    args.itemsPayload.map((it) => ({
      budgetItemId: it.budget_item_id,
      frontLabel: it.front_label,
      inputMode: it.input_mode,
      inputValue: it.input_value,
    }))
  );

  // 3. Mismo engine, mapa obra-only (el inbound lo asigna la capa MRP).
  const obraOnly: Record<string, StockDisponibilidadInput> = Object.fromEntries(
    Object.entries(stockAndInbound).map(([pid, v]) => [pid, { ...v, oc_inbound: 0 }])
  );
  const calculation = calculateWeeklyPlanRequirements({
    project_id: projectId,
    start_date: startDate,
    end_date: endDate,
    status,
    budget_items: budgetItems,
    executed_quantities_by_item: executedQuantities,
    targets,
    materials_by_item: materialsByItem,
    stock_and_inbound: obraOnly,
    recent_execution_entries: recentEntries,
    currency: "PYG",
    weather_overlay_enabled: false,
    weather_forecasts: [],
  });

  // 4. Central + inbound con fecha, y asignación (pura, testeada).
  const mrp = await buildMrpPreview(supabase, empresaId, calculation, materialsByItem, baseRes.data, neededByDate);
  centralLocationId = mrp.centralLocation?.id ?? null;
  serverLines = mrp.lines
    .filter((l) => l.cubierto_central > 0)
    .map((l) => ({ producto_id: l.producto_id, quantity: l.cubierto_central }));

  // 5. Comparar: el cliente es referencia, la DB manda.
  if (!compareCentralLines(serverLines, args.centralReference)) {
    return {
      data: null,
      error: "El abastecimiento cambió desde el último cálculo. Recalculá el plan.",
    };
  }
  } // fin recompute (DRAFT/CLOSED van directo a la RPC única)

  // 6. UNA transacción plan+reservas (rollback total si algo falla).
  // P1-3: RPC server-only (revocada para authenticated) con empresa/actor explícitos.
  const admin = createAdminClient();
  const { data: rpcResult, error: rpcErr } = await admin.rpc("commit_production_plan_atomic", {
    p_empresa_id: empresaId,
    p_actor_id: actorId,
    p_plan_id: args.planId,
    p_project_id: projectId,
    p_start_date: startDate,
    p_end_date: endDate,
    p_status: status,
    p_notes: args.notes,
    p_items: args.itemsPayload,
    p_weather_snapshot_batch_id: args.weatherSnapshotBatchId,
    p_location_id: centralLocationId,
    p_reserve_items: serverLines,
    p_needed_by: neededByDate,
    p_idempotency_key: args.planId,
  });
  if (rpcErr) {
    const msg = /insuficiente/i.test(rpcErr.message)
      ? "El stock disponible cambió desde el cálculo. Recalculá el plan."
      : `No se pudo comprometer el plan: ${rpcErr.message}`;
    return { data: null, error: msg };
  }

  const savedPlanId = (rpcResult as { plan_id?: string })?.plan_id || args.planId;
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
}
