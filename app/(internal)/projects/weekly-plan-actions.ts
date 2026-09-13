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

export interface SaveWeeklyPlanParams {
  planId?: string;
  projectId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  status: WeeklyPlanStatus;
  notes?: string | null;
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
}

/**
 * Loads the active/latest weekly plan or initializes a new one,
 * fetching all real database contracts without assuming non-existent columns.
 */
export async function getWeeklyPlanDetailsAction(
  params: GetWeeklyPlanParams
): Promise<{
  data: {
    plan: ProjectWeeklyPlan | null;
    calculation: WeeklyPlanCalculationSummary;
    budgetItems: BudgetItem[];
  } | null;
  error: string | null;
}> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const empresaId = profile.empresa_id;
    const supabase = await createClient();
    const { projectId, planId } = params;

    // 1. Verify project access
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, name, start_date, plazo_dias, currency:contract_amount")
      .eq("id", projectId)
      .eq("empresa_id", empresaId)
      .single();

    if (projErr || !project) {
      return { data: null, error: "Proyecto no encontrado o sin permisos." };
    }

    // 2. Fetch budget items
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

    // 3. Fetch execution entries:
    // IMPORTANT CONTRACT: execution_entries DOES NOT have empresa_id.
    // Tenant scoping is enforced via project_id -> projects.empresa_id (already verified above).
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
    const recentEntriesList: ExecutionHistoryEntry[] = [];

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

    // 4. Fetch BOM materials (budget_item_materials joined with productos)
    // productos columns: id, nombre, sku, unidad, costo_promedio (NOT codigo, NOT unidad_medida)
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
      if (!materialsByItem[bId]) {
        materialsByItem[bId] = [];
      }
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

    // 5. Fetch stock disponible en obra (stock_por_proyecto, now security_invoker = true)
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

    // 6. Fetch authorized inbound orders
    // Real order_status enum: 'AUTORIZADO', 'FACTURADO', 'CONCILIADO', 'APTO_PARA_PAGO', 'PAGADO'.
    // Orders in status 'AUTORIZADO' represent pending deliveries not yet fully received.
    const { data: rawOrders, error: oErr } = await supabase
      .from("authorized_orders")
      .select("id, status, authorized_order_items(id, product, quantity, unit)")
      .eq("project_id", projectId)
      .eq("empresa_id", empresaId)
      .eq("status", "AUTORIZADO");

    if (oErr) {
      return {
        data: null,
        error: `Error al consultar órdenes autorizadas: ${oErr.message}`,
      };
    }

    // Fetch physical receipts from view oc_order_item_recibido (security_invoker = true)
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

    // Map order item names to product ids if matching
    // Also build stock and inbound lookup
    const stockAndInbound: Record<string, StockDisponibilidadInput> = {};
    for (const st of rawStock ?? []) {
      const pId = st.producto_id;
      stockAndInbound[pId] = {
        producto_id: pId,
        stock_disponible: Math.max(0, Number(st.qty_disponible) || 0),
        oc_inbound: 0,
      };
    }

    // Map inbound quantities: netInbound = max(0, totalOrdered - physicallyReceived)
    // Note: If authorized_order_items matches producto_id from bom materials
    const allBomProductIds = new Set<string>();
    for (const mList of Object.values(materialsByItem)) {
      for (const m of mList) {
        allBomProductIds.add(m.producto_id);
      }
    }

    // Lookup products to match order item text to producto_id if needed
    const { data: productsLookup } = await supabase
      .from("productos")
      .select("id, nombre")
      .eq("empresa_id", empresaId);

    const productIdByName = new Map<string, string>();
    for (const p of productsLookup ?? []) {
      productIdByName.set(p.nombre.toLowerCase().trim(), p.id);
    }

    for (const ord of rawOrders ?? []) {
      const items = (ord as any).authorized_order_items ?? [];
      for (const it of items) {
        const prodName = (it.product || "").toLowerCase().trim();
        const pId = productIdByName.get(prodName);
        if (!pId) continue;

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

    // 7. Fetch existing plan or determine defaults
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
      // Find latest plan for project
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
      const { data: piData } = await supabase
        .from("project_weekly_plan_items")
        .select("*")
        .eq("plan_id", plan.id);
      savedItems = (piData ?? []).map((pi) => ({
        budget_item_id: pi.budget_item_id,
        front_label: pi.front_label,
        input_mode: pi.input_mode as WeeklyPlanInputMode,
        input_value: Number(pi.input_value) || 0,
      }));
    }

    // Default dates for new plan: next Monday to Sunday or current week
    const now = new Date();
    const defaultStart = now.toISOString().split("T")[0];
    const defaultEnd = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const startDate = plan ? plan.start_date : defaultStart;
    const endDate = plan ? plan.end_date : defaultEnd;
    const status = plan ? plan.status : "DRAFT";

    // Build target inputs
    const targets: WeeklyPlanItemTargetInput[] = savedItems.map((si) => ({
      budget_item_id: si.budget_item_id,
      input_mode: si.input_mode,
      input_value: si.input_value,
      front_label: si.front_label,
    }));

    // Run pure calculation engine
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
    });

    return {
      data: {
        plan,
        calculation,
        budgetItems,
      },
      error: null,
    };
  } catch (err: any) {
    console.error("Error in getWeeklyPlanDetailsAction:", err);
    return { data: null, error: err?.message || "Error interno al cargar el plan semanal." };
  }
}

/**
 * Saves or updates a Weekly Plan and its item targets.
 */
export async function saveWeeklyPlanAction(
  params: SaveWeeklyPlanParams
): Promise<{ data: ProjectWeeklyPlan | null; error: string | null }> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const empresaId = profile.empresa_id;
    const userId = profile.id;
    const supabase = await createClient();

    const { planId, projectId, startDate, endDate, status, notes, items } = params;

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

    let currentPlanId = planId;

    if (!currentPlanId) {
      // Create new plan
      const { data: newPlan, error: insErr } = await supabase
        .from("project_weekly_plans")
        .insert({
          empresa_id: empresaId,
          project_id: projectId,
          start_date: startDate,
          end_date: endDate,
          status,
          notes: notes || null,
          created_by: userId,
        })
        .select()
        .single();

      if (insErr || !newPlan) {
        return { data: null, error: `Error al crear el plan semanal: ${insErr?.message}` };
      }
      currentPlanId = newPlan.id;
    } else {
      // Update existing plan
      const { error: upErr } = await supabase
        .from("project_weekly_plans")
        .update({
          start_date: startDate,
          end_date: endDate,
          status,
          notes: notes || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", currentPlanId)
        .eq("empresa_id", empresaId);

      if (upErr) {
        return { data: null, error: `Error al actualizar el plan: ${upErr.message}` };
      }
    }

    // Upsert items for this plan:
    // Delete items not in current list or update/insert
    await supabase
      .from("project_weekly_plan_items")
      .delete()
      .eq("plan_id", currentPlanId);

    if (items.length > 0) {
      const itemsToInsert = items
        .filter((it) => it.inputValue > 0)
        .map((it) => ({
          plan_id: currentPlanId,
          budget_item_id: it.budgetItemId,
          front_label: it.frontLabel || null,
          input_mode: it.inputMode,
          input_value: it.inputValue,
          target_quantity: it.inputValue, // will be capped by pure engine
          unit: it.unit || "unid",
        }));

      if (itemsToInsert.length > 0) {
        const { error: itemsErr } = await supabase
          .from("project_weekly_plan_items")
          .insert(itemsToInsert);

        if (itemsErr) {
          return { data: null, error: `Error al guardar partidas del plan: ${itemsErr.message}` };
        }
      }
    }

    // Retrieve saved plan
    const { data: savedPlan } = await supabase
      .from("project_weekly_plans")
      .select("*")
      .eq("id", currentPlanId)
      .eq("empresa_id", empresaId)
      .single();

    revalidatePath(`/projects/${projectId}`);
    return { data: savedPlan as ProjectWeeklyPlan, error: null };
  } catch (err: any) {
    console.error("Error in saveWeeklyPlanAction:", err);
    return { data: null, error: err?.message || "Error al guardar el plan semanal." };
  }
}
