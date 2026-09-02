import { SupabaseClient } from "@supabase/supabase-js";
import { roundCents, OVERBILL_TOLERANCE_PCT } from "./reconciliation";
import { logAudit } from "./audit";

/**
 * Auto-match para entregas parciales (1 factura -> 1 OC). De las OC del
 * proveedor con saldo sin facturar, se elige por prioridad:
 *
 *   1. La única cuyo SALDO coincide exacto con el total de la factura
 *      (entrega que completa la OC, o factura única = monto de la OC).
 *   2. La única cuyo MONTO TOTAL coincide exacto y todavía no tiene facturas
 *      (el caso clásico factura = orden).
 *   3. Si hay una sola OC con saldo y la factura entra (saldo + tolerancia).
 *
 * Cualquier caso ambiguo (varias candidatas, o ninguna clara) queda para el
 * "Vincular orden" manual.
 *
 * Usado por el alta individual (app/(internal)/invoices/actions.ts) y el worker
 * del bulk (worker/index.ts).
 */
export async function autoMatchInvoiceByAmount(
  supabase: SupabaseClient,
  params: { invoiceId: string; providerId: string; total: number; empresaId: string }
): Promise<string | null> {
  const { invoiceId, providerId, total, empresaId } = params;
  const target = roundCents(total);
  const maxFactor = 1 + OVERBILL_TOLERANCE_PCT / 100;

  const { data: providerOrders } = await supabase
    .from("authorized_orders")
    .select("id, total_price, facturado_amount")
    .eq("empresa_id", empresaId)
    .eq("provider_id", providerId);

  const orders = (providerOrders ?? []).map((o) => ({
    id: o.id as string,
    total: roundCents(o.total_price),
    facturado: roundCents(o.facturado_amount ?? 0),
    saldo: roundCents(o.total_price - (o.facturado_amount ?? 0)),
  }));

  const withBalance = orders.filter((o) => o.saldo > 0);
  if (withBalance.length === 0) return null;

  const pick = (() => {
    // 1. saldo exacto
    const bySaldo = withBalance.filter((o) => o.saldo === target);
    if (bySaldo.length === 1) return bySaldo[0];
    if (bySaldo.length > 1) return null;

    // 2. monto de la orden exacto y sin facturar aún
    const byTotal = withBalance.filter((o) => o.total === target && o.facturado === 0);
    if (byTotal.length === 1) return byTotal[0];
    if (byTotal.length > 1) return null;

    // 3. única OC con saldo, y la factura entra
    if (withBalance.length === 1 && target <= roundCents(withBalance[0].saldo * maxFactor)) {
      return withBalance[0];
    }
    return null;
  })();

  if (!pick) return null;

  const { error: matchError } = await supabase
    .from("invoice_order_matches")
    .insert({ invoice_id: invoiceId, authorized_order_id: pick.id, empresa_id: empresaId });
  if (matchError) return null;

  await logAudit(supabase, {
    action: "invoice.order_auto_matched",
    invoiceId,
    authorizedOrderId: pick.id,
  });

  return pick.id;
}
