"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePlan } from "@/lib/auth";
import { PRECIO_LISTA_DOC } from "@/lib/costing/price-list";

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
