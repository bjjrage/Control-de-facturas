"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";

export interface RecepcionItemInput {
  order_item_id: string;
  cantidad_recibida: number;
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
    .select("id")
    .eq("id", order_id)
    .single();

  if (!order) return { error: "Orden no encontrada" };

  const validItems = items.filter((i) => i.cantidad_recibida > 0);
  if (validItems.length === 0) return { error: "Debés ingresar al menos una cantidad recibida" };

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
      cantidad_recibida: i.cantidad_recibida,
      notas: i.notas?.trim() || null,
    }))
  );

  if (itemsErr) {
    await supabase.from("oc_recepciones").delete().eq("id", recepcion.id);
    return { error: itemsErr.message };
  }

  await logAudit(supabase, {
    action: "oc_recepcion_created",
    authorizedOrderId: order_id,
    detail: { recepcion_id: recepcion.id, items_count: validItems.length },
  });

  revalidatePath(`/orders/${order_id}`);
  return {};
}

export async function eliminarRecepcion(
  recepcion_id: string,
  order_id: string
): Promise<{ error?: string }> {
  const supabase = await createClient();
  await requireProfile(["administracion", "admin"]);

  const { error } = await supabase
    .from("oc_recepciones")
    .delete()
    .eq("id", recepcion_id);

  if (error) return { error: error.message };

  await logAudit(supabase, {
    action: "oc_recepcion_deleted",
    authorizedOrderId: order_id,
    detail: { recepcion_id },
  });

  revalidatePath(`/orders/${order_id}`);
  return {};
}
