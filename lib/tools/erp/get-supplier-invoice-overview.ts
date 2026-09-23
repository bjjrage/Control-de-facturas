// READ tool LEVEL 0 — detalle de facturas de proveedor y sus relaciones reales.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";

export const GetSupplierInvoiceOverviewInputSchema = z.object({
  invoice_id: z.string().uuid().optional().nullable(),
  provider_id: z.string().uuid().optional().nullable(),
  status: z.string().trim().max(40).optional().nullable(),
  limit: z.number().int().min(1).max(50).default(20),
});
export type GetSupplierInvoiceOverviewInput = z.infer<typeof GetSupplierInvoiceOverviewInputSchema>;

async function handler(ctx: AgentToolContext, input: GetSupplierInvoiceOverviewInput, deps: { db: SupabaseClient }) {
  let query = deps.db
    .from("invoices")
    .select("id, provider_id, invoice_number, invoice_date, due_date, currency, exchange_rate, subtotal, vat, total, timbrado, attachment_id, observations, status, created_at, updated_at")
    .eq("empresa_id", ctx.empresaId)
    .order("invoice_date", { ascending: false })
    .limit(input.limit);
  if (input.invoice_id) query = query.eq("id", input.invoice_id);
  if (input.provider_id) query = query.eq("provider_id", input.provider_id);
  if (input.status) query = query.eq("status", input.status);

  const { data: invoices, error } = await query;
  if (error) throw new Error(`Error leyendo facturas de proveedor: ${error.message}`);
  const rows = invoices ?? [];
  const invoiceIds = rows.map((row) => row.id as string);
  const providerIds = [...new Set(rows.map((row) => row.provider_id as string))];
  const attachmentIds = [...new Set(rows.map((row) => row.attachment_id as string | null).filter((id): id is string => Boolean(id)))];

  const [providers, attachments, matches, exceptions, paymentLinks] = await Promise.all([
    providerIds.length
      ? deps.db.from("providers").select("id, name, tax_id, contact_name, email, phone, active").eq("empresa_id", ctx.empresaId).in("id", providerIds)
      : { data: [], error: null },
    attachmentIds.length
      ? deps.db.from("attachments").select("id, bucket, path, file_name, mime_type, size_bytes, created_at").eq("empresa_id", ctx.empresaId).in("id", attachmentIds)
      : { data: [], error: null },
    invoiceIds.length
      ? deps.db.from("invoice_order_matches").select("id, invoice_id, authorized_order_id, created_at, authorized_orders(id, code, provider_name, product, quantity, unit, total_price, currency, status, authorized_at)").in("invoice_id", invoiceIds)
      : { data: [], error: null },
    invoiceIds.length
      ? deps.db.from("invoice_exceptions").select("id, invoice_id, approved_by, approved_at, reason, comment, difference_amount, difference_pct, created_at").in("invoice_id", invoiceIds).order("created_at", { ascending: false })
      : { data: [], error: null },
    invoiceIds.length
      ? deps.db.from("payment_order_invoices").select("invoice_id, payment_order_id, payment_orders(id, code, status)").eq("empresa_id", ctx.empresaId).in("invoice_id", invoiceIds)
      : { data: [], error: null },
  ]);
  const relationError = providers.error ?? attachments.error ?? matches.error ?? exceptions.error ?? paymentLinks.error;
  if (relationError) throw new Error(`Error leyendo relaciones de factura: ${relationError.message}`);

  const byId = <T extends { id: string }>(items: T[] | null | undefined) => new Map((items ?? []).map((item) => [item.id, item]));
  const providerById = byId(providers.data as Array<{ id: string }>);
  const attachmentById = byId(attachments.data as Array<{ id: string }>);
  const matchesByInvoice = new Map<string, unknown[]>();
  for (const row of matches.data ?? []) {
    const invoiceId = String((row as { invoice_id: string }).invoice_id);
    matchesByInvoice.set(invoiceId, [...(matchesByInvoice.get(invoiceId) ?? []), row]);
  }
  const exceptionsByInvoice = new Map<string, unknown[]>();
  for (const row of exceptions.data ?? []) {
    const invoiceId = String((row as { invoice_id: string }).invoice_id);
    exceptionsByInvoice.set(invoiceId, [...(exceptionsByInvoice.get(invoiceId) ?? []), row]);
  }
  const paymentLinksByInvoice = new Map<string, unknown[]>();
  for (const row of paymentLinks.data ?? []) {
    const invoiceId = String((row as { invoice_id: string }).invoice_id);
    paymentLinksByInvoice.set(invoiceId, [...(paymentLinksByInvoice.get(invoiceId) ?? []), row]);
  }

  return {
    invoices: rows.map((invoice) => ({
      ...invoice,
      provider: providerById.get(String(invoice.provider_id)) ?? null,
      attachment: invoice.attachment_id ? attachmentById.get(String(invoice.attachment_id)) ?? null : null,
      order_matches: matchesByInvoice.get(String(invoice.id)) ?? [],
      exceptions: exceptionsByInvoice.get(String(invoice.id)) ?? [],
      payment_order_links: paymentLinksByInvoice.get(String(invoice.id)) ?? [],
    })),
    money_mutations_available_to_rodrigo: false,
  };
}

registerTool({
  name: "get_supplier_invoice_overview",
  description: "Lee facturas de proveedor con proveedor, detalle, adjunto, vínculo a OC, excepciones y referencias de órdenes de pago ya existentes. Nunca paga ni crea una orden de pago.",
  inputSchema: GetSupplierInvoiceOverviewInputSchema,
  riskLevel: 0,
  requiredRoles: ["administracion", "admin"],
  handler,
});

export const getSupplierInvoiceOverviewTool = { handler, inputSchema: GetSupplierInvoiceOverviewInputSchema };
