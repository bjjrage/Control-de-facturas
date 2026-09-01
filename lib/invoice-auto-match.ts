import { SupabaseClient } from "@supabase/supabase-js";
import { roundCents, OVERBILL_TOLERANCE_PCT } from "./reconciliation";
import { logAudit } from "./audit";

/**
 * Auto-match para entregas parciales (1 factura -> 1 OC). De las OC del
 * proveedor con saldo sin facturar (`total_price - facturado_amount > 0`), si
 * hay exactamente una y el total de la factura entra dentro de ese saldo (más
 * la tolerancia de sobrefacturación), se vincula sola. Casos ambiguos (0 o 2+
 * OC con saldo) quedan para el "Vincular orden" manual.
 *
 * Usado por el alta individual (app/(internal)/invoices/actions.ts) y el alta
 * masiva por foto (app/(internal)/invoices/bulk-actions.ts).
 */
export async function autoMatchInvoiceByAmount(
  supabase: SupabaseClient,
  params: { invoiceId: string; providerId: string; total: number; empresaId: string }
): Promise<string | null> {
  const { invoiceId, providerId, total, empresaId } = params;

  const { data: providerOrders } = await supabase
    .from("authorized_orders")
    .select("id, total_price, facturado_amount")
    .eq("empresa_id", empresaId)
    .eq("provider_id", providerId);

  const withBalance = (providerOrders ?? []).filter(
    (o) => roundCents(o.total_price) - roundCents(o.facturado_amount ?? 0) > 0
  );
  if (withBalance.length !== 1) return null;

  const order = withBalance[0];
  const remaining = roundCents(order.total_price) - roundCents(order.facturado_amount ?? 0);
  const maxAllowed = roundCents(remaining * (1 + OVERBILL_TOLERANCE_PCT / 100));
  if (roundCents(total) > maxAllowed) return null;

  const { error: matchError } = await supabase
    .from("invoice_order_matches")
    .insert({ invoice_id: invoiceId, authorized_order_id: order.id, empresa_id: empresaId });
  if (matchError) return null;

  await logAudit(supabase, {
    action: "invoice.order_auto_matched",
    invoiceId,
    authorizedOrderId: order.id,
  });

  return order.id as string;
}
