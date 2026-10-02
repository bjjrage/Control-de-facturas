"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlan } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { DEFAULT_RFQ_WINDOW_HOURS } from "@/lib/rfq-status";
import { explodeMaterialNeeds, groupNeedsByRubro } from "@/lib/costing/insumos";
import {
  computePartidaCosts,
  computeProjectCostTotals,
  offerExpiryDate,
  type PartidaCost,
  type ProjectCostTotals,
  type ResolvedPrice,
} from "@/lib/costing/cost-budget";
import { resolveProjectMaterialPrices, type QuoteOption } from "@/lib/costing/project-prices";
import { computeRealVsBudget, laborBudgetToDate, type RealVsBudgetRow } from "@/lib/costing/real-vs-budget";

// ---------------------------------------------------------------------------
// Costeo: RFQ multi-ítem por rubro. Los insumos de la obra (cantidad de cada
// partida × APU de materiales) se agrupan por categoría de producto y sale
// un RFQ por rubro a todos los proveedores activos de ese rubro.
// Se escribe con el admin client (las políticas de rfqs solo dejan insertar
// a comercial/admin y el costeo lo hace administración), siempre después de
// validar que la obra es de la empresa del usuario.
// ---------------------------------------------------------------------------

export interface CostRfqCreationResult {
  creadas: { rfqId: string; code: string; rubro: string; items: number; proveedores: number }[];
  rubrosSinProveedores: { rubro: string; items: number }[];
  insumosSinRubro: string[];
  sinInsumos: boolean;
}

/** Obras de la empresa para armar el pedido de precios desde Compras. */
export async function listProjectsForCostRfqAction(): Promise<{
  data: { id: string; name: string; code: string }[] | null;
  error: string | null;
}> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, code")
      .eq("empresa_id", profile.empresa_id)
      .order("name");
    if (error) return { data: null, error: error.message };
    return { data: (data ?? []) as { id: string; name: string; code: string }[], error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : "No se pudieron cargar las obras." };
  }
}

export async function createCostRfqsFromProject(
  projectId: string,
  opts: { expiresHours?: number } = {}
): Promise<{ data: CostRfqCreationResult | null; error: string | null }> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const empresaId = profile.empresa_id;
    const supabase = await createClient();

    const { data: project } = await supabase
      .from("projects")
      .select("id, name")
      .eq("id", projectId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!project) return { data: null, error: "Obra no encontrada." };

    const [itemsRes, materialsRes] = await Promise.all([
      supabase.from("budget_items").select("id, quantity").eq("project_id", projectId),
      supabase
        .from("budget_item_materials")
        .select("budget_item_id, producto_id, cantidad_por_unidad_ejecutada, desperdicio_pct")
        .eq("project_id", projectId)
        .eq("empresa_id", empresaId),
    ]);
    if (itemsRes.error) return { data: null, error: itemsRes.error.message };
    if (materialsRes.error) return { data: null, error: materialsRes.error.message };

    const needs = explodeMaterialNeeds(
      (itemsRes.data ?? []).map((b: any) => ({ id: b.id, quantity: b.quantity == null ? null : Number(b.quantity) })),
      (materialsRes.data ?? []).map((m: any) => ({
        budgetItemId: m.budget_item_id,
        productoId: m.producto_id,
        cantidadPorUnidad: Number(m.cantidad_por_unidad_ejecutada),
        desperdicioPct: Number(m.desperdicio_pct),
      }))
    );
    if (needs.length === 0) {
      return { data: { creadas: [], rubrosSinProveedores: [], insumosSinRubro: [], sinInsumos: true }, error: null };
    }

    const productIds = needs.map((n) => n.productoId);
    const [productsRes, categoriasRes, linksRes] = await Promise.all([
      supabase.from("productos").select("id, nombre, unidad, categoria_id").eq("empresa_id", empresaId).in("id", productIds),
      supabase.from("categorias_producto").select("id, nombre").eq("empresa_id", empresaId),
      supabase.from("provider_categorias").select("provider_id, categoria_id, providers!inner(active)").eq("empresa_id", empresaId),
    ]);
    const categoriaNombre = new Map((categoriasRes.data ?? []).map((c: any) => [c.id as string, c.nombre as string]));
    const providersByCategoria = new Map<string, string[]>();
    for (const l of (linksRes.data ?? []) as any[]) {
      const prov = Array.isArray(l.providers) ? l.providers[0] : l.providers;
      if (!prov?.active) continue;
      const list = providersByCategoria.get(l.categoria_id) ?? [];
      list.push(l.provider_id);
      providersByCategoria.set(l.categoria_id, list);
    }

    const grouped = groupNeedsByRubro(
      needs,
      (productsRes.data ?? []).map((p: any) => ({ id: p.id, nombre: p.nombre, unidad: p.unidad, categoriaId: p.categoria_id }))
    );

    const admin = createAdminClient();
    const expiresAt = new Date(Date.now() + (opts.expiresHours ?? DEFAULT_RFQ_WINDOW_HOURS) * 3600 * 1000).toISOString();
    const result: CostRfqCreationResult = {
      creadas: [],
      rubrosSinProveedores: [],
      insumosSinRubro: grouped.sinRubro.map((s) => s.nombre),
      sinInsumos: false,
    };

    for (const rubro of grouped.rubros) {
      const rubroNombre = categoriaNombre.get(rubro.categoriaId) ?? "Sin nombre";
      const providerIds = providersByCategoria.get(rubro.categoriaId) ?? [];
      if (providerIds.length === 0) {
        result.rubrosSinProveedores.push({ rubro: rubroNombre, items: rubro.items.length });
        continue;
      }

      const { data: rfq, error: rfqError } = await admin
        .from("rfqs")
        .insert({
          empresa_id: empresaId,
          quote_type: "RFQ",
          created_by: profile.id,
          product: `${rubroNombre} (${rubro.items.length} ítems)`,
          quantity: 1,
          unit: "lote",
          internal_reference: `Costeo · ${project.name}`,
          observations: `Solicitud de precios para costeo de obra — rubro ${rubroNombre}.`,
          project_id: projectId,
          status: "COTIZANDO",
          expires_at: expiresAt,
        })
        .select("id, code")
        .single();
      if (rfqError || !rfq) return { data: null, error: `No se pudo crear el RFQ de ${rubroNombre}: ${rfqError?.message ?? ""}` };

      const { error: itemsError } = await admin.from("rfq_items").insert(
        rubro.items.map((it, idx) => ({
          empresa_id: empresaId,
          rfq_id: rfq.id,
          producto_id: it.productoId,
          descripcion: it.nombre,
          cantidad: it.cantidad,
          unidad: it.unidad,
          sort_order: idx,
        }))
      );
      if (itemsError) return { data: null, error: `No se pudieron cargar los ítems del RFQ de ${rubroNombre}: ${itemsError.message}` };

      const { error: provError } = await admin
        .from("rfq_providers")
        .insert(providerIds.map((provider_id) => ({ rfq_id: rfq.id, provider_id, empresa_id: empresaId })));
      if (provError) return { data: null, error: `No se pudieron invitar proveedores a ${rubroNombre}: ${provError.message}` };

      await logAudit(admin, { action: "rfq.created", rfqId: rfq.id, detail: { costeo: true, project_id: projectId, rubro: rubroNombre } });
      result.creadas.push({ rfqId: rfq.id, code: rfq.code, rubro: rubroNombre, items: rubro.items.length, proveedores: providerIds.length });
    }

    revalidatePath(`/projects/${projectId}`);
    revalidatePath("/rfqs");
    return { data: result, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || "Error al generar los RFQ de costeo." };
  }
}

// --- Presupuesto de costo (pestaña Costeo) ---------------------------------

export interface CostBudgetInsumo {
  productoId: string;
  nombre: string;
  unidad: string;
  rubro: string | null;
  cantidad: number;
  precio: ResolvedPrice | null;
  adoptedPrice: ResolvedPrice | null;
  lastPurchasePrice: ResolvedPrice | null;
  currentQuote: QuoteOption | null;
  subtotal: number | null;
  quotes: QuoteOption[];
  quotesOtraMoneda: number;
  estimate: number | null;
  estimatedPrice: number | null;
  costoPromedio: number | null;
}

export interface CostBudgetHourLine {
  label: string;
  vinculadoAJornal: boolean;
  horas: number;
  costoHora: number;
  subtotal: number;
}

export interface CostBudgetData {
  partidas: {
    id: string;
    code: string;
    description: string;
    unit: string | null;
    quantity: number | null;
    unitPrice: number | null;
    cost: PartidaCost | null;
  }[];
  totals: ProjectCostTotals;
  insumos: CostBudgetInsumo[];
  manoObra: CostBudgetHourLine[];
  equipos: CostBudgetHourLine[];
  subcontratos: { descripcion: string; total: number }[];
  rfqs: { id: string; code: string; product: string; status: string; invitados: number; respondieron: number; expiresAt: string }[];
}

export async function getCostBudgetAction(projectId: string): Promise<{ data: CostBudgetData | null; error: string | null }> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const empresaId = profile.empresa_id;
    const supabase = await createClient();
    const admin = createAdminClient();

    const { data: project } = await supabase.from("projects").select("id").eq("id", projectId).eq("empresa_id", empresaId).maybeSingle();
    if (!project) return { data: null, error: "Obra no encontrada." };

    const [itemsRes, materialsRes, laborRes, equipmentRes, subcontractsRes, rfqsRes] = await Promise.all([
      supabase.from("budget_items").select("id, code, description, unit, quantity, unit_price, sort_order").eq("project_id", projectId).order("sort_order"),
      supabase
        .from("budget_item_materials")
        .select("budget_item_id, producto_id, cantidad_por_unidad_ejecutada, desperdicio_pct, productos(nombre, unidad, categoria_id, categorias_producto(nombre))")
        .eq("project_id", projectId)
        .eq("empresa_id", empresaId),
      supabase
        .from("budget_item_labor")
        .select("budget_item_id, rol, horas_por_unidad_ejecutada, costo_hora, labor_rates(categoria)")
        .eq("project_id", projectId)
        .eq("empresa_id", empresaId),
      supabase.from("budget_item_equipment").select("budget_item_id, tipo_equipo, horas_por_unidad_ejecutada, costo_hora").eq("project_id", projectId).eq("empresa_id", empresaId),
      supabase.from("budget_item_subcontracts").select("budget_item_id, descripcion, precio_por_unidad").eq("project_id", projectId).eq("empresa_id", empresaId),
      admin
        .from("rfqs")
        .select("id, code, product, status, expires_at, rfq_providers(status), rfq_items(id)")
        .eq("empresa_id", empresaId)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false }),
    ]);
    for (const r of [itemsRes, materialsRes, laborRes, equipmentRes, subcontractsRes]) {
      if (r.error) return { data: null, error: r.error.message };
    }

    const items = (itemsRes.data ?? []) as any[];
    const qtyById = new Map(items.map((b) => [b.id as string, b.quantity == null ? 0 : Number(b.quantity)]));
    const materials = (materialsRes.data ?? []) as any[];
    const labor = (laborRes.data ?? []) as any[];
    const equipment = (equipmentRes.data ?? []) as any[];
    const subcontracts = (subcontractsRes.data ?? []) as any[];

    const productIds = [...new Set(materials.map((m) => m.producto_id as string))];
    const priceDetails = await resolveProjectMaterialPrices({ supabase, admin, empresaId, projectId, productIds });
    const prices = new Map<string, ResolvedPrice>();
    for (const [pid, d] of priceDetails) if (d.price) prices.set(pid, d.price);

    const partidasInput = items.map((b) => ({
      id: b.id as string,
      quantity: b.quantity == null ? null : Number(b.quantity),
      unitPrice: b.unit_price == null ? null : Number(b.unit_price),
    }));
    const materialLines = materials.map((m) => ({
      budgetItemId: m.budget_item_id as string,
      productoId: m.producto_id as string,
      cantidadPorUnidad: Number(m.cantidad_por_unidad_ejecutada),
      desperdicioPct: Number(m.desperdicio_pct),
    }));
    const costs = computePartidaCosts(
      partidasInput,
      {
        materials: materialLines,
        labor: labor.map((l) => ({ budgetItemId: l.budget_item_id, horasPorUnidad: Number(l.horas_por_unidad_ejecutada), costoHora: Number(l.costo_hora) })),
        equipment: equipment.map((e) => ({ budgetItemId: e.budget_item_id, horasPorUnidad: Number(e.horas_por_unidad_ejecutada), costoHora: Number(e.costo_hora) })),
        subcontracts: subcontracts.map((s) => ({ budgetItemId: s.budget_item_id, precioPorUnidad: Number(s.precio_por_unidad) })),
      },
      prices
    );

    const needs = explodeMaterialNeeds(partidasInput, materialLines);
    const productInfo = new Map<string, { nombre: string; unidad: string; rubro: string | null }>();
    for (const m of materials) {
      const p = Array.isArray(m.productos) ? m.productos[0] : m.productos;
      const cat = p?.categorias_producto ? (Array.isArray(p.categorias_producto) ? p.categorias_producto[0] : p.categorias_producto) : null;
      productInfo.set(m.producto_id, { nombre: p?.nombre ?? "(producto eliminado)", unidad: p?.unidad ?? "", rubro: cat?.nombre ?? null });
    }
    const insumos: CostBudgetInsumo[] = needs
      .map((n) => {
        const d = priceDetails.get(n.productoId);
        const info = productInfo.get(n.productoId);
        return {
          productoId: n.productoId,
          nombre: info?.nombre ?? "",
          unidad: info?.unidad ?? "",
          rubro: info?.rubro ?? null,
          cantidad: n.cantidad,
          precio: d?.price ?? null,
          adoptedPrice: d?.adoptedPrice ?? null,
          lastPurchasePrice: d?.lastPurchasePrice ?? null,
          currentQuote: d?.currentQuote ?? null,
          subtotal: d?.price ? n.cantidad * d.price.precio : null,
          quotes: d?.quotes ?? [],
          quotesOtraMoneda: d?.quotesOtraMoneda ?? 0,
          estimate: d?.estimate ?? null,
          estimatedPrice: d?.estimatedPrice ?? null,
          costoPromedio: d?.costoPromedio ?? null,
        };
      })
      .sort((a, b) => (a.rubro ?? "~").localeCompare(b.rubro ?? "~") || a.nombre.localeCompare(b.nombre));

    const groupHours = (rows: any[], labelOf: (r: any) => { label: string; linked: boolean }) => {
      const acc = new Map<string, CostBudgetHourLine>();
      for (const r of rows) {
        const qty = qtyById.get(r.budget_item_id) ?? 0;
        if (qty <= 0) continue;
        const { label, linked } = labelOf(r);
        const horas = qty * Number(r.horas_por_unidad_ejecutada);
        const costoHora = Number(r.costo_hora);
        const key = `${label}::${costoHora}`;
        const prev = acc.get(key);
        if (prev) {
          prev.horas += horas;
          prev.subtotal += horas * costoHora;
        } else {
          acc.set(key, { label, vinculadoAJornal: linked, horas, costoHora, subtotal: horas * costoHora });
        }
      }
      return [...acc.values()].sort((a, b) => b.subtotal - a.subtotal);
    };
    const manoObra = groupHours(labor, (l) => {
      const rate = Array.isArray(l.labor_rates) ? l.labor_rates[0] : l.labor_rates;
      return rate?.categoria ? { label: rate.categoria, linked: true } : { label: l.rol, linked: false };
    });
    const equipos = groupHours(equipment, (e) => ({ label: e.tipo_equipo, linked: false }));

    const subAcc = new Map<string, number>();
    for (const s of subcontracts) {
      const qty = qtyById.get(s.budget_item_id) ?? 0;
      if (qty <= 0) continue;
      subAcc.set(s.descripcion, (subAcc.get(s.descripcion) ?? 0) + qty * Number(s.precio_por_unidad));
    }

    const rfqs = ((rfqsRes.data ?? []) as any[])
      .filter((r) => (r.rfq_items ?? []).length > 0)
      .map((r) => ({
        id: r.id,
        code: r.code,
        product: r.product,
        status: r.status,
        invitados: (r.rfq_providers ?? []).length,
        respondieron: (r.rfq_providers ?? []).filter((rp: any) => rp.status === "RESPONDIDO").length,
        expiresAt: r.expires_at,
      }));

    return {
      data: {
        partidas: items.map((b) => ({
          id: b.id,
          code: b.code,
          description: b.description,
          unit: b.unit,
          quantity: b.quantity == null ? null : Number(b.quantity),
          unitPrice: b.unit_price == null ? null : Number(b.unit_price),
          cost: costs[b.id] ?? null,
        })),
        totals: computeProjectCostTotals(partidasInput, costs),
        insumos,
        manoObra,
        equipos,
        subcontratos: [...subAcc.entries()].map(([descripcion, total]) => ({ descripcion, total })).sort((a, b) => b.total - a.total),
        rfqs,
      },
      error: null,
    };
  } catch (err: any) {
    return { data: null, error: err.message || "Error al calcular el presupuesto de costo." };
  }
}

// --- Costo real vs presupuestado (plan caterpillar) ------------------------

export interface RealVsBudgetData {
  rows: (RealVsBudgetRow & { code: string; description: string })[];
  manoObraSinImputar: number;
  subcontratoSinImputar: number;
  manoObra: { presupuestadoALaFecha: number; pagado: number };
  totalReal: number;
  totalPresupuestadoALaFecha: number;
}

export async function getRealVsBudgetAction(projectId: string): Promise<{ data: RealVsBudgetData | null; error: string | null }> {
  try {
    const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
    const empresaId = profile.empresa_id;
    const supabase = await createClient();

    const budget = await getCostBudgetAction(projectId);
    if (budget.error || !budget.data) return { data: null, error: budget.error ?? "No se pudo calcular el presupuesto de costo." };

    const [execRes, consumptionRes, laborRes, paymentsRes, certRes] = await Promise.all([
      supabase.from("execution_entries").select("budget_item_id, quantity_executed").eq("project_id", projectId),
      supabase.from("inventory_consumption_by_budget").select("budget_item_id, cost_consumed_company").eq("empresa_id", empresaId).eq("project_id", projectId),
      supabase.from("daily_labor_entries").select("budget_item_id, labor_cost").eq("project_id", projectId),
      supabase.from("labor_payments").select("budget_item_id, amount").eq("empresa_id", empresaId).eq("project_id", projectId),
      supabase
        .from("subcontractor_certificates")
        .select("approved_amount, status, subcontractor_contracts!inner(budget_item_id)")
        .eq("project_id", projectId)
        .in("status", ["APROBADO", "PAGADO"]),
    ]);

    const sumBy = (rows: any[] | null, key: string, value: string) => {
      const acc: Record<string, number> = {};
      let unassigned = 0;
      for (const r of rows ?? []) {
        const k = r[key] as string | null;
        const v = Number(r[value]) || 0;
        if (!k) unassigned += v;
        else acc[k] = (acc[k] ?? 0) + v;
      }
      return { acc, unassigned };
    };
    const executed = sumBy(execRes.data as any[], "budget_item_id", "quantity_executed");
    const material = sumBy(consumptionRes.data as any[], "budget_item_id", "cost_consumed_company");
    const laborRows = [
      ...((laborRes.data ?? []) as any[]).map((r) => ({ budget_item_id: r.budget_item_id, cost: r.labor_cost })),
      ...((paymentsRes.data ?? []) as any[]).map((r) => ({ budget_item_id: r.budget_item_id, cost: r.amount })),
    ];
    const labor = sumBy(laborRows, "budget_item_id", "cost");
    const manoObraPagada = laborRows.reduce((acc, r) => acc + (Number(r.cost) || 0), 0);
    const manoObraPresupuestada = laborBudgetToDate(
      budget.data.partidas.map((p) => ({ id: p.id, quantity: p.quantity, costoManoObraUnitario: p.cost?.costoManoObra ?? 0 })),
      executed.acc
    );
    const subRows = ((certRes.data ?? []) as any[]).map((c) => {
      const contract = Array.isArray(c.subcontractor_contracts) ? c.subcontractor_contracts[0] : c.subcontractor_contracts;
      return { budget_item_id: contract?.budget_item_id ?? null, approved_amount: c.approved_amount };
    });
    const sub = sumBy(subRows, "budget_item_id", "approved_amount");

    const byId = new Map(budget.data.partidas.map((p) => [p.id, p]));
    const rows = computeRealVsBudget({
      partidas: budget.data.partidas.map((p) => ({ id: p.id, quantity: p.quantity, costoTotal: p.cost?.costoTotal ?? null })),
      executedByItem: executed.acc,
      realMaterial: material.acc,
      realLabor: labor.acc,
      realSubcontract: sub.acc,
    }).map((r) => ({ ...r, code: byId.get(r.budgetItemId)?.code ?? "", description: byId.get(r.budgetItemId)?.description ?? "" }));

    return {
      data: {
        rows,
        manoObraSinImputar: labor.unassigned,
        subcontratoSinImputar: sub.unassigned,
        manoObra: { presupuestadoALaFecha: manoObraPresupuestada, pagado: manoObraPagada },
        totalReal: rows.reduce((acc, r) => acc + r.real, 0) + labor.unassigned + sub.unassigned,
        totalPresupuestadoALaFecha: rows.reduce((acc, r) => acc + (r.presupuestadoALaFecha ?? 0), 0),
      },
      error: null,
    };
  } catch (err: any) {
    return { data: null, error: err.message || "Error al calcular el costo real." };
  }
}

/** Fija el precio de un insumo para esta obra (otra cotización o manual). */
export async function setProjectCostPriceAction(params: {
  projectId: string;
  productoId: string;
  precio: number;
  fuente: "COTIZACION" | "MANUAL";
  quoteVersionItemId?: string | null;
}): Promise<{ error: string | null }> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const supabase = await createClient();
    if (params.fuente !== "COTIZACION" && params.fuente !== "MANUAL") {
      return { error: "La fuente del precio no es válida." };
    }
    if (params.fuente === "MANUAL" && (!Number.isFinite(params.precio) || params.precio <= 0)) {
      return { error: "El precio tiene que ser un número finito mayor a cero." };
    }
    const { data: project } = await supabase.from("projects").select("id").eq("id", params.projectId).eq("empresa_id", profile.empresa_id).maybeSingle();
    if (!project) return { error: "Obra no encontrada." };

    let precioUnitario = params.precio;
    let quoteVersionItemId: string | null = null;
    if (params.fuente === "COTIZACION") {
      if (typeof params.quoteVersionItemId !== "string" || !params.quoteVersionItemId.trim()) {
        return { error: "La cotización seleccionada no es válida." };
      }

      const quotePrice = await resolveCurrentQuotePrice({
        admin: createAdminClient(),
        empresaId: profile.empresa_id,
        projectId: params.projectId,
        productoId: params.productoId,
        quoteVersionItemId: params.quoteVersionItemId,
      });
      if (quotePrice.error || quotePrice.precio == null) {
        return { error: quotePrice.error ?? "La cotización seleccionada no es válida para esta obra e insumo." };
      }

      precioUnitario = quotePrice.precio;
      quoteVersionItemId = params.quoteVersionItemId;
    }

    const { error } = await supabase.from("project_cost_prices").upsert(
      {
        empresa_id: profile.empresa_id,
        project_id: params.projectId,
        producto_id: params.productoId,
        precio_unitario: precioUnitario,
        fuente: params.fuente,
        quote_version_item_id: quoteVersionItemId,
        updated_by: profile.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id,producto_id" }
    );
    if (error) return { error: error.message };
    revalidatePath(`/projects/${params.projectId}`);
    return { error: null };
  } catch (err: any) {
    return { error: err.message };
  }
}

/** Valida server-side que el ítem pertenezca a la cotización vigente de esta obra e insumo. */
async function resolveCurrentQuotePrice(args: {
  admin: ReturnType<typeof createAdminClient>;
  empresaId: string;
  projectId: string;
  productoId: string;
  quoteVersionItemId: string;
}): Promise<{ precio: number | null; error: string | null }> {
  const invalid = { precio: null, error: "La cotización seleccionada no es válida para esta obra e insumo." };
  const { data: quoteItem, error: quoteItemError } = await args.admin
    .from("quote_version_items")
    .select("id, quote_version_id, rfq_item_id, precio_unitario")
    .eq("id", args.quoteVersionItemId)
    .eq("empresa_id", args.empresaId)
    .maybeSingle();
  if (quoteItemError || !quoteItem) return invalid;

  const { data: rfqItem, error: rfqItemError } = await args.admin
    .from("rfq_items")
    .select("id, rfq_id, producto_id")
    .eq("id", quoteItem.rfq_item_id)
    .eq("empresa_id", args.empresaId)
    .eq("producto_id", args.productoId)
    .maybeSingle();
  if (rfqItemError || !rfqItem) return invalid;

  const { data: rfq, error: rfqError } = await args.admin
    .from("rfqs")
    .select("id, project_id")
    .eq("id", rfqItem.rfq_id)
    .eq("empresa_id", args.empresaId)
    .eq("project_id", args.projectId)
    .maybeSingle();
  if (rfqError || !rfq) return invalid;

  const { data: version, error: versionError } = await args.admin
    .from("quote_versions")
    .select("id, quote_id, version_number, currency, offer_validity, submitted_at")
    .eq("id", quoteItem.quote_version_id)
    .eq("empresa_id", args.empresaId)
    .maybeSingle();
  if (versionError || !version || version.currency !== "PYG") return invalid;

  const { data: quote, error: quoteError } = await args.admin
    .from("quotes")
    .select("id, rfq_provider_id")
    .eq("id", version.quote_id)
    .eq("empresa_id", args.empresaId)
    .maybeSingle();
  if (quoteError || !quote) return invalid;

  const { data: rfqProvider, error: rfqProviderError } = await args.admin
    .from("rfq_providers")
    .select("id, rfq_id")
    .eq("id", quote.rfq_provider_id)
    .eq("empresa_id", args.empresaId)
    .maybeSingle();
  if (rfqProviderError || !rfqProvider || rfqProvider.rfq_id !== rfq.id) return invalid;

  const { data: currentVersion, error: currentVersionError } = await args.admin
    .from("quote_versions")
    .select("id")
    .eq("quote_id", quote.id)
    .eq("empresa_id", args.empresaId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (currentVersionError || !currentVersion || currentVersion.id !== version.id) return invalid;

  const expirationDate = offerExpiryDate(version.submitted_at, version.offer_validity);
  if (expirationDate && expirationDate < new Date().toISOString().slice(0, 10)) return invalid;

  const precio = Number(quoteItem.precio_unitario);
  if (!Number.isFinite(precio) || precio <= 0) return invalid;
  return { precio, error: null };
}

/** Vuelve el insumo al precio sugerido automáticamente. */
export async function clearProjectCostPriceAction(projectId: string, productoId: string): Promise<{ error: string | null }> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const supabase = await createClient();
    const { error } = await supabase
      .from("project_cost_prices")
      .delete()
      .eq("empresa_id", profile.empresa_id)
      .eq("project_id", projectId)
      .eq("producto_id", productoId);
    if (error) return { error: error.message };
    revalidatePath(`/projects/${projectId}`);
    return { error: null };
  } catch (err: any) {
    return { error: err.message };
  }
}
