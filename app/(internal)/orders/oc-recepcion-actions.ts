"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { confirmInventoryReceipt, createInventoryReceipt } from "@/lib/inventory/service";
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
  notas?: string,
  idempotency_key?: string
): Promise<{ error?: string; receiptId?: string }> {
  const supabase = await createClient();
  const profile = await requireProfile(["comercial", "administracion", "admin"]);
  if (!profile.empresa_id) return { error: "La cuenta no tiene una empresa activa." };
  if (!idempotency_key?.trim()) return { error: "Falta la clave idempotente de recepción." };

  const validItems = items.filter((i) => i.cantidad_recibida > 0);
  if (validItems.length === 0) return { error: "Debés ingresar al menos una cantidad recibida" };
  if (new Set(validItems.map((item) => item.order_item_id)).size !== validItems.length) {
    return { error: "No se puede repetir un ítem de la OC en la recepción." };
  }

  const admin = createAdminClient();
  const created = await createInventoryReceipt(admin, {
    empresaId: profile.empresa_id,
    orderId: order_id,
    fecha,
    recibidoPor: recibido_por.trim(),
    idempotencyKey: idempotency_key.trim(),
    createdBy: profile.id,
    notes: notas?.trim() || null,
    items: validItems.map((item) => ({
      orderItemId: item.order_item_id,
      productoId: item.producto_id || null,
      quantity: item.cantidad_recibida,
      notes: item.notas?.trim() || null,
    })),
  });
  if (created.error || !created.data) {
    return { error: created.error ?? "No se pudo crear la recepción." };
  }

  const confirmed = await confirmInventoryReceipt(admin, {
    empresaId: profile.empresa_id,
    receiptId: created.data,
    idempotencyKey: idempotency_key.trim(),
    confirmedBy: profile.id,
  });
  if (confirmed.error) {
    revalidatePath("/orders/" + order_id);
    return {
      error: "La recepción quedó en borrador y no afectó inventario. Podés reintentar la confirmación. " + confirmed.error,
      receiptId: created.data,
    };
  }

  await logAudit(supabase, {
    action: "oc_recepcion_created",
    authorizedOrderId: order_id,
    detail: {
      recepcion_id: created.data,
      items_count: validItems.length,
      stock_entries: confirmed.data?.length ?? 0,
    },
  });

  revalidatePath("/orders/" + order_id);
  revalidatePath("/stock");
  return { receiptId: created.data };
}

export async function confirmarRecepcion(recepcion_id: string, order_id: string): Promise<{ error?: string }> {
  const profile = await requireProfile(["comercial", "administracion", "admin"]);
  if (!profile.empresa_id) return { error: "La cuenta no tiene una empresa activa." };
  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: receipt } = await admin
    .from("oc_recepciones")
    .select("id, status, idempotency_key")
    .eq("id", recepcion_id)
    .eq("order_id", order_id)
    .eq("empresa_id", profile.empresa_id)
    .maybeSingle();
  if (!receipt) return { error: "Recepción no encontrada." };
  if (receipt.status === "CONFIRMED") return {};
  if (receipt.status !== "DRAFT" || !receipt.idempotency_key) {
    return { error: "Este borrador histórico no tiene clave canónica y requiere reconciliación manual." };
  }

  const result = await confirmInventoryReceipt(admin, {
    empresaId: profile.empresa_id,
    receiptId: recepcion_id,
    idempotencyKey: receipt.idempotency_key,
    confirmedBy: profile.id,
  });
  if (result.error) return { error: result.error };
  await logAudit(supabase, {
    action: "oc_recepcion_confirmed",
    authorizedOrderId: order_id,
    detail: { recepcion_id, movements: result.data?.length ?? 0 },
  });
  revalidatePath("/orders/" + order_id);
  revalidatePath("/stock");
  return {};
}

export async function eliminarRecepcion(
  recepcion_id: string,
  order_id: string
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const profile = await requireProfile(["administracion", "admin"]);

  const { data: receipt } = await supabase
    .from("oc_recepciones")
    .select("status, idempotency_key")
    .eq("id", recepcion_id)
    .eq("order_id", order_id)
    .eq("empresa_id", profile.empresa_id)
    .maybeSingle();
  if (!receipt) return { error: "Recepción no encontrada." };
  if (receipt.status !== "DRAFT") {
    return { error: "Solo se pueden eliminar borradores; una recepción confirmada es inmutable." };
  }
  if (!receipt.idempotency_key) {
    return { error: "Este borrador histórico requiere reconciliación y no se puede eliminar automáticamente." };
  }
  const { data: linkedItems } = await supabase
    .from("oc_recepcion_items")
    .select("id")
    .eq("recepcion_id", recepcion_id)
    .eq("empresa_id", profile.empresa_id)
    .not("inventory_movement_id", "is", null)
    .limit(1);
  if (linkedItems?.length) {
    return { error: "El borrador ya tiene movimientos vinculados y requiere revisión antes de eliminarse." };
  }

  const { error } = await supabase
    .from("oc_recepciones")
    .delete()
    .eq("id", recepcion_id)
    .eq("empresa_id", profile.empresa_id);
  if (error) return { error: error.message };

  await logAudit(supabase, {
    action: "oc_recepcion_deleted",
    authorizedOrderId: order_id,
    detail: { recepcion_id },
  });

  revalidatePath(`/orders/${order_id}`);
  revalidatePath("/stock");
  return {};
}
