"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile, requireEmpresaId } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { differenceAmount, differencePct } from "@/lib/reconciliation";
import { suggestInvoiceItemMatches, type ReconcilableInvoiceLine, type ReconcilableOrderLine } from "@/lib/invoice-item-reconcile";
import {
  applyDeterministicItemMatches,
  getHeaderLink,
  insertValidatedItemMatches,
  parseInvoiceLinesInput,
} from "@/lib/invoice-items";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function itemMutationsAllowed(status: string): boolean {
  return status === "PENDIENTE" || status === "MATCH" || status === "REQUIERE_REVISION";
}

export async function matchOrder(invoiceId: string, authorizedOrderId: string): Promise<{ error: string | null; warning?: string }> {
  const profile = await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();

  const { error } = await supabase
    .from("invoice_order_matches")
    .insert({ invoice_id: invoiceId, authorized_order_id: authorizedOrderId });
  if (error) {
    return {
      error:
        error.code === "23505"
          ? "Esta factura ya está vinculada a una orden. Desvinculala primero."
          : error.message,
    };
  }

  // Conciliación por ítem determinística sobre el vínculo autorizado.
  const { error: itemError, pending } = await applyDeterministicItemMatches(supabase, {
    empresaId: profile.empresa_id,
    invoiceId,
    orderId: authorizedOrderId,
  });
  if (itemError) {
    await logAudit(supabase, {
      action: "invoice.item_match_failed",
      invoiceId,
      authorizedOrderId,
      detail: { error: itemError },
    });
  }

  await logAudit(supabase, {
    action: "invoice.order_matched",
    invoiceId,
    authorizedOrderId,
  });

  // Cost Engine Flywheel: Alimentar observaciones de costo real
  try {
    const { data: inv } = await supabase
      .from("invoices")
      .select("empresa_id, provider_id, currency, invoice_date")
      .eq("id", invoiceId)
      .maybeSingle();

    if (inv) {
      const { recordCostObservationFromInvoice } = await import("@/lib/procurement/flywheel");
      await recordCostObservationFromInvoice(supabase, {
        empresaId: inv.empresa_id,
        invoiceId,
        providerId: inv.provider_id || "",
        orderId: authorizedOrderId,
        currency: inv.currency || "PYG",
        invoiceDate: inv.invoice_date || undefined
      });
    }
  } catch {
    // Defensivo
  }

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  return {
    error: null,
    ...(itemError || pending > 0 ? {
      warning: itemError
        ? "La factura quedó vinculada, pero no se completó la conciliación por línea. Revisala antes de aprobar el pago."
        : `${pending} línea(s) quedaron sin imputación. Revisalas antes de aprobar el pago.`,
    } : {}),
  };
}

export async function unmatchOrder(invoiceId: string, matchId: string, authorizedOrderId: string) {
  const profile = await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("unmatch_invoice_order", {
    p_empresa_id: profile.empresa_id,
    p_invoice_id: invoiceId,
    p_expected_match_id: matchId,
    p_expected_order_id: authorizedOrderId,
  });
  if (error) return { error: error.message };
  if (!(data as { ok?: boolean } | null)?.ok) {
    return { error: (data as { error?: string } | null)?.error ?? "El vínculo no existe o cambió; no se desvinculó." };
  }
  await logAudit(supabase, { action: "invoice.order_unmatched", invoiceId, authorizedOrderId });
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath(`/orders/${authorizedOrderId}`);
  return { error: null };
}

export async function approveException(invoiceId: string, reason: string, comment: string | null) {
  const profile = await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();

  const { data: invoice } = await supabase.from("invoices").select("*").eq("id", invoiceId).single();
  if (!invoice) return { error: "Factura no encontrada." };

  // Diferencia = sobrefacturación de la OC (acumulado facturado vs monto de la OC).
  const { data: match } = await supabase
    .from("invoice_order_matches")
    .select("authorized_orders(total_price, facturado_amount)")
    .eq("invoice_id", invoiceId)
    .maybeSingle();
  const order = (match as unknown as { authorized_orders: { total_price: number; facturado_amount: number } } | null)
    ?.authorized_orders;
  if (!order) return { error: "La factura no está vinculada a ninguna orden." };

  const { error } = await supabase.from("invoice_exceptions").insert({
    invoice_id: invoiceId,
    approved_by: profile.id,
    reason,
    comment,
    difference_amount: differenceAmount(order.facturado_amount, order.total_price),
    difference_pct: differencePct(order.facturado_amount, order.total_price),
  });
  if (error) return { error: error.message };

  await supabase.rpc("recompute_invoice_status", { p_invoice_id: invoiceId });
  await logAudit(supabase, { action: "invoice.exception_approved", invoiceId, detail: { reason } });

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  return { error: null };
}

export async function markAptoParaPago(invoiceId: string) {
  await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_invoice_apto_para_pago", { p_invoice_id: invoiceId });
  if (error) return { error: error.message };
  await logAudit(supabase, { action: "invoice.marked_apto_para_pago", invoiceId });
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  return { error: null };
}

/** Marca la factura como apta para pago, crea la OP y redirige a ella — todo en un paso. */
export async function markAptoYCrearOp(invoiceId: string) {

  const profile = await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  // 1. Cambiar estado
  const { error: markError } = await supabase.rpc("mark_invoice_apto_para_pago", { p_invoice_id: invoiceId });
  if (markError) return { error: markError.message };

  // 2. Obtener proveedor
  const { data: invoice } = await supabase
    .from("invoices")
    .select("provider_id")
    .eq("id", invoiceId)
    .eq("empresa_id", empresaId)
    .single();
  if (!invoice) return { error: "Factura no encontrada." };

  // 3. Crear OP
  const { data: code } = await supabase.rpc("next_op_code");
  const { data: op, error: opError } = await supabase
    .from("payment_orders")
    .insert({ empresa_id: empresaId, code: code as string, provider_id: invoice.provider_id, status: "EMITIDA", created_by: profile.id })
    .select("id")
    .single();
  if (opError || !op) return { error: "No se pudo crear la OP." };

  // 4. Vincular
  const { error: linkError } = await supabase
    .from("payment_order_invoices")
    .insert({ empresa_id: empresaId, payment_order_id: op.id, invoice_id: invoiceId });
  if (linkError) {
    await supabase.from("payment_orders").delete().eq("id", op.id);
    return { error: "No se pudo vincular la factura." };
  }

  await logAudit(supabase, { action: "payment_order.created", detail: { op_id: op.id, from_invoice: invoiceId } });
  revalidatePath("/invoices");
  revalidatePath("/pagos");
  redirect(`/pagos/${op.id}`);
}

/**
 * Hard-deletes an invoice: matches, exceptions, audit trail, the attachment
 * file, and the row itself. Admin-only, and deliberately not exposed to * "administracion" — this is a genuine hard delete (no undo), unlike the
 * cancel/void pattern used elsewhere in this system, kept around specifically
 * so test/duplicate data can be cleared without needing DB access.
 */
export async function deleteInvoice(invoiceId: string): Promise<{ error: string | null; warning?: string }> {
  const empresaId = await requireEmpresaId(["admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_invoice", {
    p_empresa_id: empresaId,
    p_invoice_id: invoiceId,
  });
  if (error) return { error: error.message };
  const result = data as {
    ok?: boolean;
    attachment_id?: string | null;
    cleanup_bucket?: string | null;
    cleanup_path?: string | null;
    error?: string;
  } | null;
  if (!result?.ok) return { error: result?.error ?? "No se pudo eliminar la factura." };

  // The invoice and its financial metadata are already committed as deleted.
  // Storage is outside PostgreSQL, so a cleanup failure is reported as a
  // warning and never presented as if the invoice deletion had rolled back.
  let warning: string | undefined;
  if (result.cleanup_bucket && result.cleanup_path) {
    try {
      const admin = createAdminClient();
      const { error: storageError } = await admin.storage.from(result.cleanup_bucket).remove([result.cleanup_path]);
      if (storageError) warning = "La factura se eliminó, pero no se pudo borrar su archivo adjunto.";
    } catch {
      warning = "La factura se eliminó, pero falló la limpieza de su archivo adjunto.";
    }
  }

  revalidatePath("/invoices");
  return { error: null, ...(warning ? { warning } : {}) };
}

export async function getSignedInvoiceAttachmentUrl(bucket: string, path: string) {
  await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 120);
  if (error || !data) return { url: null, error: error?.message ?? "No se pudo generar el enlace." };
  return { url: data.signedUrl, error: null };
}

async function loadInvoiceForItems(supabase: Awaited<ReturnType<typeof createClient>>, invoiceId: string, empresaId: string) {
  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, status")
    .eq("id", invoiceId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  return invoice as { id: string; status: string } | null;
}

/** Agrega una línea manual a una factura pre-APTO (revisión humana explícita). */
export async function addInvoiceItem(invoiceId: string, raw: {
  description: string; quantity?: number | null; unit?: string | null; unit_price?: number | null; subtotal?: number | null;
}): Promise<{ error: string | null; id?: string }> {
  const profile = await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  const invoice = await loadInvoiceForItems(supabase, invoiceId, profile.empresa_id);
  if (!invoice) return { error: "Factura no encontrada." };
  if (!itemMutationsAllowed(invoice.status)) {
    return { error: "La factura ya está aprobada o pagada; sus líneas quedan congeladas." };
  }
  const [parsed] = parseInvoiceLinesInput([raw]);
  if (!parsed) return { error: "La línea necesita al menos una descripción válida." };
  const { data, error } = await supabase
    .from("invoice_items")
    .insert({
      invoice_id: invoiceId,
      empresa_id: profile.empresa_id,
      product_description: parsed.description,
      quantity: parsed.quantity,
      unit: parsed.unit,
      unit_price: parsed.unit_price,
      subtotal: parsed.subtotal,
      sort_order: 0,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "No se pudo agregar la línea." };
  await logAudit(supabase, { action: "invoice.item_added", invoiceId });
  revalidatePath(`/invoices/${invoiceId}`);
  return { error: null, id: data.id as string };
}

/** Corrige una línea pre-APTO en una transacción, preservando su ID. */
export async function updateInvoiceItem(itemId: string, raw: {
  description: string; quantity?: number | null; unit?: string | null; unit_price?: number | null; subtotal?: number | null;
}): Promise<{ error: string | null; id?: string; warning?: string }> {
  const profile = await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  const { data: line, error: lineError } = await supabase
    .from("invoice_items")
    .select("id, invoice_id, sort_order, invoices!inner(status)")
    .eq("id", itemId)
    .eq("empresa_id", profile.empresa_id)
    .maybeSingle();
  if (lineError) return { error: "No se pudo leer la línea. Intentá nuevamente." };
  const status = (line as unknown as { invoices: { status: string } } | null)?.invoices?.status;
  if (!line || !status) return { error: "Línea no encontrada." };
  if (!itemMutationsAllowed(status)) {
    return { error: "La factura ya está aprobada o pagada; sus líneas quedan congeladas." };
  }
  const [parsed] = parseInvoiceLinesInput([raw]);
  if (!parsed) return { error: "La línea necesita al menos una descripción válida." };
  const invoiceId = (line as unknown as { invoice_id: string }).invoice_id;
  const { data: correction, error } = await supabase.rpc("correct_invoice_item", {
    p_empresa_id: profile.empresa_id,
    p_invoice_item_id: itemId,
    p_description: parsed.description,
    p_quantity: parsed.quantity,
    p_unit: parsed.unit,
    p_unit_price: parsed.unit_price,
    p_subtotal: parsed.subtotal,
  });
  if (error) return { error: error.message };
  if (!(correction as { ok?: boolean } | null)?.ok) {
    return { error: (correction as { error?: string } | null)?.error ?? "No se pudo corregir la línea." };
  }

  // La RPC preserva/revalida los matches existentes. Si la corrección aún no
  // tenía match, conserva el comportamiento anterior de propuesta determinística.
  const link = await getHeaderLink(supabase, { empresaId: profile.empresa_id, invoiceId });
  let revalidated = 0;
  let rematchFailed = false;
  if (link.ok) {
    const { data: corrected } = await supabase
      .from("invoice_items")
      .select("id, invoice_id, empresa_id, product_description, quantity, unit")
      .eq("id", itemId)
      .eq("empresa_id", profile.empresa_id)
      .maybeSingle();
    const { data: orderLines } = await supabase
      .from("authorized_order_items")
      .select("id, order_id, empresa_id, product, quantity, unit, quantity_invoiced")
      .eq("order_id", link.orderId)
      .eq("empresa_id", profile.empresa_id)
      .order("sort_order");
    if (corrected && orderLines?.length) {
      const proposals = suggestInvoiceItemMatches(
        [corrected as ReconcilableInvoiceLine],
        orderLines as ReconcilableOrderLine[]
      );
      const single = proposals.length === 1 && !proposals[0].overRemaining ? proposals[0] : null;
      if (single) {
        const applied = await insertValidatedItemMatches(supabase, {
          empresaId: profile.empresa_id,
          invoiceId,
          expectedOrderId: link.orderId,
          proposals: [{ invoiceItemId: itemId, orderItemId: single.orderItemId, quantityMatched: single.quantityMatched }],
        });
        revalidated = applied.applied.length;
        if (applied.error) {
          rematchFailed = true;
          await logAudit(supabase, {
            action: "invoice.item_revalidation_failed",
            invoiceId,
            detail: { error: applied.error },
          });
        }
      }
    }
  }
  await logAudit(supabase, { action: "invoice.item_corrected_runtime", invoiceId, detail: { revalidated } });
  revalidatePath(`/invoices/${invoiceId}`);
  const matchesKept = Number((correction as { matches_kept?: number } | null)?.matches_kept ?? 0);
  const remainsUnmatched = link.ok && matchesKept === 0 && revalidated === 0;
  const warning = rematchFailed || remainsUnmatched
    ? "La corrección se guardó. La línea quedó sin imputación y requiere revisión antes de aprobar el pago."
    : undefined;
  return { error: null, id: itemId, ...(warning ? { warning } : {}) };
}

/** Elimina una línea pre-APTO (CASCADE elimina sus matches; el trigger recalcula). */
export async function deleteInvoiceItem(itemId: string): Promise<{ error: string | null }> {
  const profile = await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  const { data: line } = await supabase
    .from("invoice_items")
    .select("id, invoice_id, invoices!inner(status)")
    .eq("id", itemId)
    .eq("empresa_id", profile.empresa_id)
    .maybeSingle();
  const typed = line as unknown as { invoice_id: string; invoices: { status: string } } | null;
  if (!typed) return { error: "Línea no encontrada." };
  if (!itemMutationsAllowed(typed.invoices.status)) {
    return { error: "La factura ya está aprobada o pagada; sus líneas quedan congeladas." };
  }
  const { data, error } = await supabase.rpc("delete_invoice_item", {
    p_empresa_id: profile.empresa_id,
    p_invoice_id: typed.invoice_id,
    p_invoice_item_id: itemId,
  });
  if (error) return { error: error.message };
  if (!(data as { ok?: boolean } | null)?.ok) {
    return { error: (data as { error?: string } | null)?.error ?? "No se pudo borrar la línea." };
  }
  await logAudit(supabase, { action: "invoice.item_deleted", invoiceId: typed.invoice_id });
  revalidatePath(`/invoices/${typed.invoice_id}`);
  return { error: null };
}

/** Match manual validado localmente y confirmado atómicamente por la RPC. */
export async function createInvoiceItemMatch(args: {
  invoiceId: string;
  invoiceItemId: string;
  orderItemId: string;
  quantity: number;
}): Promise<{ error: string | null; id?: string }> {
  const profile = await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  const invoice = await loadInvoiceForItems(supabase, args.invoiceId, profile.empresa_id);
  if (!invoice) return { error: "Factura no encontrada." };
  if (!Number.isFinite(args.quantity) || args.quantity <= 0) {
    return { error: "La cantidad imputada debe ser mayor a cero." };
  }
  const link = await getHeaderLink(supabase, { empresaId: profile.empresa_id, invoiceId: args.invoiceId });
  if (!link.ok) return { error: link.error };
  const [{ data: line, error: lineError }, { data: orderLine, error: orderError }] = await Promise.all([
    supabase.from("invoice_items").select("id, invoice_id").eq("id", args.invoiceItemId).eq("empresa_id", profile.empresa_id).maybeSingle(),
    supabase.from("authorized_order_items").select("id, order_id").eq("id", args.orderItemId).eq("empresa_id", profile.empresa_id).maybeSingle(),
  ]);
  if (lineError || orderError) return { error: "No se pudo verificar la imputación. Intentá nuevamente." };
  if (!line || line.invoice_id !== args.invoiceId) return { error: "La línea no pertenece a esta factura." };
  if (!orderLine) return { error: "El ítem de OC no existe o no pertenece a esta empresa." };
  if (orderLine.order_id !== link.orderId) return { error: "El ítem pertenece a otra OC: solo se puede imputar a la OC vinculada a esta factura." };
  const result = await insertValidatedItemMatches(supabase, {
    empresaId: profile.empresa_id,
    invoiceId: args.invoiceId,
    expectedOrderId: link.orderId,
    proposals: [{ invoiceItemId: args.invoiceItemId, orderItemId: args.orderItemId, quantityMatched: args.quantity }],
  });
  if (result.error) return { error: result.error };
  if (!result.applied.length) {
    if (result.idempotent) {
      revalidatePath(`/invoices/${args.invoiceId}`);
      return { error: null };
    }
    if (result.skippedDuplicate) return { error: "Esa línea ya está imputada a ese ítem de OC." };
    if (result.skippedNoLink) return { error: "La línea, el ítem o el vínculo con la OC cambiaron; actualizá e intentá nuevamente." };
    if (result.skippedOverDocumented) return { error: "La cantidad supera la cantidad documentada en la línea de factura." };
    if (result.skippedOverRemaining) return { error: "La cantidad supera el remanente de la OC." };
    if (result.skippedMismatch) return { error: "La unidad no es compatible o el producto no corresponde al ítem de la OC." };
    return { error: "No se pudo validar la imputación." };
  }

  await logAudit(supabase, { action: "invoice.item_matched", invoiceId: args.invoiceId });
  revalidatePath(`/invoices/${args.invoiceId}`);
  revalidatePath(`/orders/${link.orderId}`);
  return { error: null };
}

/** Quita una imputación manual pre-APTO mediante la RPC transaccional. */
export async function deleteInvoiceItemMatch(matchId: string, invoiceId: string): Promise<{ error: string | null }> {
  const profile = await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  const invoice = await loadInvoiceForItems(supabase, invoiceId, profile.empresa_id);
  if (!invoice) return { error: "Factura no encontrada." };
  if (!itemMutationsAllowed(invoice.status)) {
    return { error: "La factura ya está aprobada o pagada; la conciliación queda congelada." };
  }
  const { data: match } = await supabase
    .from("invoice_item_matches")
    .select("id, invoice_item_id, order_item_id")
    .eq("id", matchId)
    .eq("empresa_id", profile.empresa_id)
    .maybeSingle();
  if (!match) return { error: "Imputación no encontrada." };
  const { data: line } = await supabase
    .from("invoice_items")
    .select("id")
    .eq("id", (match as unknown as { invoice_item_id: string }).invoice_item_id)
    .eq("invoice_id", invoiceId)
    .eq("empresa_id", profile.empresa_id)
    .maybeSingle();
  if (!line) return { error: "La imputación no pertenece a esta factura." };
  const { data, error } = await supabase.rpc("delete_invoice_item_match", {
    p_empresa_id: profile.empresa_id,
    p_invoice_id: invoiceId,
    p_invoice_item_match_id: matchId,
  });
  if (error) return { error: error.message };
  if (!(data as { ok?: boolean } | null)?.ok) {
    return { error: (data as { error?: string } | null)?.error ?? "No se pudo quitar la imputación." };
  }
  await logAudit(supabase, { action: "invoice.item_unmatched", invoiceId });
  revalidatePath(`/invoices/${invoiceId}`);
  return { error: null };
}
