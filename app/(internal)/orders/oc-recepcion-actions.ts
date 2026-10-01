"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePlan, requireProfile } from "@/lib/auth";
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
  if (typeof order_id !== "string" || !order_id.trim()) return { error: "Falta la orden de compra." };
  if (typeof fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return { error: "La fecha de recepción no es válida." };
  }
  if (typeof recibido_por !== "string" || !recibido_por.trim()) {
    return { error: "Ingresá quién recibió la mercadería." };
  }
  if (typeof idempotency_key !== "string" || !idempotency_key.trim() || idempotency_key.length > 200) {
    return { error: "Falta una clave idempotente de recepción válida." };
  }
  if (!Array.isArray(items)) return { error: "Las líneas de recepción no son válidas." };
  if (items.some((item) =>
    !item
    || typeof item.order_item_id !== "string"
    || !item.order_item_id.trim()
    || typeof item.cantidad_recibida !== "number"
    || !Number.isFinite(item.cantidad_recibida)
    || item.cantidad_recibida < 0
    || (item.producto_id != null && typeof item.producto_id !== "string")
    || (item.notas != null && typeof item.notas !== "string")
  )) return { error: "Una o más líneas de recepción no son válidas." };

  const validItems = items.filter((i) => i.cantidad_recibida > 0);
  if (validItems.length === 0) return { error: "Debés ingresar al menos una cantidad recibida" };
  if (new Set(validItems.map((item) => item.order_item_id)).size !== validItems.length) {
    return { error: "No se puede repetir un ítem de la OC en la recepción." };
  }

  const created = await createInventoryReceipt(supabase, {
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

  if (created.data.created) {
    await logAudit(supabase, {
      action: "oc_recepcion_created",
      authorizedOrderId: order_id,
      detail: {
        recepcion_id: created.data.receiptId,
        items_count: validItems.length,
        status: "DRAFT",
      },
    });
  }

  const confirmed = await confirmInventoryReceipt(supabase, {
    empresaId: profile.empresa_id,
    receiptId: created.data.receiptId,
    idempotencyKey: idempotency_key.trim(),
    confirmedBy: profile.id,
  });
  if (confirmed.error) {
    revalidatePath("/orders/" + order_id);
    return {
      error: "La recepción quedó en borrador y no afectó inventario. Podés reintentar la confirmación. " + confirmed.error,
      receiptId: created.data.receiptId,
    };
  }

  revalidatePath("/orders/" + order_id);
  revalidatePath("/stock");
  revalidatePath("/inventario");
  return { receiptId: created.data.receiptId };
}

export async function confirmarRecepcion(recepcion_id: string, order_id: string): Promise<{ error?: string }> {
  const profile = await requireProfile(["comercial", "administracion", "admin"]);
  if (!profile.empresa_id) return { error: "La cuenta no tiene una empresa activa." };
  const supabase = await createClient();
  const { data: receipt } = await supabase
    .from("oc_recepciones")
    .select("id, status, idempotency_key")
    .eq("id", recepcion_id)
    .eq("order_id", order_id)
    .eq("empresa_id", profile.empresa_id)
    .maybeSingle();
  if (!receipt) return { error: "Recepción no encontrada." };
  if (receipt.status === "CONFIRMED") {
    revalidatePath("/orders/" + order_id);
    revalidatePath("/stock");
    revalidatePath("/inventario");
    return {};
  }
  if (receipt.status !== "DRAFT" || !receipt.idempotency_key) {
    return { error: "Este borrador histórico no tiene clave canónica y requiere reconciliación manual." };
  }
  if (receipt.idempotency_key.startsWith("receipt-portal:")) {
    const { data: lines, error: linesError } = await supabase
      .from("oc_recepcion_items")
      .select("producto_id")
      .eq("recepcion_id", receipt.id)
      .eq("empresa_id", profile.empresa_id);
    if (linesError || !lines?.length || lines.some((line) => !line.producto_id)) {
      return { error: "Vinculá todos los productos de inventario antes de confirmar esta recepción externa." };
    }
  }

  const result = await confirmInventoryReceipt(supabase, {
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
  revalidatePath("/inventario");
  return {};
}

export async function updateReceiptProductMapping(args: {
  receiptId: string;
  itemId: string;
  productId: string;
}): Promise<{ error?: string }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  if (
    !profile.empresa_id ||
    !/^[0-9a-f-]{36}$/i.test(args.receiptId) ||
    !/^[0-9a-f-]{36}$/i.test(args.itemId) ||
    !/^[0-9a-f-]{36}$/i.test(args.productId)
  ) return { error: "La línea, el producto o la recepción no son válidos." };

  const supabase = await createClient();
  const { data: receipt } = await supabase
    .from("oc_recepciones")
    .select("id, order_id, status")
    .eq("id", args.receiptId)
    .eq("empresa_id", profile.empresa_id)
    .maybeSingle();
  if (!receipt || receipt.status !== "DRAFT") {
    return { error: "La recepción ya no está pendiente de revisión." };
  }

  const { error } = await supabase.rpc("inventory_set_receipt_item_product", {
    p_empresa_id: profile.empresa_id,
    p_receipt_id: receipt.id,
    p_item_id: args.itemId,
    p_product_id: args.productId,
    p_updated_by: profile.id,
  });
  if (error) {
    return { error: "No se pudo vincular el producto. La recepción puede haber cambiado de estado." };
  }

  await logAudit(supabase, {
    action: "oc_recepcion_product_mapped",
    authorizedOrderId: receipt.order_id,
    detail: { recepcion_id: receipt.id, item_id: args.itemId, producto_id: args.productId },
  });

  revalidatePath(`/orders/${receipt.order_id}`);
  revalidatePath("/inventario");
  return {};
}

export async function eliminarRecepcion(
  recepcion_id: string,
  order_id: string
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const profile = await requireProfile(["comercial", "administracion", "admin"]);
  if (!profile.empresa_id) return { error: "La cuenta no tiene una empresa activa." };

  const { data: receipt } = await supabase
    .from("oc_recepciones")
    .select("status, idempotency_key, created_by")
    .eq("id", recepcion_id)
    .eq("order_id", order_id)
    .eq("empresa_id", profile.empresa_id)
    .maybeSingle();
  if (!receipt) return { error: "Recepción no encontrada." };
  const canDiscardAnyDraft = profile.role === "administracion" || profile.role === "admin";
  if (!canDiscardAnyDraft && receipt.created_by !== profile.id) {
    return { error: "Solo podés descartar tus propios borradores de recepción." };
  }
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

  const { data: deletedReceipt, error } = await supabase
    .from("oc_recepciones")
    .delete()
    .eq("id", recepcion_id)
    .eq("empresa_id", profile.empresa_id)
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!deletedReceipt) {
    return { error: "No se descartó el borrador; quizá ya cambió de estado o no tenés permiso." };
  }

  await logAudit(supabase, {
    action: "oc_recepcion_deleted",
    authorizedOrderId: order_id,
    detail: { recepcion_id },
  });

  revalidatePath(`/orders/${order_id}`);
  revalidatePath("/stock");
  return {};
}
