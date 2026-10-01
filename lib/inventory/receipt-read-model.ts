export interface ReceiptReadModelItem {
  order_item_id: string;
  cantidad_recibida: number;
}

export interface ReceiptReadModelRecord {
  status: "DRAFT" | "CONFIRMED" | "VOIDED";
  oc_recepcion_items?: readonly ReceiptReadModelItem[] | null;
}

/** Inbound summaries only include receipts whose inventory/order effect is confirmed. */
export function confirmedReceiptTotals(
  receipts: readonly ReceiptReadModelRecord[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const receipt of receipts) {
    if (receipt.status !== "CONFIRMED") continue;
    for (const item of receipt.oc_recepcion_items ?? []) {
      totals[item.order_item_id] = (totals[item.order_item_id] ?? 0) + item.cantidad_recibida;
    }
  }
  return totals;
}
