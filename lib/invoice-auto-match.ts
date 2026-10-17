import { SupabaseClient } from "@supabase/supabase-js";
import { roundCents } from "./reconciliation";
import { logAudit } from "./audit";
import { normalizeDescription } from "./invoice-item-reconcile";

/** A sole candidate or an equal amount is never evidence of the purchased product. */
export function invoiceOrderContextMatches(input: {
  orderCode: string; orderProduct: string; orderReference?: string | null;
  descriptions: string[];
}): boolean {
  const reference = input.orderReference?.trim().toUpperCase();
  const code = input.orderCode.toUpperCase();
  if (reference && !reference.split(/[^A-Z0-9-]+/).includes(code)) return false;
  return input.descriptions.length > 0 && input.descriptions.every(description =>
    normalizeDescription(description) !== "" && normalizeDescription(description) === normalizeDescription(input.orderProduct));
}

/** Conservative automatic header association. Missing or conflicting evidence stays unlinked. */
export async function autoMatchInvoice(
  supabase: SupabaseClient,
  params: {
    invoiceId: string; providerId: string; total: number; empresaId: string;
    orderReference?: string | null; productDescription?: string | null;
  }
): Promise<string | null> {
  const { invoiceId, providerId, empresaId, orderReference, productDescription } = params;
  const { data: invoice, error: invoiceError } = await supabase.from("invoices")
    .select("provider_id, currency, total").eq("id", invoiceId).eq("empresa_id", empresaId).maybeSingle();
  if (invoiceError || !invoice || invoice.provider_id !== providerId) return null;
  const { data: items, error: itemError } = await supabase.from("invoice_items")
    .select("product_description").eq("invoice_id", invoiceId).eq("empresa_id", empresaId);
  if (itemError) return null;
  const descriptions = (items ?? []).map(item => item.product_description as string).filter(Boolean);
  if (productDescription?.trim()) descriptions.push(productDescription.trim());
  if (!descriptions.length) return null;
  const { data: orders, error: orderError } = await supabase.from("authorized_orders")
    .select("id, code, product, total_price, facturado_amount, currency")
    .eq("empresa_id", empresaId).eq("provider_id", providerId).eq("currency", invoice.currency);
  if (orderError) return null;
  const candidates = (orders ?? []).filter(order => {
    const remaining = roundCents(Number(order.total_price) - Number(order.facturado_amount ?? 0));
    return remaining > 0 && Number(invoice.total) > 0 && roundCents(invoice.total) <= remaining &&
      invoiceOrderContextMatches({ orderCode: order.code, orderProduct: order.product,
        orderReference, descriptions });
  });
  return candidates.length === 1 ? doMatch(supabase, invoiceId, candidates[0].id, empresaId) : null;
}

async function doMatch(
  supabase: SupabaseClient,
  invoiceId: string,
  orderId: string,
  empresaId: string
): Promise<string | null> {
  const { error } = await supabase
    .from("invoice_order_matches")
    .insert({ invoice_id: invoiceId, authorized_order_id: orderId, empresa_id: empresaId });
  if (error) return null;

  await logAudit(supabase, {
    action: "invoice.order_auto_matched",
    invoiceId,
    authorizedOrderId: orderId,
  });
  return orderId;
}

/** @deprecated Usar autoMatchInvoice con orderReference/productDescription */
export async function autoMatchInvoiceByAmount(
  supabase: SupabaseClient,
  params: { invoiceId: string; providerId: string; total: number; empresaId: string }
): Promise<string | null> {
  return autoMatchInvoice(supabase, params);
}
