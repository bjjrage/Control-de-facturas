"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";

export interface RecepcionItemInput {
  order_item_id: string;
  cantidad_recibida: number;
  producto_id?: string | null;
  notas?: string;
}

export async function registrarRecepcion(
  order_id: string,
  fecha: string,
  recibido_por: string,
  items: RecepcionItemInput[],
  notas?: string
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const profile = await requireProfile(["comercial", "administracion", "admin"]);

  // Verify order belongs to this empresa
  const { data: order } = await supabase
    .from("authorized_orders")
    .select("id, code")
    .eq("id", order_id)
    .single<{ id: string; code: string | null }>();

  if (!order) return { error: "Orden no encontrada" };

  const validItems = items.filter((i) => i.cantidad_recibida > 0);
  if (validItems.length === 0) return { error: "Debés ingresar al menos una cantidad recibida" };

  // Precio unitario de cada línea de la OC — se usa como costo de la entrada
  const { data: orderItems } = await supabase
    .from("authorized_order_items")
    .select("id, unit_price")
    .eq("order_id", order_id)
    .returns<{ id: string; unit_price: number }[]>();
  const precioPorItem = new Map((orderItems ?? []).map((oi) => [oi.id, oi.unit_price]));

  const { data: recepcion, error: recErr } = await supabase
    .from("oc_recepciones")
    .insert({
      empresa_id: profile.empresa_id,
      order_id,
      fecha,
      recibido_por: recibido_por.trim(),
      notas: notas?.trim() || null,
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (recErr || !recepcion) return { error: recErr?.message ?? "Error al registrar recepción" };

  const { error: itemsErr } = await supabase.from("oc_recepcion_items").insert(
    validItems.map((i) => ({
      empresa_id: profile.empresa_id,
      recepcion_id: recepcion.id,
      order_item_id: i.order_item_id,
      producto_id: i.producto_id || null,
      cantidad_recibida: i.cantidad_recibida,
      notas: i.notas?.trim() || null,
    }))
  );

  if (itemsErr) {
    await supabase.from("oc_recepciones").delete().eq("id", recepcion.id);
    return { error: itemsErr.message };
  }

  // Generar la ENTRADA de stock para cada línea asociada a un producto
  const conProducto = validItems.filter((i) => i.producto_id);
  for (const i of conProducto) {
    const { error: stockErr } = await supabase.rpc("registrar_stock_movimiento", {
      p_empresa_id: profile.empresa_id,
      p_producto_id: i.producto_id,
      p_tipo: "ENTRADA",
      p_cantidad: i.cantidad_recibida,
      p_costo_unitario: precioPorItem.get(i.order_item_id) ?? null,
      p_referencia_tipo: "oc_recepcion",
      p_referencia_id: recepcion.id,
      p_notas: `Recepción OC ${order.code ?? ""}`.trim(),
      p_created_by: profile.id,
    });
    if (stockErr) {
      // Revertir todo: la recepción no se registra si el stock no puede aplicarse
      await supabase.from("oc_recepciones").delete().eq("id", recepcion.id);
      return { error: `Error al aplicar el stock: ${stockErr.message}` };
    }
  }

  await logAudit(supabase, {
    action: "oc_recepcion_created",
    authorizedOrderId: order_id,
    detail: {
      recepcion_id: recepcion.id,
      items_count: validItems.length,
      stock_entries: conProducto.length,
    },
  });

  revalidatePath(`/orders/${order_id}`);
  revalidatePath("/stock");
  return {};
}

export async function eliminarRecepcion(
  recepcion_id: string,
  order_id: string
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const profile = await requireProfile(["administracion", "admin"]);

  // Revertir las entradas de stock generadas por esta recepción
  const { data: movimientos } = await supabase
    .from("stock_movimientos")
    .select("id, producto_id, cantidad")
    .eq("referencia_tipo", "oc_recepcion")
    .eq("referencia_id", recepcion_id)
    .eq("tipo", "ENTRADA")
    .returns<{ id: string; producto_id: string; cantidad: number }[]>();

  for (const m of movimientos ?? []) {
    const { error: revErr } = await supabase.rpc("registrar_stock_movimiento", {
      p_empresa_id: profile.empresa_id,
      p_producto_id: m.producto_id,
      p_tipo: "SALIDA",
      p_cantidad: m.cantidad,
      p_referencia_tipo: "oc_recepcion_reversa",
      p_referencia_id: recepcion_id,
      p_notas: "Reversa: recepción eliminada",
      p_created_by: profile.id,
    });
    if (revErr) {
      return {
        error:
          "No se puede eliminar: parte del stock recibido ya fue consumido. " +
          "Ajustá el stock manualmente antes de eliminar la recepción.",
      };
    }
  }

  const { error } = await supabase.from("oc_recepciones").delete().eq("id", recepcion_id);
  if (error) return { error: error.message };

  await logAudit(supabase, {
    action: "oc_recepcion_deleted",
    authorizedOrderId: order_id,
    detail: { recepcion_id, stock_reversals: (movimientos ?? []).length },
  });

  revalidatePath(`/orders/${order_id}`);
  revalidatePath("/stock");
  return {};
}
