// READ tool LEVEL 0 — orden de trabajo y su trazabilidad comercial.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";

export const GetWorkOrderOverviewInputSchema = z.object({ work_order_id: z.string().uuid() });
export type GetWorkOrderOverviewInput = z.infer<typeof GetWorkOrderOverviewInputSchema>;

async function handler(ctx: AgentToolContext, input: GetWorkOrderOverviewInput, deps: { db: SupabaseClient }) {
  const { data: order, error } = await deps.db
    .from("work_orders")
    .select("id, empresa_id, code, sales_document_id, client_id, project_id, currency, subtotal, vat_amount, total, status, approval_mode, workflow_status, responsible_role, routing_policy_id, approved_at, approved_by, notes, created_by, created_at, updated_at")
    .eq("id", input.work_order_id)
    .eq("empresa_id", ctx.empresaId)
    .maybeSingle();
  if (error) throw new Error(`Error leyendo orden de trabajo: ${error.message}`);
  if (!order) throw new Error("La orden de trabajo no existe o no pertenece a tu empresa.");

  const [document, client, items, events] = await Promise.all([
    deps.db.from("sales_documents").select("id, code, doc_type, status, acceptance_status, quotation_version, accepted_at, total, currency, client_id").eq("id", order.sales_document_id).eq("empresa_id", ctx.empresaId).maybeSingle(),
    deps.db.from("clients").select("id, name, tax_id, contact_name, email, phone").eq("id", order.client_id).eq("empresa_id", ctx.empresaId).maybeSingle(),
    deps.db.from("work_order_items").select("id, work_order_id, description, quantity, unit_price, vat_rate, line_total, created_at").eq("work_order_id", input.work_order_id).eq("empresa_id", ctx.empresaId).order("created_at"),
    deps.db.from("sales_quotation_events").select("id, event_type, actor_label, detail, created_at").eq("sales_document_id", order.sales_document_id).eq("empresa_id", ctx.empresaId).order("created_at", { ascending: false }).limit(50),
  ]);
  const relationError = document.error ?? client.error ?? items.error ?? events.error;
  if (relationError) throw new Error(`Error leyendo relaciones de la orden: ${relationError.message}`);
  return { work_order: order, sales_document: document.data ?? null, client: client.data ?? null, items: items.data ?? [], events: events.data ?? [] };
}

registerTool({
  name: "get_work_order_overview",
  description: "Lee una orden de trabajo real con documento aceptado relacionado, cliente, ítems, workflow y eventos. No crea, asigna ni cambia estados.",
  inputSchema: GetWorkOrderOverviewInputSchema,
  riskLevel: 0,
  requiredRoles: null,
  handler,
});

export const getWorkOrderOverviewTool = { handler, inputSchema: GetWorkOrderOverviewInputSchema };
