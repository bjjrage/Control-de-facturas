"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile, requireEmpresaId } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { differenceAmount, differencePct } from "@/lib/reconciliation";
import { validateManualItemMatch, suggestInvoiceItemMatches, type ReconcilableInvoiceLine, type ReconcilableOrderLine } from "@/lib/invoice-item-reconcile";
import {
  applyDeterministicItemMatches,
  deleteInvoiceItems,
  deleteItemMatchesForLink,
  getHeaderLink,
  insertValidatedItemMatches,
  parseInvoiceLinesInput,
} from "@/lib/invoice-items";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function itemMutationsAllowed(status: string): boolean {
  return status === "PENDIENTE" || status === "MATCH" || status === "REQUIERE_REVISION";
}

export async function matchOrder(invoiceId: string, authorizedOrderId: string) {
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
  const { error: itemError } = await applyDeterministicItemMatches(supabase, {
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
  return { error: null };
}

export async function unmatchOrder(invoiceId: string, matchId: string, authorizedOrderId: string) {
  const profile = await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase.from("invoice_order_matches")
    .delete().eq("id", matchId).eq("invoice_id", invoiceId)
    .eq("authorized_order_id", authorizedOrderId).select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "El vínculo no existe o no tenés permiso para desvincularlo." };
  // Limpiar también la conciliación por ítem del vínculo (el trigger recalcula
  // las cantidades; sin esto quedarían cantidades fantasma).
  const { error: itemError } = await deleteItemMatchesForLink(supabase, {
    empresaId: profile.empresa_id,
    invoiceId,
    orderId: authorizedOrderId,
  });
  if (itemError) return { error: itemError };
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
export async function deleteInvoice(invoiceId: string) {
  const empresaId = await requireEmpresaId(["admin"]);
  const admin = createAdminClient();

  // Scope the lookup to the caller's empresa — the admin client bypasses RLS,
  // so without this an admin could delete another tenant's invoice by id.
  const { data: invoice, error: invoiceLookupError } = await admin
    .from("invoices")
    .select("attachment_id, status, invoice_number")
    .eq("id", invoiceId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (invoiceLookupError) return { error: invoiceLookupError.message };
  if (!invoice) return { error: "Factura no encontrada." };

  if (invoice.status === "APTO_PARA_PAGO" || invoice.status === "PAGADO") {
    const reason = invoice.status === "PAGADO" ? "ya fue pagada" : "ya está aprobada para pago";
    return { error: `No se puede eliminar la factura ${invoice.invoice_number ?? ""} porque ${reason} (integridad contable).` };
  }

  // Verificar si está en una orden de pago ejecutada
  const { data: inExecutedOp, error: executedOpLookupError } = await admin
    .from("payment_order_invoices")
    .select("payment_orders(status)")
    .eq("invoice_id", invoiceId)
    .eq("empresa_id", empresaId);
  if (executedOpLookupError) return { error: executedOpLookupError.message };

  const hasExecutedOp = (inExecutedOp ?? []).some(
    (row: unknown) => (row as { payment_orders: { status: string } | null })?.payment_orders?.status === "EJECUTADA"
  );
  if (hasExecutedOp) {
    return { error: "No se puede eliminar una factura vinculada a una orden de pago ejecutada." };
  }

  // Stop on the first failure: the relationship guard also closes the race
  // between the status read above and the start of this privileged cleanup.
  const { error: matchDeleteError } = await admin.from("invoice_order_matches").delete().eq("invoice_id", invoiceId).eq("empresa_id", empresaId);
  if (matchDeleteError) return { error: matchDeleteError.message };
  // Líneas y sus matches por ítem (CASCADE + trigger recalculan; sin esto
  // quedarían cantidades fantasma).
  const { error: itemsDeleteError } = await deleteInvoiceItems(admin, { empresaId, invoiceId });
  if (itemsDeleteError) return { error: itemsDeleteError };
  const { error: exceptionDeleteError } = await admin.from("invoice_exceptions").delete().eq("invoice_id", invoiceId).eq("empresa_id", empresaId);
  if (exceptionDeleteError) return { error: exceptionDeleteError.message };
  const { error: auditDeleteError } = await admin.from("audit_logs").delete().eq("invoice_id", invoiceId).eq("empresa_id", empresaId);
  if (auditDeleteError) return { error: auditDeleteError.message };
  // payment_order_invoices tiene FK NO ACTION — solo se remueve si la OP no fue ejecutada
  const { error: paymentOrderLinkDeleteError } = await admin.from("payment_order_invoices").delete().eq("invoice_id", invoiceId).eq("empresa_id", empresaId);
  if (paymentOrderLinkDeleteError) return { error: paymentOrderLinkDeleteError.message };

  const { error } = await admin.from("invoices").delete().eq("id", invoiceId).eq("empresa_id", empresaId);
  if (error) return { error: error.message };

  if (invoice.attachment_id) {
    const { data: attachment } = await admin
      .from("attachments")
      .select("bucket, path")
      .eq("id", invoice.attachment_id)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (attachment) await admin.storage.from(attachment.bucket).remove([attachment.path]);
    await admin.from("attachments").delete().eq("id", invoice.attachment_id).eq("empresa_id", empresaId);
  }

  revalidatePath("/invoices");
  return { error: null };
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

/**
 * Corrige una línea pre-APTO sin pérdida de datos (R3-03): inserta primero la
 * versión corregida y recién después elimina la original (CASCADE + trigger).
 * - Si el INSERT falla, la línea original sigue intacta con sus matches.
 * - Si el DELETE falla, se intenta compensar borrando la versión nueva para
 *   restaurar el estado original; nunca se informa éxito parcial silencioso.
 * - Tras una corrección exitosa se intenta revalidar la conciliación de forma
 *   determinística (solo caso inequívoco); si ya no corresponde, la línea queda
 *   sin conciliar y las cantidades se recalculan por trigger. Todo auditado.
 */
export async function updateInvoiceItem(itemId: string, raw: {
  description: string; quantity?: number | null; unit?: string | null; unit_price?: number | null; subtotal?: number | null;
}): Promise<{ error: string | null; id?: string }> {
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

  // 1. Insertar primero la versión corregida (la original sigue existiendo).
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
      sort_order: (line as unknown as { sort_order: number }).sort_order ?? 0,
    })
    .select("id")
    .single();
  if (error || !data) return { error: `No se pudo corregir la línea${error?.message ? ` (${error.message})` : ""}: la original sigue intacta, reintentá.` };
  const newId = data.id as string;

  // 2. Eliminar la original (CASCADE quita sus matches; el trigger recalcula).
  const { error: delError } = await supabase
    .from("invoice_items")
    .delete()
    .eq("id", itemId)
    .eq("empresa_id", profile.empresa_id);
  if (delError) {
    // Compensar: borrar la versión nueva para restaurar el estado original.
    // H3 (regla de errores): si la compensación también falla, NO se afirma
    // restauración — se informa el estado real (duplicada pendiente de
    // revisión) y queda auditado para intervención humana. Vía transaccional
    // real: correct_invoice_item (migración PENDING).
    const { error: rollbackError } = await supabase
      .from("invoice_items")
      .delete()
      .eq("id", newId)
      .eq("empresa_id", profile.empresa_id);
    await logAudit(supabase, {
      action: "invoice.item_correction_failed",
      invoiceId,
      detail: { error: delError.message, rollback: rollbackError?.message ?? "ok" },
    });
    if (rollbackError) {
      return { error: "No se pudo corregir la línea y la restauración automática también falló: la corrección quedó como línea duplicada pendiente de revisión humana. Nada se dio por válido." };
    }
    return { error: "No se pudo corregir la línea y se restauró el estado original. Reintentá." };
  }

  // 3. Revalidar la conciliación de forma determinística (solo caso inequívoco).
  const link = await getHeaderLink(supabase, { empresaId: profile.empresa_id, invoiceId });
  let revalidated = 0;
  if (link.ok) {
    const { data: corrected } = await supabase
      .from("invoice_items")
      .select("id, invoice_id, empresa_id, product_description, quantity, unit")
      .eq("id", newId)
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
          proposals: [{ invoiceItemId: newId, orderItemId: single.orderItemId, quantityMatched: single.quantityMatched }],
        });
        revalidated = applied.applied.length;
        if (applied.error) {
          await logAudit(supabase, {
            action: "invoice.item_revalidation_failed",
            invoiceId,
            detail: { error: applied.error },
          });
        }
      }
    }
  }
  await logAudit(supabase, { action: "invoice.item_corrected", invoiceId, detail: { revalidated } });
  revalidatePath(`/invoices/${invoiceId}`);
  return { error: null, id: newId };
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
  const { error } = await supabase
    .from("invoice_items")
    .delete()
    .eq("id", itemId)
    .eq("empresa_id", profile.empresa_id);
  if (error) return { error: error.message };
  await logAudit(supabase, { action: "invoice.item_deleted", invoiceId: typed.invoice_id });
  revalidatePath(`/invoices/${typed.invoice_id}`);
  return { error: null };
}

/**
 * Imputación manual explícita de una línea de factura a una línea de OC.
 * R3-01: el ítem debe pertenecer a la OC vinculada a la factura (verificado en
 * backend contra `invoice_order_matches`; el selector de UI no basta).
 * R3-02: la cantidad nunca supera lo documentado de la línea (sumando todos sus
 * matches) ni el remanente de la OC; no existe mecanismo que autorice excesos,
 * así que se rechazan (sin warnings que contabilicen).
 * Frente a una desvinculación concurrente, el match recién creado se revalida y,
 * si el vínculo ya no existe, se elimina (convergencia por trigger).
 */
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

  // R3-01 paso 1-3: vínculo de cabecera vigente (falla cerrado ante error).
  const link = await getHeaderLink(supabase, { empresaId: profile.empresa_id, invoiceId: args.invoiceId });
  if (!link.ok) return { error: link.error };

  const [{ data: invoiceLine, error: invoiceLineError }, { data: orderLine, error: orderLineError }, { data: dup, error: dupError }] = await Promise.all([
    supabase.from("invoice_items").select("id, invoice_id, product_description, quantity, unit").eq("id", args.invoiceItemId).eq("empresa_id", profile.empresa_id).maybeSingle(),
    supabase.from("authorized_order_items").select("id, order_id, empresa_id, product, quantity, unit, quantity_invoiced").eq("id", args.orderItemId).eq("empresa_id", profile.empresa_id).maybeSingle(),
    supabase.from("invoice_item_matches").select("id").eq("invoice_item_id", args.invoiceItemId).eq("order_item_id", args.orderItemId).maybeSingle(),
  ]);
  if (invoiceLineError || orderLineError || dupError) {
    return { error: "No se pudo verificar la imputación. Intentá nuevamente." };
  }
  const il = invoiceLine as unknown as { id: string; invoice_id: string; product_description: string; quantity: number | null; unit: string | null } | null;
  const ol = orderLine as unknown as { id: string; order_id: string; empresa_id: string; product: string; quantity: number; unit: string; quantity_invoiced: number } | null;
  if (!il || il.invoice_id !== args.invoiceId) return { error: "La línea no pertenece a esta factura." };
  if (!ol) return { error: "El ítem de OC no existe o no pertenece a esta empresa." };
  // R3-01 paso 4-5: igualdad exacta con la OC vinculada.
  if (ol.order_id !== link.orderId) {
    return { error: "El ítem pertenece a otra OC: solo se puede imputar a la OC vinculada a esta factura." };
  }

  const [{ count: invoiceLineCount, error: ilCountError }, { count: orderLineCount, error: olCountError }, { data: lineMatches, error: lineMatchesError }] = await Promise.all([
    supabase.from("invoice_items").select("id", { count: "exact", head: true }).eq("invoice_id", args.invoiceId).eq("empresa_id", profile.empresa_id),
    supabase.from("authorized_order_items").select("id", { count: "exact", head: true }).eq("order_id", ol.order_id).eq("empresa_id", profile.empresa_id),
    supabase.from("invoice_item_matches").select("quantity_matched").eq("invoice_item_id", il.id).eq("empresa_id", profile.empresa_id),
  ]);
  if (ilCountError || olCountError || lineMatchesError) {
    return { error: "No se pudo verificar la imputación. Intentá nuevamente." };
  }
  const existingLineMatched = (lineMatches ?? []).reduce((s, m) => s + Number((m as { quantity_matched: number }).quantity_matched), 0);

  const check = validateManualItemMatch({
    invoiceEmpresaId: profile.empresa_id,
    orderEmpresaId: ol.empresa_id,
    invoiceStatus: invoice.status,
    invoiceLine: { id: il.id, invoice_id: il.invoice_id, description: il.product_description, quantity: il.quantity, unit: il.unit },
    orderLine: { id: ol.id, product: ol.product, quantity: Number(ol.quantity), unit: ol.unit, quantity_invoiced: Number(ol.quantity_invoiced ?? 0) },
    invoiceLineCount: invoiceLineCount ?? 0,
    orderLineCount: orderLineCount ?? 0,
    quantity: args.quantity,
    existingLineMatched,
    duplicateExists: !!dup,
  });
  if (!check.ok) return { error: check.error };

  const { data, error } = await supabase
    .from("invoice_item_matches")
    .insert({
      invoice_item_id: il.id,
      order_item_id: ol.id,
      empresa_id: profile.empresa_id,
      quantity_matched: args.quantity,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { error: "Esa línea ya está imputada a ese ítem de OC." };
    return { error: error.message };
  }

  // R3-01 concurrencia: si el vínculo se eliminó entre la verificación y la
  // inserción, el match recién creado se elimina para converger al estado
  // correcto (el trigger recalcula). Sin transacción real no hay atomicidad
  // estricta: ver documentación (garantía documentada, no simulada).
  const recheck = await getHeaderLink(supabase, { empresaId: profile.empresa_id, invoiceId: args.invoiceId });
  if (!recheck.ok || recheck.orderId !== ol.order_id) {
    await supabase.from("invoice_item_matches").delete().eq("id", data.id as string).eq("empresa_id", profile.empresa_id);
    await logAudit(supabase, { action: "invoice.item_match_voided_race", invoiceId: args.invoiceId });
    return { error: "El vínculo con la OC cambió durante la imputación; no se contabilizó nada. Reintentá." };
  }

  await logAudit(supabase, { action: "invoice.item_matched", invoiceId: args.invoiceId });
  revalidatePath(`/invoices/${args.invoiceId}`);
  revalidatePath(`/orders/${ol.order_id}`);
  return { error: null, id: data.id as string };
}

/** Quita una imputación manual pre-APTO (el trigger recalcula la cantidad facturada). */
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
  const { error } = await supabase
    .from("invoice_item_matches")
    .delete()
    .eq("id", matchId)
    .eq("empresa_id", profile.empresa_id);
  if (error) return { error: error.message };
  await logAudit(supabase, { action: "invoice.item_unmatched", invoiceId });
  revalidatePath(`/invoices/${invoiceId}`);
  return { error: null };
}
