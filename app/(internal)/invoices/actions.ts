"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { sanitizeFileName } from "@/lib/storage";
import { autoMatchInvoiceByAmount } from "@/lib/invoice-auto-match";
import { revalidatePath } from "next/cache";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

/**
 * Reintenta la conciliación automática sobre todas las facturas pendientes de
 * vincular. Útil después de autorizar órdenes nuevas, o de corregir montos.
 */
export async function reconcilePendingInvoices() {
  const profile = await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { data: pending } = await supabase
    .from("invoices")
    .select("id, provider_id, total")
    .eq("status", "PENDIENTE");

  let matched = 0;
  for (const inv of pending ?? []) {
    const orderId = await autoMatchInvoiceByAmount(supabase, {
      invoiceId: inv.id,
      providerId: inv.provider_id,
      total: inv.total,
      empresaId,
    });
    if (orderId) matched++;
  }

  revalidatePath("/invoices");
  return { matched, total: (pending ?? []).length };
}

function str(formData: FormData, key: string) {
  const v = formData.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function num(formData: FormData, key: string) {
  const v = formData.get(key);
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function createInvoice(formData: FormData) {
  const profile = await requireProfile(["administracion", "admin"]);

  const providerId = str(formData, "provider_id");
  const invoiceNumber = str(formData, "invoice_number");
  const invoiceDate = str(formData, "invoice_date");
  const currency = str(formData, "currency");
  const total = num(formData, "total");
  const file = formData.get("file") as File | null;

  if (!providerId || !invoiceNumber || !invoiceDate || !currency) {
    return { error: "Completá proveedor, número, fecha y moneda." };
  }
  if (total === null || total <= 0) return { error: "El total debe ser mayor a cero." };

  const admin = createAdminClient();
  const empresaId = profile.empresa_id;
  let attachmentId: string | null = null;

  if (file && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) return { error: "El archivo no puede superar los 20MB." };
    const path = `${providerId}/${Date.now()}-${sanitizeFileName(file.name)}`;
    const { error: uploadError } = await admin.storage
      .from("invoice-files")
      .upload(path, file, { contentType: file.type || undefined });
    if (uploadError) return { error: "No se pudo subir el archivo: " + uploadError.message };

    const { data: attachment, error: attachmentError } = await admin
      .from("attachments")
      .insert({
        empresa_id: empresaId,
        bucket: "invoice-files",
        path,
        file_name: file.name,
        mime_type: file.type || null,
        size_bytes: file.size,
        uploaded_by: profile.id,
      })
      .select("id")
      .single();
    if (attachmentError || !attachment) return { error: "No se pudo registrar el adjunto." };
    attachmentId = attachment.id;
  }

  const supabase = await createClient();
  const { data: invoice, error } = await supabase
    .from("invoices")
    .insert({
      provider_id: providerId,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      currency,
      subtotal: num(formData, "subtotal"),
      vat: num(formData, "vat"),
      total,
      timbrado: str(formData, "timbrado"),
      attachment_id: attachmentId,
      observations: str(formData, "observations"),
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (error || !invoice) {
    return { error: error?.code === "23505" ? "Ya existe una factura con ese número para este proveedor." : (error?.message ?? "No se pudo crear la factura.") };
  }

  await logAudit(supabase, { action: "invoice.created", invoiceId: invoice.id });

  // Si viene de "Cargar factura para esta orden", se vincula directo a esa OC;
  // si no, se intenta la conciliación automática por monto.
  const linkOrderId = str(formData, "link_order_id");
  let autoMatchedOrderId: string | null = null;
  if (linkOrderId) {
    const { error: matchError } = await supabase
      .from("invoice_order_matches")
      .insert({ invoice_id: invoice.id, authorized_order_id: linkOrderId, empresa_id: empresaId });
    if (!matchError) {
      autoMatchedOrderId = linkOrderId;
      revalidatePath(`/orders/${linkOrderId}`);
    }
  } else {
    autoMatchedOrderId = await autoMatchInvoiceByAmount(supabase, {
      invoiceId: invoice.id,
      providerId,
      total,
      empresaId,
    });
  }

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoice.id}`);
  return { error: null, id: invoice.id as string, autoMatched: autoMatchedOrderId !== null };
}
