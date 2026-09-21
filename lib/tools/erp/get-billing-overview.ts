// READ tool LEVEL 0 — ventas, facturas comerciales, cotizaciones y órdenes de trabajo.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";

export const GetBillingOverviewInputSchema = z.object({
  document_id: z.string().uuid().optional().nullable(),
  client_id: z.string().uuid().optional().nullable(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type GetBillingOverviewInput = z.infer<typeof GetBillingOverviewInputSchema>;

async function handler(ctx: AgentToolContext, input: GetBillingOverviewInput, deps: { db: SupabaseClient }) {
  const { db } = deps;
  let docs = db.from("sales_documents").select("id, client_id, code, doc_type, issue_date, due_date, currency, subtotal, vat_amount, total, cobrado_amount, status, notes, quotation_version, acceptance_status, accepted_at, created_at, updated_at").eq("empresa_id", ctx.empresaId).order("issue_date", { ascending: false }).limit(input.limit);
  if (input.document_id) docs = docs.eq("id", input.document_id);
  if (input.client_id) docs = docs.eq("client_id", input.client_id);
  const { data: documents, error: documentError } = await docs;
  if (documentError) throw new Error(`Error leyendo ventas/facturación: ${documentError.message}`);
  const ids = (documents ?? []).map((row) => row.id);
  const [items, orders, clients] = await Promise.all([
    ids.length ? db.from("sales_document_items").select("id, sales_document_id, description, quantity, unit_price, vat_rate, line_total").eq("empresa_id", ctx.empresaId).in("sales_document_id", ids) : { data: [], error: null },
    ids.length ? db.from("work_orders").select("id, sales_document_id, status, workflow_status, responsible_role, approved_at, created_at, updated_at").in("sales_document_id", ids) : { data: [], error: null },
    db.from("clients").select("id, name, tax_id, email, phone, active").eq("empresa_id", ctx.empresaId).limit(input.limit),
  ]);
  if (items.error || orders.error || clients.error) throw new Error(`Error leyendo detalle comercial: ${(items.error ?? orders.error ?? clients.error)?.message}`);
  return { documents: documents ?? [], document_items: items.data ?? [], work_orders: orders.data ?? [], clients: clients.data ?? [], money_mutations_available_to_rodrigo: false };
}

registerTool({
  name: "get_billing_overview",
  description: "Lee facturas/documentos de venta, cotizaciones/proformas, ítems, estados, clientes y órdenes de trabajo relacionadas. Registrar cobros y movimientos monetarios queda prohibido.",
  inputSchema: GetBillingOverviewInputSchema,
  riskLevel: 0,
  requiredRoles: null,
  handler,
});

export const getBillingOverviewTool = { handler, inputSchema: GetBillingOverviewInputSchema };
