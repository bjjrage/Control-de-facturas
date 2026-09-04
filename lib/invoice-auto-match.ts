import { SupabaseClient } from "@supabase/supabase-js";
import { roundCents } from "./reconciliation";
import { logAudit } from "./audit";

/**
 * Auto-match 2-de-3: Proveedor (base) + N° OC + Producto.
 *
 * Con el proveedor ya identificado por RUC, busca OCs abiertas de ese proveedor
 * y puntúa cada una:
 *   +1 si el código de OC aparece textualmente en order_reference de la factura
 *   +1 si el producto de la OC aparece en product_description de la factura
 *
 * score=2 (ambas) → match automático directo
 * score=1 (una)   → match automático si es la única candidata con ese score
 * score=0         → ninguna OC coincide; queda PENDIENTE para vincular a mano
 *
 * Si no se pasan order_reference/product_description (facturas cargadas sin esos
 * datos), cae al match por saldo exacto como fallback para no romper el flujo
 * existente.
 */
export async function autoMatchInvoice(
  supabase: SupabaseClient,
  params: {
    invoiceId: string;
    providerId: string;
    total: number;
    empresaId: string;
    orderReference?: string | null;
    productDescription?: string | null;
  }
): Promise<string | null> {
  const { invoiceId, providerId, total, empresaId, orderReference, productDescription } = params;

  const { data: providerOrders } = await supabase
    .from("authorized_orders")
    .select("id, code, product, total_price, facturado_amount")
    .eq("empresa_id", empresaId)
    .eq("provider_id", providerId);

  const orders = (providerOrders ?? [])
    .map((o) => ({
      id: o.id as string,
      code: o.code as string,
      product: o.product as string,
      total: roundCents(o.total_price),
      saldo: roundCents((o.total_price as number) - ((o.facturado_amount as number) ?? 0)),
    }))
    .filter((o) => o.saldo > 0);

  if (orders.length === 0) return null;

  const refNorm = orderReference?.trim().toUpperCase() ?? null;
  const prodNorm = productDescription?.trim().toLowerCase() ?? null;

  // Puntuar cada OC abierta del proveedor
  const scored = orders.map((o) => {
    let score = 0;
    // Criterio OC: el código de la OC aparece en la referencia extraída
    if (refNorm && o.code.toUpperCase().includes(refNorm.replace(/\s/g, ""))) score++;
    // También si la referencia contiene el código exacto
    if (refNorm && refNorm.includes(o.code.toUpperCase())) score++;
    if (score > 1) score = 1; // máximo 1 por criterio

    // Criterio Producto: palabras clave del producto de la OC aparecen en la descripción
    if (prodNorm) {
      const ocWords = o.product.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      const matches = ocWords.filter((w) => prodNorm.includes(w));
      if (matches.length > 0 && matches.length >= Math.ceil(ocWords.length / 2)) score++;
    }
    return { ...o, score };
  });

  const best = Math.max(...scored.map((o) => o.score));

  // Si no hay ningún campo contextual, fallback a saldo exacto
  if (!refNorm && !prodNorm) {
    const bySaldo = orders.filter((o) => o.saldo === roundCents(total));
    if (bySaldo.length === 1) return doMatch(supabase, invoiceId, bySaldo[0].id, empresaId);
    const byTotal = orders.filter((o) => o.total === roundCents(total) && o.saldo === o.total);
    if (byTotal.length === 1) return doMatch(supabase, invoiceId, byTotal[0].id, empresaId);
    if (orders.length === 1) return doMatch(supabase, invoiceId, orders[0].id, empresaId);
    return null;
  }

  // 2 de 3 (score=2): match directo
  if (best >= 2) {
    const top = scored.filter((o) => o.score >= 2);
    if (top.length === 1) return doMatch(supabase, invoiceId, top[0].id, empresaId);
    // Ambigüedad: varias con score 2, no auto-matchear
    return null;
  }

  // 1 de 3 (score=1): auto-match solo si hay una única candidata
  if (best === 1) {
    const top = scored.filter((o) => o.score === 1);
    if (top.length === 1) return doMatch(supabase, invoiceId, top[0].id, empresaId);
    return null;
  }

  return null;
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
