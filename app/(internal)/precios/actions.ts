"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePlan } from "@/lib/auth";
import { PRECIO_LISTA_DOC } from "@/lib/costing/price-list";
import { findUniqueExactInventoryMatch } from "@/lib/inventory/initial-stock-import";

/**
 * Fija a mano el precio de referencia de un material: queda como una
 * observación más (fuente MANUAL, fecha de hoy) en la base de precios. Una
 * factura o cotización posterior sigue contando; no se pisa nada.
 */
export async function setMaterialPriceAction(params: {
  productoId: string;
  precio: number;
}): Promise<{ error: string | null }> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const supabase = await createClient();
    const precio = Number(params.precio);
    if (!Number.isFinite(precio) || precio <= 0) return { error: "Ingresá un precio mayor a cero." };

    const { data: product } = await supabase
      .from("productos")
      .select("id, nombre, unidad")
      .eq("id", params.productoId)
      .eq("empresa_id", profile.empresa_id)
      .maybeSingle();
    if (!product) return { error: "Material no encontrado." };

    const { error } = await supabase.from("cost_observations").insert({
      empresa_id: profile.empresa_id,
      producto_id: product.id,
      proveedor_id: null,
      fuente: "MANUAL",
      documento_id: PRECIO_LISTA_DOC,
      descripcion_item: product.nombre,
      categoria_insumo: "MATERIAL",
      cantidad: 1,
      unidad: String(product.unidad || "UN").toUpperCase(),
      precio_unitario: precio,
      moneda: "PYG",
      moneda_original: "PYG",
      precio_unitario_original: precio,
      tipo_cambio: null,
      fecha_observacion: new Date().toISOString().slice(0, 10),
      estado_evidencia: "VALIDA",
    });
    if (error) return { error: "No se pudo guardar el precio." };
    revalidatePath("/precios");
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo guardar el precio." };
  }
}

/**
 * Vincula compras anteriores (facturas, órdenes, cotizaciones) que no tienen
 * material asignado, por coincidencia exacta y única del nombre con el catálogo.
 * Lo que tenga duda se deja sin vincular.
 */
export async function linkPurchasesAutomaticallyAction(): Promise<{ vinculadas: number; sinCoincidencia: number; error: string | null }> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const supabase = await createClient();
    const empresaId = profile.empresa_id;
    const [catalogRes, obsRes] = await Promise.all([
      supabase.from("productos").select("id, nombre").eq("empresa_id", empresaId).eq("activo", true),
      supabase
        .from("cost_observations")
        .select("descripcion_item")
        .eq("empresa_id", empresaId)
        .is("producto_id", null)
        .eq("categoria_insumo", "MATERIAL")
        .limit(5000),
    ]);
    const catalog = ((catalogRes.data ?? []) as { id: string; nombre: string }[]).map((p) => ({ id: p.id, name: p.nombre }));
    const descriptions = [...new Set(((obsRes.data ?? []) as { descripcion_item: string }[]).map((o) => o.descripcion_item))];
    let vinculadas = 0;
    let sinCoincidencia = 0;
    for (const descripcion of descriptions) {
      const match = findUniqueExactInventoryMatch(descripcion, catalog);
      if (!match) {
        sinCoincidencia++;
        continue;
      }
      const { data, error } = await supabase
        .from("cost_observations")
        .update({ producto_id: match.id })
        .eq("empresa_id", empresaId)
        .is("producto_id", null)
        .eq("descripcion_item", descripcion)
        .select("id");
      if (error) return { vinculadas, sinCoincidencia, error: "No se pudieron vincular algunas compras." };
      vinculadas += data?.length ?? 0;
    }
    revalidatePath("/precios");
    return { vinculadas, sinCoincidencia, error: null };
  } catch (e) {
    return { vinculadas: 0, sinCoincidencia: 0, error: e instanceof Error ? e.message : "No se pudieron vincular las compras." };
  }
}

/** Vincula a mano todas las compras con esa descripción a un material del catálogo. */
export async function linkPurchaseDescriptionAction(params: {
  descripcion: string;
  productoId: string;
}): Promise<{ vinculadas: number; error: string | null }> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const supabase = await createClient();
    const { data: product } = await supabase
      .from("productos")
      .select("id")
      .eq("id", params.productoId)
      .eq("empresa_id", profile.empresa_id)
      .maybeSingle();
    if (!product) return { vinculadas: 0, error: "Material no encontrado." };
    const { data, error } = await supabase
      .from("cost_observations")
      .update({ producto_id: product.id })
      .eq("empresa_id", profile.empresa_id)
      .is("producto_id", null)
      .eq("descripcion_item", params.descripcion)
      .select("id");
    if (error) return { vinculadas: 0, error: "No se pudo vincular." };
    revalidatePath("/precios");
    return { vinculadas: data?.length ?? 0, error: null };
  } catch (e) {
    return { vinculadas: 0, error: e instanceof Error ? e.message : "No se pudo vincular." };
  }
}
