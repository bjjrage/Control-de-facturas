"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile, requireEmpresaId } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { differenceAmount, differencePct } from "@/lib/reconciliation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function matchOrder(invoiceId: string, authorizedOrderId: string) {
  await requireProfile(["administracion", "admin"]);
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

  await logAudit(supabase, {
    action: "invoice.order_matched",
    invoiceId,
    authorizedOrderId,
  });

  revalidatePath(`/invoices/${invoiceId}`);
  return { error: null };
}

export async function unmatchOrder(invoiceId: string, matchId: string, authorizedOrderId: string) {
  await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  await supabase.from("invoice_order_matches").delete().eq("id", matchId);
  await logAudit(supabase, { action: "invoice.order_unmatched", invoiceId, authorizedOrderId });
  revalidatePath(`/invoices/${invoiceId}`);
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

  revalidatePath(`/invoices/${invoiceId}`);
  return { error: null };
}

export async function markAptoParaPago(invoiceId: string) {
  await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_invoice_apto_para_pago", { p_invoice_id: invoiceId });
  if (error) return { error: error.message };
  await logAudit(supabase, { action: "invoice.marked_apto_para_pago", invoiceId });
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
  revalidatePath("/pagos");
  redirect(`/pagos/${op.id}`);
}

/**
 * Hard-deletes an invoice: matches, exceptions, audit trail, the attachment
 * file, and the row itself. Admin-only, and deliberately not exposed to
 * "administracion" — this is a genuine hard delete (no undo), unlike the
 * cancel/void pattern used elsewhere in this system, kept around specifically
 * so test/duplicate data can be cleared without needing DB access.
 */
export async function deleteInvoice(invoiceId: string) {
  const empresaId = await requireEmpresaId(["admin"]);
  const admin = createAdminClient();

  // Scope the lookup to the caller's empresa — the admin client bypasses RLS,
  // so without this an admin could delete another tenant's invoice by id.
  const { data: invoice } = await admin
    .from("invoices")
    .select("attachment_id")
    .eq("id", invoiceId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!invoice) return { error: "Factura no encontrada." };

  await admin.from("invoice_order_matches").delete().eq("invoice_id", invoiceId).eq("empresa_id", empresaId);
  await admin.from("invoice_exceptions").delete().eq("invoice_id", invoiceId).eq("empresa_id", empresaId);
  await admin.from("audit_logs").delete().eq("invoice_id", invoiceId).eq("empresa_id", empresaId);

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
}

export async function getSignedInvoiceAttachmentUrl(bucket: string, path: string) {
  await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 120);
  if (error || !data) return { url: null, error: error?.message ?? "No se pudo generar el enlace." };
  return { url: data.signedUrl, error: null };
}
