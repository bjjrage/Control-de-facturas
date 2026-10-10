import type { SupabaseClient } from "@supabase/supabase-js";
import {
  orderLineRemaining,
  suggestInvoiceItemMatches,
  type ReconcilableInvoiceLine,
  type ReconcilableOrderLine,
} from "./invoice-item-reconcile";

export type InvoiceLineInput = {
  description: string;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  subtotal: number | null;
};

const MAX_LINES = 200;

function cleanLine(raw: unknown): InvoiceLineInput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const description = typeof r.description === "string" ? r.description.trim().slice(0, 500) : "";
  if (!description) return null;
  const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const quantity = numOrNull(r.quantity);
  if (quantity !== null && quantity <= 0) return null;
  const unitPrice = numOrNull(r.unit_price ?? r.unitPrice);
  if (unitPrice !== null && unitPrice < 0) return null;
  return {
    description,
    quantity,
    unit: typeof r.unit === "string" && r.unit.trim() ? r.unit.trim().slice(0, 60) : null,
    unit_price: unitPrice,
    subtotal: numOrNull(r.subtotal),
  };
}

export function parseInvoiceLinesInput(raw: unknown): InvoiceLineInput[] {
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const out: InvoiceLineInput[] = [];
  for (const item of raw.slice(0, MAX_LINES)) {
    const parsed = cleanLine(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** Persiste líneas de factura (mismo shape que el worker bulk). Falla cerrado. */
export async function insertInvoiceItems(
  supabase: SupabaseClient,
  args: { empresaId: string; invoiceId: string; items: InvoiceLineInput[] }
): Promise<{ error: string | null; count: number }> {
  let count = 0;
  for (let i = 0; i < args.items.slice(0, MAX_LINES).length; i++) {
    const item = args.items[i];
    const { error } = await supabase.from("invoice_items").insert({
      invoice_id: args.invoiceId,
      empresa_id: args.empresaId,
      product_description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unit_price: item.unit_price,
      subtotal: item.subtotal,
      sort_order: i,
    });
    if (error) return { error: error.message, count };
    count++;
  }
  return { error: null, count };
}

export type AppliedItemMatch = { invoiceItemId: string; orderItemId: string; quantityMatched: number };

export type HeaderLinkCheck =
  | { ok: true; orderId: string }
  | { ok: false; error: string };

/**
 * R3-01: obtiene el vínculo de cabecera vigente factura↔OC. Falla cerrado ante
 * cualquier error de consulta: sin vínculo verificable no hay imputación.
 */
export async function getHeaderLink(
  supabase: SupabaseClient,
  args: { empresaId: string; invoiceId: string }
): Promise<HeaderLinkCheck> {
  const { data, error } = await supabase
    .from("invoice_order_matches")
    .select("id, authorized_order_id")
    .eq("invoice_id", args.invoiceId)
    .eq("empresa_id", args.empresaId)
    .maybeSingle();
  if (error) return { ok: false, error: "No se pudo verificar el vínculo con la OC. Intentá nuevamente." };
  if (!data || typeof (data as { authorized_order_id?: unknown }).authorized_order_id !== "string") {
    return { ok: false, error: "La factura no tiene una OC vinculada: no se puede imputar por ítem." };
  }
  return { ok: true, orderId: (data as { authorized_order_id: string }).authorized_order_id };
}

export type ValidatedProposal = { invoiceItemId: string; orderItemId: string; quantityMatched: number };

/**
 * Inserción validada compartida (diálogo + worker): respeta las mismas
 * invariantes en ambas vías. Cada propuesta debe traer:
 * - vínculo de cabecera vigente === orderId esperado (R3-01);
 * - cantidad ≤ cantidad documentada de la línea (R3-02 regla A);
 * - cantidad ≤ remanente de la OC (R3-02 regla B; el exceso se omite, nunca se contabiliza);
 * - sin duplicados (idempotencia ante reintentos).
 * Devuelve lo aplicado y lo omitido con su motivo; nunca inventa cantidades.
 */
export async function insertValidatedItemMatches(
  supabase: SupabaseClient,
  args: {
    empresaId: string;
    invoiceId: string;
    expectedOrderId: string;
    proposals: ValidatedProposal[];
  }
): Promise<{
  error: string | null;
  applied: AppliedItemMatch[];
  skippedNoLink: number;
  skippedOverDocumented: number;
  skippedOverRemaining: number;
  skippedDuplicate: number;
}> {
  const applied: AppliedItemMatch[] = [];
  let skippedNoLink = 0;
  let skippedOverDocumented = 0;
  let skippedOverRemaining = 0;
  let skippedDuplicate = 0;

  const link = await getHeaderLink(supabase, { empresaId: args.empresaId, invoiceId: args.invoiceId });
  if (!link.ok || link.orderId !== args.expectedOrderId) {
    return {
      error: null,
      applied,
      skippedNoLink: args.proposals.length,
      skippedOverDocumented,
      skippedOverRemaining,
      skippedDuplicate,
    };
  }

  const invoiceItemIds = [...new Set(args.proposals.map((p) => p.invoiceItemId))];
  const orderItemIds = [...new Set(args.proposals.map((p) => p.orderItemId))];
  const [{ data: invoiceLines, error: linesError }, { data: orderLines, error: orderError }] = await Promise.all([
    supabase.from("invoice_items").select("id, quantity").eq("empresa_id", args.empresaId).in("id", invoiceItemIds.length ? invoiceItemIds : ["00000000-0000-0000-0000-000000000000"]),
    supabase.from("authorized_order_items").select("id, order_id, quantity, unit, quantity_invoiced").eq("empresa_id", args.empresaId).in("id", orderItemIds.length ? orderItemIds : ["00000000-0000-0000-0000-000000000000"]),
  ]);
  if (linesError) return { error: linesError.message, applied, skippedNoLink, skippedOverDocumented, skippedOverRemaining, skippedDuplicate };
  if (orderError) return { error: orderError.message, applied, skippedNoLink, skippedOverDocumented, skippedOverRemaining, skippedDuplicate };

  const lineById = new Map((invoiceLines ?? []).map((l) => [l.id as string, l]));
  const orderById = new Map((orderLines ?? []).map((l) => [l.id as string, l]));
  const matchedByLine = new Map<string, number>();

  for (const proposal of args.proposals) {
    if (!Number.isFinite(proposal.quantityMatched) || proposal.quantityMatched <= 0) {
      skippedOverDocumented++;
      continue;
    }
    const line = lineById.get(proposal.invoiceItemId);
    const order = orderById.get(proposal.orderItemId);
    if (!line || !order) {
      skippedNoLink++;
      continue;
    }
    // R3-01: el ítem debe pertenecer a la OC vinculada (no a otra OC del tenant).
    if ((order as { order_id: string }).order_id !== args.expectedOrderId) {
      skippedNoLink++;
      continue;
    }
    const lineQty = Number((line as { quantity: number | null }).quantity);
    if (!Number.isFinite(lineQty)) {
      skippedOverDocumented++;
      continue;
    }
    const already = matchedByLine.get(proposal.invoiceItemId) ?? 0;
    // R3-02 regla A: la suma por línea nunca supera lo documentado.
    if (already + proposal.quantityMatched > lineQty + 1e-9) {
      skippedOverDocumented++;
      continue;
    }
    // R3-02 regla B: nunca se contabiliza por encima del remanente.
    const remaining = Number((order as { quantity: number }).quantity) - Number((order as { quantity_invoiced: number }).quantity_invoiced ?? 0);
    if (proposal.quantityMatched > remaining + 1e-9) {
      skippedOverRemaining++;
      continue;
    }
    const { data: dup, error: dupError } = await supabase
      .from("invoice_item_matches")
      .select("id")
      .eq("invoice_item_id", proposal.invoiceItemId)
      .eq("order_item_id", proposal.orderItemId)
      .maybeSingle();
    if (dupError) return { error: dupError.message, applied, skippedNoLink, skippedOverDocumented, skippedOverRemaining, skippedDuplicate };
    if (dup) {
      skippedDuplicate++;
      continue;
    }
    const { error } = await supabase.from("invoice_item_matches").insert({
      invoice_item_id: proposal.invoiceItemId,
      order_item_id: proposal.orderItemId,
      empresa_id: args.empresaId,
      quantity_matched: proposal.quantityMatched,
    });
    if (error) {
      if (error.code === "23505") {
        skippedDuplicate++;
        continue;
      }
      return { error: error.message, applied, skippedNoLink, skippedOverDocumented, skippedOverRemaining, skippedDuplicate };
    }
    matchedByLine.set(proposal.invoiceItemId, already + proposal.quantityMatched);
    applied.push({
      invoiceItemId: proposal.invoiceItemId,
      orderItemId: proposal.orderItemId,
      quantityMatched: proposal.quantityMatched,
    });
  }
  return { error: null, applied, skippedNoLink, skippedOverDocumented, skippedOverRemaining, skippedDuplicate };
}

/**
 * Aplica imputaciones determinísticas inequívocas tras un vínculo de cabecera
 * autorizado. Crea como máximo un match por línea de factura, solo con cantidad
 * propia de la línea y dentro del remanente. Lo ambiguo o excedido queda
 * pendiente para conciliación manual explícita.
 */
export async function applyDeterministicItemMatches(
  supabase: SupabaseClient,
  args: { empresaId: string; invoiceId: string; orderId: string }
): Promise<{ error: string | null; applied: AppliedItemMatch[]; pending: number; heldOverRemaining: number }> {
  const applied: AppliedItemMatch[] = [];
  let pending = 0;
  let heldOverRemaining = 0;

  // Integridad contable: sobre factura aprobada o pagada no se toca la
  // conciliación por ítem (queda congelada como el resto del documento).
  const { data: invoiceHead, error: headError } = await supabase
    .from("invoices")
    .select("id, status")
    .eq("id", args.invoiceId)
    .eq("empresa_id", args.empresaId)
    .maybeSingle();
  if (headError) return { error: headError.message, applied, pending, heldOverRemaining };
  if (!invoiceHead) return { error: "Factura no encontrada.", applied, pending, heldOverRemaining };
  if (["APTO_PARA_PAGO", "PAGADO"].includes((invoiceHead as { status: string }).status)) {
    const { count } = await supabase
      .from("invoice_items")
      .select("id", { count: "exact", head: true })
      .eq("invoice_id", args.invoiceId)
      .eq("empresa_id", args.empresaId);
    return { error: null, applied, pending: count ?? 0, heldOverRemaining };
  }

  const { data: invoiceLines, error: linesError } = await supabase
    .from("invoice_items")
    .select("id, invoice_id, empresa_id, product_description, quantity, unit")
    .eq("invoice_id", args.invoiceId)
    .eq("empresa_id", args.empresaId)
    .order("sort_order");
  if (linesError) return { error: linesError.message, applied, pending, heldOverRemaining };
  if (!invoiceLines?.length) return { error: null, applied, pending: 0, heldOverRemaining: 0 };

  const { data: orderLines, error: orderError } = await supabase
    .from("authorized_order_items")
    .select("id, order_id, empresa_id, product, quantity, unit, quantity_invoiced")
    .eq("order_id", args.orderId)
    .eq("empresa_id", args.empresaId)
    .order("sort_order");
  if (orderError) return { error: orderError.message, applied, pending, heldOverRemaining };
  if (!orderLines?.length) return { error: null, applied, pending: invoiceLines.length, heldOverRemaining: 0 };

  const proposals = suggestInvoiceItemMatches(
    invoiceLines as ReconcilableInvoiceLine[],
    orderLines as ReconcilableOrderLine[]
  );
  const proposedInvoiceIds = new Set(proposals.map((p) => p.invoiceItemId));
  pending = invoiceLines.length - proposedInvoiceIds.size;

  const overRemaining = proposals.filter((p) => p.overRemaining);
  heldOverRemaining = overRemaining.length;
  pending += overRemaining.length;

  const insertable = proposals
    .filter((p) => !p.overRemaining)
    .map((p) => ({ invoiceItemId: p.invoiceItemId, orderItemId: p.orderItemId, quantityMatched: p.quantityMatched }));
  const result = await insertValidatedItemMatches(supabase, {
    empresaId: args.empresaId,
    invoiceId: args.invoiceId,
    expectedOrderId: args.orderId,
    proposals: insertable,
  });
  if (result.error) return { error: result.error, applied, pending, heldOverRemaining };
  // insertValidatedItemMatches re-verifica vínculo, topes y duplicados: lo que
  // omite vuelve a pendiente (nunca se contabiliza de más).
  pending += result.skippedNoLink + result.skippedOverDocumented + result.skippedOverRemaining + result.skippedDuplicate;
  heldOverRemaining += result.skippedOverRemaining;
  return { error: null, applied: result.applied, pending, heldOverRemaining };
}

/** Limpia los matches por ítem de un vínculo factura↔OC (el trigger recalcula). */
export async function deleteItemMatchesForLink(
  supabase: SupabaseClient,
  args: { empresaId: string; invoiceId: string; orderId: string }
): Promise<{ error: string | null; deleted: number }> {
  const { data: invoiceLines } = await supabase
    .from("invoice_items")
    .select("id")
    .eq("invoice_id", args.invoiceId)
    .eq("empresa_id", args.empresaId);
  const { data: orderLines } = await supabase
    .from("authorized_order_items")
    .select("id")
    .eq("order_id", args.orderId)
    .eq("empresa_id", args.empresaId);
  const invoiceIds = (invoiceLines ?? []).map((l) => l.id as string);
  const orderIds = new Set((orderLines ?? []).map((l) => l.id as string));
  if (!invoiceIds.length || !orderIds.size) return { error: null, deleted: 0 };

  const { data: matches, error: matchError } = await supabase
    .from("invoice_item_matches")
    .select("id, invoice_item_id, order_item_id")
    .eq("empresa_id", args.empresaId)
    .in("invoice_item_id", invoiceIds);
  if (matchError) return { error: matchError.message, deleted: 0 };
  const toDelete = (matches ?? [])
    .filter((m) => orderIds.has(m.order_item_id as string))
    .map((m) => m.id as string);
  if (!toDelete.length) return { error: null, deleted: 0 };
  const { error } = await supabase
    .from("invoice_item_matches")
    .delete()
    .eq("empresa_id", args.empresaId)
    .in("id", toDelete);
  if (error) return { error: error.message, deleted: 0 };
  return { error: null, deleted: toDelete.length };
}

/** Borra las líneas de una factura (CASCADE elimina sus matches; el trigger recalcula). */
export async function deleteInvoiceItems(
  supabase: SupabaseClient,
  args: { empresaId: string; invoiceId: string }
): Promise<{ error: string | null; deleted: number }> {
  const { data, error } = await supabase
    .from("invoice_items")
    .delete()
    .eq("invoice_id", args.invoiceId)
    .eq("empresa_id", args.empresaId)
    .select("id");
  if (error) return { error: error.message, deleted: 0 };
  return { error: null, deleted: data?.length ?? 0 };
}

export { orderLineRemaining };
