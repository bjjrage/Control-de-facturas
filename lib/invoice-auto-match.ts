import { SupabaseClient } from "@supabase/supabase-js";
import { roundCents } from "./reconciliation";
import { logAudit } from "./audit";

/**
 * Deterministic auto-match: if this provider has exactly one authorized order,
 * not yet linked to any invoice, whose total coincides (to the cent) with the
 * invoice total, link it automatically. Ambiguous (0 or 2+ candidates) cases
 * are left for manual matching via the "Vincular orden" dialog.
 *
 * Used by both the single-invoice form (app/(internal)/invoices/actions.ts)
 * and the batch photo upload (app/(internal)/invoices/bulk-actions.ts).
 */
export async function autoMatchInvoiceByAmount(
  supabase: SupabaseClient,
  params: { invoiceId: string; providerId: string; total: number }
): Promise<string | null> {
  const { invoiceId, providerId, total } = params;

  const { data: matchedRows } = await supabase.from("invoice_order_matches").select("authorized_order_id");
  const matchedIds = new Set((matchedRows ?? []).map((m) => m.authorized_order_id as string));

  const { data: providerOrders } = await supabase
    .from("authorized_orders")
    .select("id, total_price")
    .eq("provider_id", providerId);

  const candidates = (providerOrders ?? []).filter(
    (o) => !matchedIds.has(o.id) && roundCents(o.total_price) === roundCents(total)
  );

  if (candidates.length !== 1) return null;

  const { error: matchError } = await supabase
    .from("invoice_order_matches")
    .insert({ invoice_id: invoiceId, authorized_order_id: candidates[0].id });
  if (matchError) return null;

  await logAudit(supabase, {
    action: "invoice.order_auto_matched",
    invoiceId,
    authorizedOrderId: candidates[0].id,
  });

  return candidates[0].id as string;
}
