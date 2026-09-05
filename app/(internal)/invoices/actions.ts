"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { sanitizeFileName } from "@/lib/storage";
import { autoMatchInvoice } from "@/lib/invoice-auto-match";
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
    const orderId = await autoMatchInvoice(supabase, {
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
    autoMatchedOrderId = await autoMatchInvoice(supabase, {
      invoiceId: invoice.id,
      providerId,
      total,
      empresaId,
      orderReference: str(formData, "order_reference"),
      productDescription: str(formData, "product_description"),
    });
  }

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoice.id}`);
  return { error: null, id: invoice.id as string, autoMatched: autoMatchedOrderId !== null };
}

export type OrderCandidate = {
  id: string;
  code: string;
  product: string;
  provider_id: string;
  provider_name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total_price: number;
  facturado_amount: number;
  saldo: number;
  currency: string;
  status: string;
  authorized_at: string;
  score: number;
  scoreLabel: string;
};

/**
 * Busca órdenes de compra candidatas para vincular manualmente a una factura
 * PENDIENTE. Scoring fuzzy:
 *   3 = mismo proveedor + monto dentro de ±20%
 *   2 = mismo proveedor (cualquier monto)
 *   1 = proveedor distinto pero monto muy cercano (±5%) → posible error de LLM
 */
export async function getCandidateOrders(invoiceId: string): Promise<{
  error: string | null;
  candidates: OrderCandidate[];
  invoiceProvider: string;
  invoiceTotal: number;
  invoiceCurrency: string;
}> {
  const profile = await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, provider_id, total, currency")
    .eq("id", invoiceId)
    .eq("empresa_id", empresaId)
    .single();
  if (!invoice) return { error: "Factura no encontrada.", candidates: [], invoiceProvider: "", invoiceTotal: 0, invoiceCurrency: "PYG" };

  const { data: providerRow } = await supabase.from("providers").select("name").eq("id", invoice.provider_id).single();

  // Solo OCs del mismo proveedor — nunca mezclar con otros proveedores.
  const { data: orders } = await supabase
    .from("authorized_orders")
    .select("id, code, product, provider_id, provider_name, quantity, unit, unit_price, total_price, facturado_amount, currency, status, authorized_at")
    .eq("empresa_id", empresaId)
    .eq("provider_id", invoice.provider_id)
    .order("authorized_at", { ascending: false });

  const target = invoice.total as number;
  const candidates: OrderCandidate[] = [];

  for (const o of orders ?? []) {
    const saldo = (o.total_price as number) - ((o.facturado_amount as number) ?? 0);
    if (saldo <= 0) continue;

    const ref = Math.max(saldo, target);
    const diff = Math.abs(saldo - target) / ref;
    const within20 = diff <= 0.20;

    const score = within20 ? 2 : 1;
    const scoreLabel = within20 ? "Monto coincide" : "OC abierta";

    candidates.push({
      id: o.id as string,
      code: o.code as string,
      product: o.product as string,
      provider_id: o.provider_id as string,
      provider_name: o.provider_name as string,
      quantity: o.quantity as number,
      unit: o.unit as string,
      unit_price: o.unit_price as number,
      total_price: o.total_price as number,
      facturado_amount: (o.facturado_amount as number) ?? 0,
      saldo,
      currency: o.currency as string,
      status: o.status as string,
      authorized_at: o.authorized_at as string,
      score,
      scoreLabel,
    });
  }

  candidates.sort((a, b) => b.score - a.score || new Date(b.authorized_at).getTime() - new Date(a.authorized_at).getTime());

  return {
    error: null,
    candidates: candidates.slice(0, 50),
    invoiceProvider: providerRow?.name ?? "—",
    invoiceTotal: target,
    invoiceCurrency: invoice.currency as string,
  };
}

/** Vincula manualmente una factura PENDIENTE a una OC y la pasa a MATCH. */
export async function linkInvoiceToOrder(invoiceId: string, orderId: string): Promise<{ error: string | null }> {
  const profile = await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, status")
    .eq("id", invoiceId)
    .eq("empresa_id", empresaId)
    .single();
  if (!invoice) return { error: "Factura no encontrada." };
  if (invoice.status !== "PENDIENTE") return { error: "Solo se pueden vincular facturas en estado Pendiente." };

  const { data: existing } = await supabase
    .from("invoice_order_matches")
    .select("id")
    .eq("invoice_id", invoiceId)
    .maybeSingle();
  if (existing) return { error: "Esta factura ya tiene una OC vinculada." };

  const { error: matchError } = await supabase
    .from("invoice_order_matches")
    .insert({ invoice_id: invoiceId, authorized_order_id: orderId, empresa_id: empresaId });
  if (matchError) return { error: "No se pudo vincular: " + matchError.message };

  await supabase.from("invoices").update({ status: "MATCH" }).eq("id", invoiceId).eq("empresa_id", empresaId);

  await logAudit(supabase, { action: "invoice.order_manual_matched", invoiceId, authorizedOrderId: orderId });

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath(`/orders/${orderId}`);
  return { error: null };
}
