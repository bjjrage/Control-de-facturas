// lib/procurement/issue-po-service.ts
// Domain service decoupled from Next.js Server Actions.
// Emite una Orden de Compra oficial (authorized_orders) a partir de un borrador existente (purchase_order_drafts).
// Revalida tenant, estado DRAFT del borrador, no-reemisión, genera items y marca DRAFT como ISSUED.
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit";

export interface IssuePurchaseOrderParams {
  db: SupabaseClient;
  empresaId: string;
  userId: string;
  poDraftId: string;
  confirmIssuance: boolean;
}

export interface IssuePurchaseOrderResult {
  orderId: string;
  orderCode?: string;
  poDraftId: string;
  rfqId: string;
  providerId: string;
  providerName: string;
  totalPrice: number;
  currency: string;
  itemsCount: number;
  status: "AUTORIZADO";
}

export async function issuePurchaseOrderDomainService(
  params: IssuePurchaseOrderParams
): Promise<IssuePurchaseOrderResult> {
  const { db, empresaId, userId, poDraftId, confirmIssuance } = params;

  if (!confirmIssuance) {
    throw new Error("confirm_issuance debe ser true para emitir la Orden de Compra.");
  }

  // 1. Validar existencia del PO draft, tenant y estado
  const { data: poDraft, error: draftErr } = await db
    .from("purchase_order_drafts")
    .select("*")
    .eq("id", poDraftId)
    .eq("empresa_id", empresaId)
    .single();

  if (draftErr || !poDraft) {
    throw new Error(`Borrador de Orden de Compra no encontrado o no pertenece a tu empresa (id=${poDraftId})`);
  }

  // State revalidation: no se puede emitir si ya no está en DRAFT
  if (poDraft.status === "ISSUED") {
    throw new Error(`La Orden de Compra ya fue emitida previamente para este borrador (id=${poDraftId})`);
  }
  if (poDraft.status === "CANCELLED") {
    throw new Error(`El borrador de Orden de Compra se encuentra CANCELADO (id=${poDraftId})`);
  }
  if (poDraft.status !== "DRAFT") {
    throw new Error(`Estado inválido para emisión: ${poDraft.status} (requiere DRAFT)`);
  }

  // 2. Obtener items del PO draft
  const { data: draftItems, error: itemsErr } = await db
    .from("purchase_order_draft_items")
    .select("*")
    .eq("purchase_order_draft_id", poDraftId)
    .order("created_at", { ascending: true });

  if (itemsErr) {
    throw new Error(`Error al leer los ítems del borrador: ${itemsErr.message}`);
  }

  if (!draftItems || draftItems.length === 0) {
    throw new Error("El borrador de Orden de Compra no tiene ítems para emitir.");
  }

  const firstItem = draftItems[0];
  const grandTotal = Number(poDraft.total_price_pyg) || 0;

  // 3. Crear la orden oficial en authorized_orders
  // El trigger de base de datos se encarga de setear code si no se pasa.
  const { data: newOrder, error: orderErr } = await db
    .from("authorized_orders")
    .insert({
      empresa_id: empresaId,
      provider_id: poDraft.supplier_id,
      provider_name: poDraft.supplier_nombre,
      product: firstItem.description || "Material de Orden",
      quantity: firstItem.quantity || 1,
      unit: firstItem.unit || "u",
      unit_price: firstItem.price_pyg || grandTotal,
      total_price: grandTotal,
      currency: poDraft.currency === "USD" ? "USD" : "PYG",
      vat_included: true,
      authorized_by: userId,
      is_cheapest: true,
      created_from: "rfq",
      rfq_id: poDraft.rfq_id,
      project_id: poDraft.project_id || null,
      status: "AUTORIZADO",
    })
    .select("id, code, status")
    .single();

  if (orderErr || !newOrder) {
    throw new Error(`Error al emitir la Orden de Compra en authorized_orders: ${orderErr?.message ?? "sin data"}`);
  }

  // 4. Insertar los ítems detallados en authorized_order_items
  const orderItemRows = draftItems.map((item, idx) => ({
    order_id: newOrder.id,
    empresa_id: empresaId,
    product: item.description,
    quantity: item.quantity,
    unit: item.unit || "u",
    unit_price: item.price_pyg || 0,
    total_price: (Number(item.price_pyg) || 0) * (Number(item.quantity) || 1),
    sort_order: idx,
  }));

  const { error: insItemsErr } = await db.from("authorized_order_items").insert(orderItemRows);
  if (insItemsErr) {
    // Intentar rollback de cabecera si fallaron los items
    await db.from("authorized_orders").delete().eq("id", newOrder.id);
    throw new Error(`Error al insertar ítems de la Orden de Compra: ${insItemsErr.message}`);
  }

  // 5. Transicionar el borrador purchase_order_drafts a ISSUED
  const { error: updDraftErr } = await db
    .from("purchase_order_drafts")
    .update({ status: "ISSUED" })
    .eq("id", poDraftId)
    .eq("empresa_id", empresaId);

  if (updDraftErr) {
    // Loguear warning pero la orden ya fue emitida
    console.warn(`No se pudo actualizar status de purchase_order_drafts: ${updDraftErr.message}`);
  }

  // 6. Log de auditoría
  try {
    await logAudit(db, {
      action: "order.issued",
      authorizedOrderId: newOrder.id,
      rfqId: poDraft.rfq_id,
      detail: {
        po_draft_id: poDraftId,
        provider_id: poDraft.supplier_id,
        total_price: grandTotal,
        currency: poDraft.currency,
        items_count: draftItems.length,
      },
    });
  } catch {
    // best-effort audit
  }

  return {
    orderId: newOrder.id,
    orderCode: newOrder.code,
    poDraftId,
    rfqId: poDraft.rfq_id,
    providerId: poDraft.supplier_id,
    providerName: poDraft.supplier_nombre,
    totalPrice: grandTotal,
    currency: poDraft.currency,
    itemsCount: draftItems.length,
    status: "AUTORIZADO",
  };
}
