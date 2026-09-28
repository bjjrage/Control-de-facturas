"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlan } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { DEFAULT_RFQ_WINDOW_HOURS } from "@/lib/rfq-status";
import { explodeMaterialNeeds, groupNeedsByRubro } from "@/lib/costing/insumos";

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
