import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashReceiptPortalToken, isReceiptPortalToken } from "@/lib/inventory/receipt-portal";

export type ReceiptPortalItem = {
  id: string;
  product: string;
  unit: string;
  ordered: number;
  received: number;
  pending: number;
};

export type ReceiptPortalOrder = {
  code: string;
  providerName: string;
  items: ReceiptPortalItem[];
};

export async function getReceiptPortalContext(token: string) {
  if (!isReceiptPortalToken(token)) return null;
  const admin = createAdminClient();
  const { data: link, error: linkError } = await admin
    .from("receipt_portal_links")
    .select("id, empresa_id, order_id, location_id")
    .eq("token_hash", hashReceiptPortalToken(token))
    .eq("active", true)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (linkError || !link) return null;

  const [{ data: order, error: orderError }, { data: orderItems, error: itemsError }, { data: location, error: locationError }] =
    await Promise.all([
      admin
        .from("authorized_orders")
        .select("id, code, provider_name, empresa_id, project_id")
        .eq("id", link.order_id)
        .eq("empresa_id", link.empresa_id)
        .maybeSingle(),
      admin
        .from("authorized_order_items")
        .select("id, product, quantity, unit")
        .eq("order_id", link.order_id)
        .eq("empresa_id", link.empresa_id)
        .order("sort_order", { ascending: true }),
      admin
        .from("inventory_locations")
        .select("id, active, location_type, project_id")
        .eq("id", link.location_id)
        .eq("empresa_id", link.empresa_id)
        .maybeSingle(),
    ]);
  if (
    orderError || itemsError || locationError || !order || order.project_id == null || !orderItems?.length ||
    !location?.active || location.location_type !== "PROJECT" || location.project_id !== order.project_id
  ) return null;

  const { data: receipts, error: receiptsError } = await admin
    .from("oc_recepciones")
    .select("id")
    .eq("order_id", order.id)
    .eq("empresa_id", link.empresa_id)
    .in("status", ["DRAFT", "CONFIRMED"]);
  if (receiptsError) return null;

  const receiptIds = (receipts ?? []).map((receipt) => receipt.id as string);
  const receivedByItem = new Map<string, number>();
  if (receiptIds.length > 0) {
    const { data: receiptItems, error: receiptItemsError } = await admin
      .from("oc_recepcion_items")
      .select("order_item_id, cantidad_recibida")
      .eq("empresa_id", link.empresa_id)
      .in("recepcion_id", receiptIds);
    if (receiptItemsError) return null;
    for (const item of receiptItems ?? []) {
      const itemId = item.order_item_id as string;
      receivedByItem.set(itemId, (receivedByItem.get(itemId) ?? 0) + Number(item.cantidad_recibida));
    }
  }

  return {
    admin,
    link: {
      id: link.id as string,
      empresaId: link.empresa_id as string,
      orderId: link.order_id as string,
      locationId: link.location_id as string,
    },
    order: {
      code: order.code as string,
      providerName: order.provider_name as string,
      items: orderItems.map((item) => {
        const ordered = Number(item.quantity);
        const received = receivedByItem.get(item.id as string) ?? 0;
        return {
          id: item.id as string,
          product: item.product as string,
          unit: item.unit as string,
          ordered,
          received,
          pending: Math.max(0, ordered - received),
        };
      }),
    } satisfies ReceiptPortalOrder,
  };
}
