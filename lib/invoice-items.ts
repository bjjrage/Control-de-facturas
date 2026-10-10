import type { SupabaseClient } from "@supabase/supabase-js";
import {
  descriptionsMatch,
  orderLineRemaining,
  suggestInvoiceItemMatches,
  unitsCompatible,
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
  const items = args.items.slice(0, MAX_LINES);
  if (!items.length) return { error: null, count: 0 };
  const rows = items.map((item, i) => ({
      invoice_id: args.invoiceId,
      empresa_id: args.empresaId,
      product_description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unit_price: item.unit_price,
      subtotal: item.subtotal,
      sort_order: i,
    }));
  // One multi-row INSERT is one database statement: all reviewed lines persist,
  // or none do. Per-line inserts could leave a partial invoice that later looks
  // like a genuine 1:1 match to the deterministic reconciler.
  const { error } = await supabase.from("invoice_items").insert(rows);
  if (error) return { error: error.message, count: 0 };
  return { error: null, count: rows.length };
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
 * Inserción validada compartida (diálogo + conciliación + worker bulk + corrección):
 * el servicio —no cada llamador— garantiza las invariantes en cada propuesta.
 *
 * Verificaciones (H1, todas fail-closed ante error de consulta):
 *  1. Factura existente (por id).
 *  2. Empresa correcta (todas las lecturas filtran por empresa_id).
 *  3. Estado editable (APTO_PARA_PAGO/PAGADO congela la conciliación).
 *  4. Línea perteneciente exactamente a esa factura (line.invoice_id === invoiceId;
 *     NO basta que la línea exista en la empresa).
 *  5. OC vinculada a la cabecera de esa factura (getHeaderLink === expectedOrderId).
 *  6. Ítem perteneciente exactamente a esa OC (order.order_id === expectedOrderId).
 *  7. Unidad compatible (misma regla que la vía manual/determinística).
 *  8. Cantidad documentada válida (finita; null = sin conciliar).
 *  9. Cantidad acumulada ya imputada de la línea: se suman los matches
 *     PREVIAMENTE PERSISTIDOS más los del batch en curso; la suma nunca supera
 *     lo documentado (invariante documental).
 * 10. Remanente de la OC: el RPC la vuelve a comprobar después de adquirir
 *     locks y aplica la inserción en la misma transacción.
 * 11. Ausencia de duplicación (RPC idempotente + UNIQUE constraint).
 * 12. Correspondencia del producto (descriptionsMatch, salvo caso 1:1 inequívoco).
 *
 * Invariante documental:
 *   SUM(invoice_item_matches.quantity_matched WHERE invoice_item_id = X)
 *     <= invoice_items.quantity
 * Invariante de OC:
 *   SUM(invoice_item_matches.quantity_matched WHERE order_item_id = Y)
 *     <= authorized_order_items.quantity
 * Invariante relacional: la línea de OC pertenece a la OC vinculada a la
 * factura propietaria de la línea. No se aceptan referencias cruzadas.
 *
 * La validación local mejora los errores para el usuario. La RPC
 * `create_invoice_item_match` es la autoridad final: revalida el vínculo
 * esperado, documento, tenant, cantidades y duplicado bajo locks y persiste
 * cada match atómicamente.
 *
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
  idempotent: number;
  skippedMismatch: number;
}> {
  const applied: AppliedItemMatch[] = [];
  let skippedNoLink = 0;
  let skippedOverDocumented = 0;
  let skippedOverRemaining = 0;
  let skippedDuplicate = 0;
  let idempotent = 0;
  let skippedMismatch = 0;
  const bail = (error: string | null) => ({
    error,
    applied,
    skippedNoLink,
    skippedOverDocumented,
    skippedOverRemaining,
    skippedDuplicate,
    idempotent,
    skippedMismatch,
  });

  const link = await getHeaderLink(supabase, { empresaId: args.empresaId, invoiceId: args.invoiceId });
  if (!link.ok || link.orderId !== args.expectedOrderId) {
    skippedNoLink = args.proposals.length;
    return bail(null);
  }

  // H1-1/2/3: factura existente, de la empresa y en estado editable.
  const { data: invoiceHead, error: headError } = await supabase
    .from("invoices")
    .select("id, status")
    .eq("id", args.invoiceId)
    .eq("empresa_id", args.empresaId)
    .maybeSingle();
  if (headError) return bail(`No se pudo verificar la factura: ${headError.message}`);
  if (!invoiceHead) return bail("Factura no encontrada: no se puede imputar por ítem.");
  // H1-3: misma regla que itemMutationsAllowed en las acciones: solo
  // PENDIENTE/MATCH/REQUIERE_REVISION admiten conciliación por ítem.
  if (!["PENDIENTE", "MATCH", "REQUIERE_REVISION"].includes((invoiceHead as { status: string }).status)) {
    return bail("La factura ya no está en estado editable; la conciliación por ítem queda congelada.");
  }

  const invoiceItemIds = [...new Set(args.proposals.map((p) => p.invoiceItemId))];
  const orderItemIds = [...new Set(args.proposals.map((p) => p.orderItemId))];
  const emptyId = "00000000-0000-0000-0000-000000000000";
  const [
    { data: invoiceLines, error: linesError },
    { data: orderLines, error: orderError },
    { data: priorMatches, error: priorError },
    { count: invoiceLineCount, error: ilCountError },
    { count: orderLineCount, error: olCountError },
  ] = await Promise.all([
    supabase.from("invoice_items").select("id, invoice_id, product_description, quantity, unit").eq("empresa_id", args.empresaId).in("id", invoiceItemIds.length ? invoiceItemIds : [emptyId]),
    supabase.from("authorized_order_items").select("id, order_id, product, quantity, unit, quantity_invoiced").eq("empresa_id", args.empresaId).in("id", orderItemIds.length ? orderItemIds : [emptyId]),
    // H1-9: matches previamente persistidos de estas líneas (la invariante
    // documental cubre TODO lo imputado, no solo el batch en curso).
    supabase.from("invoice_item_matches").select("invoice_item_id, quantity_matched").eq("empresa_id", args.empresaId).in("invoice_item_id", invoiceItemIds.length ? invoiceItemIds : [emptyId]),
    supabase.from("invoice_items").select("id", { count: "exact", head: true }).eq("invoice_id", args.invoiceId).eq("empresa_id", args.empresaId),
    supabase.from("authorized_order_items").select("id", { count: "exact", head: true }).eq("order_id", args.expectedOrderId).eq("empresa_id", args.empresaId),
  ]);
  if (linesError) return bail(`No se pudieron verificar las líneas: ${linesError.message}`);
  if (orderError) return bail(`No se pudieron verificar los ítems de OC: ${orderError.message}`);
  if (priorError) return bail(`No se pudo verificar lo ya imputado: ${priorError.message}`);
  if (ilCountError || olCountError) return bail("No se pudo verificar la imputación. Intentá nuevamente.");

  const lineById = new Map((invoiceLines ?? []).map((l) => [l.id as string, l]));
  const orderById = new Map((orderLines ?? []).map((l) => [l.id as string, l]));
  // H1-9: semilla con lo ya persistido (fail-closed arriba si la consulta falló).
  const matchedByLine = new Map<string, number>();
  for (const m of priorMatches ?? []) {
    const lid = (m as { invoice_item_id: string }).invoice_item_id;
    matchedByLine.set(lid, (matchedByLine.get(lid) ?? 0) + Number((m as { quantity_matched: number }).quantity_matched));
  }
  // H1-12: el bypass por caso inequívoco exige 1 línea y 1 ítem reales.
  const singleToSingle = (invoiceLineCount ?? 0) === 1 && (orderLineCount ?? 0) === 1;

  for (const proposal of args.proposals) {
    if (!Number.isFinite(proposal.quantityMatched) || proposal.quantityMatched <= 0) {
      skippedOverDocumented++;
      continue;
    }
    const line = lineById.get(proposal.invoiceItemId) as unknown as {
      id: string; invoice_id: string; product_description: string; quantity: number | null; unit: string | null;
    } | undefined;
    const order = orderById.get(proposal.orderItemId) as unknown as {
      id: string; order_id: string; product: string; quantity: number; unit: string; quantity_invoiced: number;
    } | undefined;
    if (!line || !order) {
      skippedNoLink++;
      continue;
    }
    // H1-4: la línea debe pertenecer EXACTAMENTE a esta factura.
    if (line.invoice_id !== args.invoiceId) {
      skippedNoLink++;
      continue;
    }
    // H1-5/6: el ítem debe pertenecer a la OC vinculada (no a otra OC del tenant).
    if (order.order_id !== args.expectedOrderId) {
      skippedNoLink++;
      continue;
    }
    // H1-7: unidad compatible (misma regla que vía manual/determinística).
    if (!unitsCompatible(line.unit, order.unit)) {
      skippedMismatch++;
      continue;
    }
    // H1-12: correspondencia del producto (salvo 1:1 inequívoco).
    if (!singleToSingle && !descriptionsMatch(line.product_description, order.product)) {
      skippedMismatch++;
      continue;
    }
    // H1-11: ausencia de duplicación (antes que los topes: un reintento
    // idéntico es idempotencia, no exceso; igual orden que la vía manual).
    const { data: dup, error: dupError } = await supabase
      .from("invoice_item_matches")
      .select("id, quantity_matched")
      .eq("invoice_item_id", proposal.invoiceItemId)
      .eq("order_item_id", proposal.orderItemId)
      .maybeSingle();
    if (dupError) return bail(`No se pudo verificar duplicados: ${dupError.message}`);
    if (dup) {
      if (Number((dup as { quantity_matched?: unknown }).quantity_matched) === proposal.quantityMatched) idempotent++;
      else skippedDuplicate++;
      continue;
    }
    // H1-8: cantidad documentada válida.
    const lineQty = Number(line.quantity);
    if (!Number.isFinite(lineQty)) {
      skippedOverDocumented++;
      continue;
    }
    const already = matchedByLine.get(proposal.invoiceItemId) ?? 0;
    // H1-9 (regla A): persistido + batch nunca supera lo documentado.
    if (already + proposal.quantityMatched > lineQty + 1e-9) {
      skippedOverDocumented++;
      continue;
    }
    // H1-10 (regla B): nunca se contabiliza por encima del remanente.
    // This is only a fast local filter; the RPC rechecks the current remainder
    // after locking the invoice, header link, order, line, and order item.
    const remaining = orderLineRemaining(order);
    if (proposal.quantityMatched > remaining + 1e-9) {
      skippedOverRemaining++;
      continue;
    }
    const { data: rpcResult, error } = await supabase.rpc("create_invoice_item_match", {
      p_empresa_id: args.empresaId,
      p_invoice_id: args.invoiceId,
      p_expected_order_id: args.expectedOrderId,
      p_invoice_item_id: proposal.invoiceItemId,
      p_order_item_id: proposal.orderItemId,
      p_quantity: proposal.quantityMatched,
    });
    if (error) {
      if (error.code === "23505") {
        skippedDuplicate++;
        continue;
      }
      return bail(error.message);
    }
    const result = rpcResult as { ok?: boolean; duplicate?: boolean; match_id?: string; error?: string } | null;
    if (!result?.ok) {
      // The RPC may report a validation rejection as JSON instead of raising.
      // Treat it as un-applied and fail closed; do not count it as persisted.
      if (result?.duplicate) {
        skippedDuplicate++;
        continue;
      }
      return bail(result?.error ?? "La RPC rechazó la imputación sin confirmar su causa.");
    }
    if (result.duplicate) {
      idempotent++;
      continue;
    }
    matchedByLine.set(proposal.invoiceItemId, already + proposal.quantityMatched);
    applied.push({
      invoiceItemId: proposal.invoiceItemId,
      orderItemId: proposal.orderItemId,
      quantityMatched: proposal.quantityMatched,
    });
  }
  return bail(null);
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
  // insertValidatedItemMatches re-verifica factura, vínculo, titularidad,
  // unidad, producto, topes y duplicados: lo que omite vuelve a pendiente
  // (nunca se contabiliza de más).
  pending += result.skippedNoLink + result.skippedOverDocumented + result.skippedOverRemaining + result.skippedDuplicate + result.skippedMismatch;
  heldOverRemaining += result.skippedOverRemaining;
  return { error: null, applied: result.applied, pending, heldOverRemaining };
}

export { orderLineRemaining };
